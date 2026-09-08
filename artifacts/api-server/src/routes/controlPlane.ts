import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  controlPlaneAgentsTable,
  controlPlaneAuditTable,
  controlPlaneDecisionsTable,
  controlPlaneExperimentsTable,
  controlPlaneLeadsTable,
  controlPlaneMemoryTable,
  controlPlaneMetricsTable,
  controlPlaneRunsTable,
  controlPlaneSignalsTable,
  controlPlaneTicketsTable,
  controlPlaneWorkItemsTable,
  AUTONOMY_LEVELS,
  LEAD_STAGES,
  TICKET_STATUSES,
  WORK_ITEM_STATUSES,
} from "@workspace/db";
import {
  AGENT_REGISTRY,
  POLICY_KEYS,
  getAgent,
  stateOfBusiness,
  type AutonomyLevel,
  type ControlPlanePolicy,
} from "@workspace/control-plane";
import { requireOrg, requireOwnerMutationOrigin } from "../lib/orgAuth.js";
import { logger } from "../lib/logger.js";
import { loadPolicy, setPolicyValue } from "../lib/controlPlane/policyStore.js";
import { buildBusinessSnapshot } from "../lib/controlPlane/snapshot.js";
import { executeApprovedDecision, runControlPlaneTick } from "../lib/controlPlane/engine.js";
import { controlPlaneMissingTables, isControlPlaneReady } from "../lib/controlPlane/schemaGuard.js";
import { ensureFleet } from "../lib/controlPlane/registry.js";
import { createTicket } from "../lib/controlPlane/signals.js";

const router: IRouter = Router();

const NOT_MIGRATED = {
  error:
    "The control plane schema is not migrated on this database. Run `pnpm run db:push` to create its tables.",
  code: "control_plane_not_migrated",
};

/**
 * Every ops route is org-scoped; there is no cross-tenant view by design.
 * Access matches the rest of the owner surface: any member of the Clerk
 * organization, the same bar as billing and credits.
 */
async function ops(req: Request, res: Response) {
  const ctx = await requireOrg(req, res);
  if (!ctx) return null;
  if (!(await isControlPlaneReady())) {
    res.status(503).json({ ...NOT_MIGRATED, missing: await controlPlaneMissingTables() });
    return null;
  }
  await ensureFleet(ctx.org.id);
  return ctx;
}

function actorFor(ctx: { clerkUserId: string }): string {
  return `clerk:${ctx.clerkUserId}`;
}

function parseLimit(value: unknown, fallback: number, max = 200): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

/* ————————————————————————— Overview ————————————————————————— */

router.get("/control-plane/overview", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;

  const policy = await loadPolicy(ctx.org.id);
  const now = new Date();
  const snapshot = await buildBusinessSnapshot(ctx.org.id, {
    reviewSlaHours: policy.reviewSlaHours,
    now,
  });

  const recentRuns = await db
    .select({
      id: controlPlaneRunsTable.id,
      agentKey: controlPlaneRunsTable.agentKey,
      status: controlPlaneRunsTable.status,
      startedAt: controlPlaneRunsTable.startedAt,
      summary: controlPlaneRunsTable.summary,
      narrative: controlPlaneRunsTable.narrative,
      observations: controlPlaneRunsTable.observations,
      proposedCount: controlPlaneRunsTable.proposedCount,
      executedCount: controlPlaneRunsTable.executedCount,
    })
    .from(controlPlaneRunsTable)
    .where(eq(controlPlaneRunsTable.organizationId, ctx.org.id))
    .orderBy(desc(controlPlaneRunsTable.startedAt))
    .limit(12);

  // The latest observation set from every agent, so the console shows the
  // whole business rather than only whichever agent ran most recently.
  const latestByAgent = new Map<string, (typeof recentRuns)[number]>();
  for (const run of recentRuns) {
    if (run.status !== "succeeded") continue;
    if (!latestByAgent.has(run.agentKey)) latestByAgent.set(run.agentKey, run);
  }
  const observations = [...latestByAgent.values()].flatMap(
    (run) => (run.observations ?? []) as ReturnType<typeof stateOfBusiness>["highlights"],
  );
  const state = stateOfBusiness(snapshot, observations);

  const openDecisions = await db
    .select()
    .from(controlPlaneDecisionsTable)
    .where(
      and(
        eq(controlPlaneDecisionsTable.organizationId, ctx.org.id),
        inArray(controlPlaneDecisionsTable.status, ["proposed", "approved"]),
      ),
    )
    .orderBy(desc(controlPlaneDecisionsTable.impactScore), desc(controlPlaneDecisionsTable.createdAt))
    .limit(25);

  res.json({
    state,
    policy,
    snapshot: {
      now: snapshot.now,
      organization: snapshot.organization,
      funnel: snapshot.funnel,
      finance: snapshot.finance,
      venues: snapshot.venues,
      ledger: snapshot.ledger,
      metrics: snapshot.metrics,
      workItems: snapshot.workItems,
      experiments: snapshot.experiments,
    },
    fleet: snapshot.fleet.map((agent) => ({
      ...agent,
      charter: getAgent(agent.agentKey)?.charter ?? null,
      displayName: getAgent(agent.agentKey)?.displayName ?? agent.agentKey,
    })),
    recentRuns,
    openDecisions,
  });
});

/* ————————————————————————— Fleet ————————————————————————— */

router.get("/control-plane/agents", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(controlPlaneAgentsTable)
    .where(eq(controlPlaneAgentsTable.organizationId, ctx.org.id));
  res.json({
    agents: rows.map((row) => ({
      ...row,
      charter: getAgent(row.agentKey)?.charter ?? null,
      registered: Boolean(getAgent(row.agentKey)),
    })),
    catalog: AGENT_REGISTRY.map((agent) => ({
      key: agent.key,
      domain: agent.domain,
      displayName: agent.displayName,
      charter: agent.charter,
      defaultAutonomy: agent.defaultAutonomy,
      defaultIntervalMinutes: agent.defaultIntervalMinutes,
    })),
  });
});

router.patch("/control-plane/agents/:agentKey", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;

  const { agentKey } = req.params;
  const body = req.body as {
    enabled?: unknown;
    autonomy?: unknown;
    intervalMinutes?: unknown;
    dailyActionBudget?: unknown;
  };

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.enabled === "boolean") {
    update.enabled = body.enabled;
    update.status = body.enabled ? "idle" : "paused";
    if (body.enabled) {
      update.nextRunAt = new Date();
      update.lastError = null;
    }
  }
  if (typeof body.autonomy === "string") {
    if (!(AUTONOMY_LEVELS as readonly string[]).includes(body.autonomy)) {
      res.status(400).json({ error: `autonomy must be one of ${AUTONOMY_LEVELS.join(", ")}` });
      return;
    }
    update.autonomy = body.autonomy as AutonomyLevel;
  }
  if (body.intervalMinutes !== undefined) {
    const minutes = Number(body.intervalMinutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 10080) {
      res.status(400).json({ error: "intervalMinutes must be between 5 and 10080" });
      return;
    }
    update.intervalMinutes = Math.floor(minutes);
  }
  if (body.dailyActionBudget !== undefined) {
    const budget = Number(body.dailyActionBudget);
    if (!Number.isFinite(budget) || budget < 0 || budget > 500) {
      res.status(400).json({ error: "dailyActionBudget must be between 0 and 500" });
      return;
    }
    update.dailyActionBudget = Math.floor(budget);
  }

  if (Object.keys(update).length === 1) {
    res.status(400).json({ error: "No supported fields to update" });
    return;
  }

  const [row] = await db
    .update(controlPlaneAgentsTable)
    .set(update)
    .where(
      and(
        eq(controlPlaneAgentsTable.organizationId, ctx.org.id),
        eq(controlPlaneAgentsTable.agentKey, agentKey),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  await db.insert(controlPlaneAuditTable).values({
    organizationId: ctx.org.id,
    actorType: "human",
    actor: actorFor(ctx),
    action: "agent.updated",
    subjectType: "agent",
    subjectId: agentKey,
    detail: update as Record<string, unknown>,
  });

  res.json({ agent: row });
});

router.post("/control-plane/agents/:agentKey/run", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;
  const { agentKey } = req.params;
  if (!getAgent(agentKey)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const result = await runControlPlaneTick(ctx.org.id, {
    forceAgentKey: agentKey,
    trigger: "manual",
  });
  res.json(result);
});

router.post("/control-plane/tick", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;
  const result = await runControlPlaneTick(ctx.org.id, { trigger: "manual" });
  res.json(result);
});

/* ————————————————————————— Decisions ————————————————————————— */

router.get("/control-plane/decisions", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const status = typeof req.query.status === "string" ? req.query.status : "open";
  const statuses =
    status === "open"
      ? ["proposed", "approved"]
      : status === "all"
        ? ["proposed", "approved", "rejected", "executed", "failed", "expired"]
        : [status];

  const rows = await db
    .select()
    .from(controlPlaneDecisionsTable)
    .where(
      and(
        eq(controlPlaneDecisionsTable.organizationId, ctx.org.id),
        inArray(controlPlaneDecisionsTable.status, statuses),
        ...(typeof req.query.agentKey === "string"
          ? [eq(controlPlaneDecisionsTable.agentKey, req.query.agentKey)]
          : []),
      ),
    )
    .orderBy(desc(controlPlaneDecisionsTable.impactScore), desc(controlPlaneDecisionsTable.createdAt))
    .limit(parseLimit(req.query.limit, 50));

  res.json({ decisions: rows });
});

router.post("/control-plane/decisions/:id/approve", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid decision id" });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : null;

  const [claimed] = await db
    .update(controlPlaneDecisionsTable)
    .set({ status: "approved", decidedBy: actorFor(ctx), decidedAt: new Date(), decisionNote: note })
    .where(
      and(
        eq(controlPlaneDecisionsTable.id, id),
        eq(controlPlaneDecisionsTable.organizationId, ctx.org.id),
        eq(controlPlaneDecisionsTable.status, "proposed"),
      ),
    )
    .returning({ id: controlPlaneDecisionsTable.id, title: controlPlaneDecisionsTable.title });

  if (!claimed) {
    res.status(409).json({ error: "Decision is not awaiting approval" });
    return;
  }

  const outcome = await executeApprovedDecision(ctx.org.id, claimed.id, actorFor(ctx));
  const [decision] = await db
    .select()
    .from(controlPlaneDecisionsTable)
    .where(eq(controlPlaneDecisionsTable.id, claimed.id));

  res.status(outcome.ok ? 200 : 502).json({ decision, executed: outcome.ok, error: outcome.error ?? null });
});

router.post("/control-plane/decisions/:id/reject", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid decision id" });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : null;

  const [row] = await db
    .update(controlPlaneDecisionsTable)
    .set({ status: "rejected", decidedBy: actorFor(ctx), decidedAt: new Date(), decisionNote: note })
    .where(
      and(
        eq(controlPlaneDecisionsTable.id, id),
        eq(controlPlaneDecisionsTable.organizationId, ctx.org.id),
        inArray(controlPlaneDecisionsTable.status, ["proposed", "approved"]),
      ),
    )
    .returning();
  if (!row) {
    res.status(409).json({ error: "Decision is not open" });
    return;
  }

  await db.insert(controlPlaneAuditTable).values({
    organizationId: ctx.org.id,
    actorType: "human",
    actor: actorFor(ctx),
    action: "decision.rejected",
    subjectType: "decision",
    subjectId: String(row.id),
    detail: { title: row.title, note },
  });

  res.json({ decision: row });
});

/* ————————————————————————— Policy ————————————————————————— */

router.get("/control-plane/policy", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  res.json({ policy: await loadPolicy(ctx.org.id), keys: POLICY_KEYS });
});

router.patch("/control-plane/policy", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const entries = Object.entries(body).filter(([key]) =>
    (POLICY_KEYS as string[]).includes(key),
  ) as [keyof ControlPlanePolicy, unknown][];
  if (!entries.length) {
    res.status(400).json({ error: `Provide at least one of: ${POLICY_KEYS.join(", ")}` });
    return;
  }

  let policy = await loadPolicy(ctx.org.id);
  for (const [key, value] of entries) {
    try {
      policy = await setPolicyValue(ctx.org.id, key, value, actorFor(ctx));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid policy value" });
      return;
    }
  }

  await db.insert(controlPlaneAuditTable).values({
    organizationId: ctx.org.id,
    actorType: "human",
    actor: actorFor(ctx),
    action: "policy.updated",
    subjectType: "policy",
    subjectId: String(ctx.org.id),
    detail: Object.fromEntries(entries) as Record<string, unknown>,
  });

  res.json({ policy });
});

/* ————————————————————————— Domain surfaces ————————————————————————— */

router.get("/control-plane/tickets", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const rows = await db
    .select()
    .from(controlPlaneTicketsTable)
    .where(
      and(
        eq(controlPlaneTicketsTable.organizationId, ctx.org.id),
        ...(status && (TICKET_STATUSES as readonly string[]).includes(status)
          ? [eq(controlPlaneTicketsTable.status, status)]
          : []),
      ),
    )
    .orderBy(desc(controlPlaneTicketsTable.createdAt))
    .limit(parseLimit(req.query.limit, 50));
  res.json({ tickets: rows });
});

router.post("/control-plane/tickets", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;
  const body = req.body as { subject?: unknown; body?: unknown; requesterEmail?: unknown; venueId?: unknown };
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    res.status(400).json({ error: "subject is required" });
    return;
  }
  if (typeof body.body !== "string" || !body.body.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  const id = await createTicket({
    organizationId: ctx.org.id,
    subject: body.subject.trim(),
    body: body.body.trim(),
    requesterEmail: typeof body.requesterEmail === "string" ? body.requesterEmail.trim() : null,
    venueId: Number.isInteger(body.venueId) ? (body.venueId as number) : null,
    source: "console",
  });
  res.status(201).json({ ticketId: id });
});

router.patch("/control-plane/tickets/:id", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  const body = req.body as { status?: unknown; resolutionNote?: unknown; priority?: unknown };
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.status === "string") {
    if (!(TICKET_STATUSES as readonly string[]).includes(body.status)) {
      res.status(400).json({ error: `status must be one of ${TICKET_STATUSES.join(", ")}` });
      return;
    }
    update.status = body.status;
    if (body.status === "resolved" || body.status === "closed") update.resolvedAt = new Date();
  }
  if (typeof body.priority === "string") update.priority = body.priority;
  if (typeof body.resolutionNote === "string") update.resolutionNote = body.resolutionNote.slice(0, 2000);

  const [row] = await db
    .update(controlPlaneTicketsTable)
    .set(update)
    .where(
      and(
        eq(controlPlaneTicketsTable.id, id),
        eq(controlPlaneTicketsTable.organizationId, ctx.org.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  res.json({ ticket: row });
});

router.get("/control-plane/leads", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(controlPlaneLeadsTable)
    .where(eq(controlPlaneLeadsTable.organizationId, ctx.org.id))
    .orderBy(desc(controlPlaneLeadsTable.score), desc(controlPlaneLeadsTable.updatedAt))
    .limit(parseLimit(req.query.limit, 100));
  res.json({ leads: rows });
});

router.post("/control-plane/leads", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;
  const body = req.body as {
    companyName?: unknown;
    contactName?: unknown;
    contactEmail?: unknown;
    source?: unknown;
    stage?: unknown;
  };
  if (typeof body.companyName !== "string" || !body.companyName.trim()) {
    res.status(400).json({ error: "companyName is required" });
    return;
  }
  const stage = typeof body.stage === "string" && (LEAD_STAGES as readonly string[]).includes(body.stage)
    ? body.stage
    : "new";

  const [row] = await db
    .insert(controlPlaneLeadsTable)
    .values({
      organizationId: ctx.org.id,
      companyName: body.companyName.trim().slice(0, 200),
      contactName: typeof body.contactName === "string" ? body.contactName.trim().slice(0, 200) : null,
      contactEmail:
        typeof body.contactEmail === "string" && body.contactEmail.trim()
          ? body.contactEmail.trim().toLowerCase().slice(0, 320)
          : null,
      source: typeof body.source === "string" ? body.source.trim().slice(0, 60) : "inbound",
      stage,
      nextActionAt: new Date(Date.now() + 2 * 24 * 3_600_000),
    })
    .onConflictDoNothing({
      target: [controlPlaneLeadsTable.organizationId, controlPlaneLeadsTable.contactEmail],
    })
    .returning();
  if (!row) {
    res.status(409).json({ error: "A lead with that contact email already exists" });
    return;
  }
  res.status(201).json({ lead: row });
});

router.get("/control-plane/work-items", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(controlPlaneWorkItemsTable)
    .where(eq(controlPlaneWorkItemsTable.organizationId, ctx.org.id))
    .orderBy(desc(controlPlaneWorkItemsTable.updatedAt))
    .limit(parseLimit(req.query.limit, 100));
  res.json({ workItems: rows });
});

router.patch("/control-plane/work-items/:id", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (typeof status !== "string" || !(WORK_ITEM_STATUSES as readonly string[]).includes(status)) {
    res.status(400).json({ error: `status must be one of ${WORK_ITEM_STATUSES.join(", ")}` });
    return;
  }
  const [row] = await db
    .update(controlPlaneWorkItemsTable)
    .set({
      status,
      updatedAt: new Date(),
      closedAt: status === "done" || status === "cancelled" ? new Date() : null,
    })
    .where(
      and(
        eq(controlPlaneWorkItemsTable.id, id),
        eq(controlPlaneWorkItemsTable.organizationId, ctx.org.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Work item not found" });
    return;
  }
  res.json({ workItem: row });
});

router.get("/control-plane/experiments", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const policy = await loadPolicy(ctx.org.id);
  const snapshot = await buildBusinessSnapshot(ctx.org.id, { reviewSlaHours: policy.reviewSlaHours });
  res.json({ experiments: snapshot.experiments });
});

router.get("/control-plane/signals", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(controlPlaneSignalsTable)
    .where(eq(controlPlaneSignalsTable.organizationId, ctx.org.id))
    .orderBy(desc(controlPlaneSignalsTable.occurredAt))
    .limit(parseLimit(req.query.limit, 100));
  res.json({ signals: rows });
});

router.get("/control-plane/runs", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(controlPlaneRunsTable)
    .where(
      and(
        eq(controlPlaneRunsTable.organizationId, ctx.org.id),
        ...(typeof req.query.agentKey === "string"
          ? [eq(controlPlaneRunsTable.agentKey, req.query.agentKey)]
          : []),
      ),
    )
    .orderBy(desc(controlPlaneRunsTable.startedAt))
    .limit(parseLimit(req.query.limit, 50));
  res.json({ runs: rows });
});

router.get("/control-plane/audit", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(controlPlaneAuditTable)
    .where(eq(controlPlaneAuditTable.organizationId, ctx.org.id))
    .orderBy(desc(controlPlaneAuditTable.createdAt))
    .limit(parseLimit(req.query.limit, 100));
  res.json({ entries: rows });
});

router.get("/control-plane/memory", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(controlPlaneMemoryTable)
    .where(
      and(
        eq(controlPlaneMemoryTable.organizationId, ctx.org.id),
        sql`${controlPlaneMemoryTable.supersededAt} is null`,
      ),
    )
    .orderBy(desc(controlPlaneMemoryTable.createdAt))
    .limit(parseLimit(req.query.limit, 100));
  res.json({ notes: rows });
});

router.get("/control-plane/metrics", async (req, res) => {
  const ctx = await ops(req, res);
  if (!ctx) return;
  const days = parseLimit(req.query.days, 30, 365);
  const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(controlPlaneMetricsTable)
    .where(
      and(
        eq(controlPlaneMetricsTable.organizationId, ctx.org.id),
        gte(controlPlaneMetricsTable.metricDate, since),
      ),
    )
    .orderBy(controlPlaneMetricsTable.metricDate);

  const series: Record<string, { date: string; value: number }[]> = {};
  for (const row of rows) {
    (series[row.metricKey] ??= []).push({ date: row.metricDate, value: row.value });
  }
  res.json({ series });
});

/* ————————————————————————— Kill switch ————————————————————————— */

router.post("/control-plane/kill-switch", async (req, res) => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const ctx = await ops(req, res);
  if (!ctx) return;
  const engaged = req.body?.engaged;
  if (typeof engaged !== "boolean") {
    res.status(400).json({ error: "engaged must be a boolean" });
    return;
  }
  const policy = await setPolicyValue(ctx.org.id, "killSwitch", engaged, actorFor(ctx));
  await db.insert(controlPlaneAuditTable).values({
    organizationId: ctx.org.id,
    actorType: "human",
    actor: actorFor(ctx),
    action: engaged ? "kill_switch.engaged" : "kill_switch.released",
    subjectType: "organization",
    subjectId: String(ctx.org.id),
    detail: {},
  });
  logger.warn(
    { organizationId: ctx.org.id, engaged, actor: actorFor(ctx) },
    "Control plane kill switch toggled",
  );
  res.json({ policy });
});

export default router;
