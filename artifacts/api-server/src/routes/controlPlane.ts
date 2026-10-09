import { Router, type IRouter } from "express";
import {
  db,
  controlAgentsTable,
  agentRunsTable,
  agentTasksTable,
  agentActionsTable,
  controlExperimentsTable,
  controlAuditEventsTable,
  controlMetricsSnapshotsTable,
  controlProspectsTable,
  controlCampaignsTable,
  controlPoliciesTable,
  organizationsTable,
  venuesTable,
  coupleSessionsTable,
  AGENT_TASK_STATUSES,
  AGENT_ACTION_STATUSES,
  AGENT_STATUSES,
  type ControlCampaign,
} from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  SetControlAgentStatusBody,
  DecideControlActionBody,
  SetControlTaskStatusBody,
  UpdateControlPolicyBody,
  SetControlCampaignStatusBody,
} from "@workspace/api-zod";
import { requireOperator } from "../control-plane/operatorAuth.js";
import { requireOwnerMutationOrigin } from "../lib/orgAuth.js";
import { getAgentDefinition } from "../control-plane/agents.js";
import { computeBusinessMetrics } from "../control-plane/metrics.js";
import { startAgentRun } from "../control-plane/runner.js";
import { decideAction } from "../control-plane/actions.js";
import {
  POLICY_DEFAULTS,
  getPolicy,
  getPolicyNumber,
  listPolicies,
  validatePolicyUpdate,
} from "../control-plane/policies.js";
import { controlPlaneAiConfigured, controlPlaneModel } from "../control-plane/grok.js";
import { recordAuditEvent } from "../control-plane/audit.js";
import { logger } from "../lib/logger.js";

/**
 * Control-plane cockpit routes: overview (with the revenue funnel and KPI
 * trends), agents, runs, actions, tasks, audit, policies, campaigns and
 * metrics history. Prospect/outreach-studio routes live in
 * routes/controlProspects.ts and growth/experiments routes in
 * routes/controlGrowth.ts.
 */

const router: IRouter = Router();

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 100_000);
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* ————— Pure helpers (exported for routes/controlPlane.test.ts) ————— */

export type CampaignStatusValue = "draft" | "active" | "paused" | "completed";

/** Operator campaign moves. Completed is terminal; a draft can be launched or abandoned. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatusValue, CampaignStatusValue[]> = {
  draft: ["active", "completed"],
  active: ["paused", "completed"],
  paused: ["active", "completed"],
  completed: [],
};

export type GateResult = { ok: true } | { ok: false; error: string };

/**
 * Whether a campaign may move from `from` to `to`. Launching (to active)
 * also needs at least one step and no more steps than the max_campaign_steps
 * policy allows, so a sequence the drafting path would refuse never goes live.
 */
export function checkCampaignTransition(input: {
  from: string;
  to: CampaignStatusValue;
  stepCount: number;
  maxSteps: number;
}): GateResult {
  const allowed = CAMPAIGN_TRANSITIONS[input.from as CampaignStatusValue];
  if (!allowed) return { ok: false, error: `Campaign is in an unknown state "${input.from}".` };
  if (input.from === input.to) return { ok: false, error: `Campaign is already ${input.to}.` };
  if (!allowed.includes(input.to)) {
    return {
      ok: false,
      error:
        allowed.length === 0
          ? `A ${input.from} campaign cannot change status.`
          : `A ${input.from} campaign can only move to ${allowed.join(" or ")}.`,
    };
  }
  if (input.to === "active") {
    if (input.stepCount < 1) {
      return { ok: false, error: "This campaign has no steps; add at least one before launching." };
    }
    if (input.stepCount > input.maxSteps) {
      return {
        ok: false,
        error: `This campaign has ${input.stepCount} steps; the max_campaign_steps policy allows ${input.maxSteps}.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Prospect emails are approved only from the Outreach studio, where the
 * operator sees the rendered email, vetting and cited facts. The studio sends
 * `reviewed: true`; the generic approval list does not.
 */
export function checkDecisionGate(input: {
  actionType: string;
  decision: "approve" | "reject";
  reviewed: boolean;
}): GateResult {
  if (input.decision === "approve" && input.actionType === "send_outreach_email" && !input.reviewed) {
    return {
      ok: false,
      error:
        "Prospect emails are approved from the Outreach tab after reviewing the rendered email. Open it there (Review in Outreach).",
    };
  }
  return { ok: true };
}

/**
 * The prospect daily cap has two rows: the operator's base and the effective
 * cap the deliverability guard lowers. Editing one keeps the other coherent:
 * with the guard at ok both move together; while the guard holds the cap
 * down, a new base never raises the effective cap above what it allows.
 */
export function linkedPolicyWrites(input: {
  key: string;
  value: Record<string, unknown>;
  guardStatus: string;
  currentEffective: number;
}): Array<{ key: string; value: Record<string, unknown> }> {
  const emails = Number(input.value.emails);
  if (!Number.isFinite(emails)) return [];
  if (input.key === "max_prospect_emails_per_day_base") {
    const effective = input.guardStatus === "ok" ? emails : Math.min(emails, input.currentEffective);
    return [{ key: "max_prospect_emails_per_day", value: { emails: effective } }];
  }
  if (input.key === "max_prospect_emails_per_day" && input.guardStatus === "ok" && emails >= 1) {
    return [{ key: "max_prospect_emails_per_day_base", value: { emails } }];
  }
  return [];
}

export type TrendUnit = "count" | "percent" | "cents" | "rate";

export interface TrendSeries {
  key: string;
  label: string;
  unit: TrendUnit;
  /** Which direction is good news; the UI colours deltas with it. */
  betterWhen: "higher" | "lower";
  points: Array<{ at: string; value: number }>;
  current: number | null;
  previous7d: number | null;
  delta7d: number | null;
}

export interface OverviewTrends {
  windowDays: number;
  series: TrendSeries[];
}

function dig(source: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = source;
  for (const part of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

const TREND_DEFS: Array<{
  key: string;
  label: string;
  unit: TrendUnit;
  betterWhen: "higher" | "lower";
  path: string[];
}> = [
  { key: "organizations", label: "Organizations", unit: "count", betterWhen: "higher", path: ["organizations", "total"] },
  { key: "paid", label: "Paid organizations", unit: "count", betterWhen: "higher", path: ["organizations", "paidCount"] },
  { key: "mrr", label: "MRR (estimate)", unit: "cents", betterWhen: "higher", path: ["growth", "revenue", "mrrCents"] },
  { key: "activation", label: "Venue activation", unit: "percent", betterWhen: "higher", path: ["venues", "activationRate"] },
  { key: "sessions7d", label: "Galleries started 7d", unit: "count", betterWhen: "higher", path: ["sessions", "created7d"] },
  {
    key: "bounceRate",
    label: "Bounce rate 14d",
    unit: "rate",
    betterWhen: "lower",
    path: ["growth", "deliverability", "window14d", "bounceRate"],
  },
  {
    key: "complaintRate",
    label: "Complaint rate 14d",
    unit: "rate",
    betterWhen: "lower",
    path: ["growth", "deliverability", "window14d", "complaintRate"],
  },
];

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Turn KPI snapshots into daily series for sparklines: one point per UTC day
 * (the latest snapshot that day) over the last `windowDays`, then the live
 * metrics as the final point when given. delta7d compares the current value
 * with the last point at or before seven days ago and is null when history is
 * shorter than that (the UI says so instead of inventing a comparison).
 */
export function buildTrends(
  snapshots: Array<{ createdAt: Date | string; metrics: Record<string, unknown> | null }>,
  options: { now: Date; live?: Record<string, unknown> | null; windowDays?: number },
): OverviewTrends {
  const windowDays = options.windowDays ?? 30;
  const nowMs = options.now.getTime();
  const start = nowMs - windowDays * 86_400_000;
  const byDay = new Map<string, { at: Date; metrics: Record<string, unknown> }>();
  for (const snapshot of snapshots) {
    const at = snapshot.createdAt instanceof Date ? snapshot.createdAt : new Date(snapshot.createdAt);
    const t = at.getTime();
    if (!Number.isFinite(t) || t < start || t > nowMs) continue;
    const day = at.toISOString().slice(0, 10);
    const existing = byDay.get(day);
    if (!existing || existing.at.getTime() < t) byDay.set(day, { at, metrics: snapshot.metrics ?? {} });
  }
  const ordered = [...byDay.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (options.live) ordered.push({ at: options.now, metrics: options.live });
  const weekAgo = nowMs - 7 * 86_400_000;

  const series = TREND_DEFS.map((def): TrendSeries => {
    const points: Array<{ at: string; value: number }> = [];
    let previous7d: number | null = null;
    for (const entry of ordered) {
      const value = finiteNumber(dig(entry.metrics, def.path));
      if (value === null) continue;
      points.push({ at: entry.at.toISOString(), value });
      if (entry.at.getTime() <= weekAgo) previous7d = value;
    }
    const current = points.length > 0 ? points[points.length - 1]!.value : null;
    const delta7d = current !== null && previous7d !== null ? current - previous7d : null;
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      betterWhen: def.betterWhen,
      points,
      current,
      previous7d,
      delta7d,
    };
  });
  return { windowDays, series };
}

export interface OverviewFunnel {
  owners: { signups: number; signups30d: number; activated: number; paid: number; churned: number };
  prospects: {
    total: number;
    vetted: number;
    contacted: number;
    replied: number;
    converted: number;
    unsubscribed: number;
  };
}

async function loadOverviewFunnel(): Promise<OverviewFunnel> {
  const [[owners], [prospects]] = await Promise.all([
    db
      .select({
        signups: sql<number>`count(*)::int`,
        signups30d: sql<number>`count(*) filter (where ${organizationsTable.createdAt} > now() - interval '30 days')::int`,
        activated: sql<number>`count(*) filter (where exists (
          select 1 from ${coupleSessionsTable}
          join ${venuesTable} on ${venuesTable.id} = ${coupleSessionsTable.venueId}
          where ${venuesTable.organizationId} = ${organizationsTable.id}
            and ${coupleSessionsTable.status} = 'ready'
            and ${coupleSessionsTable.kind} <> 'sample'
        ))::int`,
        paid: sql<number>`count(*) filter (where ${organizationsTable.firstPaidAt} is not null or ${organizationsTable.plan} in ('starter', 'growth', 'payg'))::int`,
        churned: sql<number>`count(*) filter (where ${organizationsTable.churnedAt} is not null)::int`,
      })
      .from(organizationsTable),
    db
      .select({
        total: sql<number>`count(*)::int`,
        vetted: sql<number>`count(*) filter (where ${controlProspectsTable.vettingStatus} = 'passed')::int`,
        contacted: sql<number>`count(*) filter (where ${controlProspectsTable.contactCount} > 0 or ${controlProspectsTable.status} in ('contacted', 'replied', 'converted'))::int`,
        replied: sql<number>`count(*) filter (where ${controlProspectsTable.repliedAt} is not null or ${controlProspectsTable.status} in ('replied', 'converted'))::int`,
        converted: sql<number>`count(*) filter (where ${controlProspectsTable.status} = 'converted' or ${controlProspectsTable.convertedAt} is not null)::int`,
        unsubscribed: sql<number>`count(*) filter (where ${controlProspectsTable.status} = 'unsubscribed')::int`,
      })
      .from(controlProspectsTable),
  ]);
  return {
    owners: {
      signups: owners?.signups ?? 0,
      signups30d: owners?.signups30d ?? 0,
      activated: owners?.activated ?? 0,
      paid: owners?.paid ?? 0,
      churned: owners?.churned ?? 0,
    },
    prospects: {
      total: prospects?.total ?? 0,
      vetted: prospects?.vetted ?? 0,
      contacted: prospects?.contacted ?? 0,
      replied: prospects?.replied ?? 0,
      converted: prospects?.converted ?? 0,
      unsubscribed: prospects?.unsubscribed ?? 0,
    },
  };
}

async function loadTrends(live: Record<string, unknown>): Promise<OverviewTrends> {
  const now = new Date();
  const rows = await db
    .select({ createdAt: controlMetricsSnapshotsTable.createdAt, metrics: controlMetricsSnapshotsTable.metrics })
    .from(controlMetricsSnapshotsTable)
    .where(gte(controlMetricsSnapshotsTable.createdAt, new Date(now.getTime() - 31 * 86_400_000)))
    .orderBy(desc(controlMetricsSnapshotsTable.createdAt))
    .limit(400);
  // Live metrics carry no growth KPIs (snapshots do), so the live point only
  // extends the series it has values for.
  return buildTrends(rows, { now, live });
}

/* ————— Overview ————— */

// GET /control/overview — operator cockpit: KPIs, funnel, trends, agents, queue counts.
router.get("/control/overview", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  try {
    const [metrics, agents, [pendingActions], [openTasks], [runningExperiments], [runs24h]] =
      await Promise.all([
        computeBusinessMetrics(),
        db.select().from(controlAgentsTable).orderBy(controlAgentsTable.id),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(agentActionsTable)
          .where(eq(agentActionsTable.status, "pending")),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(agentTasksTable)
          .where(sql`${agentTasksTable.status} in ('open', 'in_progress')`),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(controlExperimentsTable)
          .where(eq(controlExperimentsTable.status, "running")),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(agentRunsTable)
          .where(sql`${agentRunsTable.startedAt} > now() - interval '24 hours'`),
      ]);

    // Funnel and trends are additive: a failure there must not blank the cockpit.
    const [funnel, trends] = await Promise.all([
      loadOverviewFunnel().catch((err: unknown) => {
        logger.warn({ err }, "Control-plane overview funnel failed");
        return null;
      }),
      loadTrends(metrics as unknown as Record<string, unknown>).catch((err: unknown) => {
        logger.warn({ err }, "Control-plane overview trends failed");
        return null;
      }),
    ]);

    const agentRows = agents.map((agent) => {
      const definition = getAgentDefinition(agent.key);
      return {
        key: agent.key,
        name: agent.name,
        domain: agent.domain,
        description: definition?.description ?? "",
        status: agent.status,
        intervalMinutes: agent.intervalMinutes,
        lastRunAt: agent.lastRunAt,
        lastRunStatus: agent.lastRunStatus,
      };
    });

    res.json({
      operatorEmail: operator.email,
      aiConfigured: controlPlaneAiConfigured(),
      model: controlPlaneModel(),
      metrics,
      agents: agentRows,
      counts: {
        pendingActions: pendingActions?.total ?? 0,
        openTasks: openTasks?.total ?? 0,
        runningExperiments: runningExperiments?.total ?? 0,
        runs24h: runs24h?.total ?? 0,
      },
      funnel,
      trends,
    });
  } catch (err) {
    logger.error({ err }, "Control-plane overview failed");
    res.status(500).json({
      error:
        "Control-plane data is unavailable. If this is a fresh deploy, run `pnpm db:push` to create the control-plane tables.",
    });
  }
});

/* ————— Agents ————— */

// POST /control/agents/{key}/run — trigger an agent run now.
router.post("/control/agents/:key/run", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const key = req.params.key;
  if (!getAgentDefinition(key)) {
    res.status(404).json({ error: `Unknown agent "${key}"` });
    return;
  }
  if (!controlPlaneAiConfigured()) {
    res.status(503).json({ error: "XAI_API_KEY is not configured; agents cannot reason." });
    return;
  }

  try {
    const run = await startAgentRun(key, "manual");
    await recordAuditEvent({
      actorType: "operator",
      actor: operator.email,
      eventType: "run_triggered",
      subjectType: "run",
      subjectId: run.id,
      detail: { agentKey: key },
    });
    res.status(202).json({
      run: {
        id: run.id,
        agentKey: run.agentKey,
        trigger: run.trigger,
        status: run.status,
        model: run.model,
        startedAt: run.startedAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start run";
    res.status(409).json({ error: message });
  }
});

// POST /control/agents/{key}/status — pause or resume an agent.
router.post("/control/agents/:key/status", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const parsed = SetControlAgentStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.status;
  if (!AGENT_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of ${AGENT_STATUSES.join(", ")}` });
    return;
  }

  const [agent] = await db
    .update(controlAgentsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(controlAgentsTable.key, req.params.key))
    .returning();
  if (!agent) {
    res.status(404).json({ error: `Unknown agent "${req.params.key}"` });
    return;
  }

  await recordAuditEvent({
    actorType: "operator",
    actor: operator.email,
    eventType: status === "paused" ? "agent_paused" : "agent_resumed",
    subjectType: "agent",
    subjectId: agent.key,
  });

  const definition = getAgentDefinition(agent.key);
  res.json({
    agent: {
      key: agent.key,
      name: agent.name,
      domain: agent.domain,
      description: definition?.description ?? "",
      status: agent.status,
      intervalMinutes: agent.intervalMinutes,
      lastRunAt: agent.lastRunAt,
      lastRunStatus: agent.lastRunStatus,
    },
  });
});

/* ————— Runs ————— */

// GET /control/runs — recent runs, optionally filtered by agent.
router.get("/control/runs", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 30, 100);
  const agentKey = typeof req.query.agentKey === "string" ? req.query.agentKey : null;

  const rows = await db
    .select({
      id: agentRunsTable.id,
      agentKey: agentRunsTable.agentKey,
      trigger: agentRunsTable.trigger,
      status: agentRunsTable.status,
      model: agentRunsTable.model,
      summary: agentRunsTable.summary,
      error: agentRunsTable.error,
      toolCallCount: agentRunsTable.toolCallCount,
      promptTokens: agentRunsTable.promptTokens,
      completionTokens: agentRunsTable.completionTokens,
      startedAt: agentRunsTable.startedAt,
      finishedAt: agentRunsTable.finishedAt,
    })
    .from(agentRunsTable)
    .where(agentKey ? eq(agentRunsTable.agentKey, agentKey) : undefined)
    .orderBy(desc(agentRunsTable.startedAt))
    .limit(limit);
  res.json({ runs: rows });
});

// GET /control/runs/{id} — full run detail including the tool transcript.
router.get("/control/runs/:id", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const [run] = await db.select().from(agentRunsTable).where(eq(agentRunsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json({ run });
});

/* ————— Actions (approval queue) ————— */

// GET /control/actions — governed actions, filterable by status, paged with limit/offset.
// The pending queue is listed oldest first so the longest-waiting decision is on top.
router.get("/control/actions", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 50, 200);
  const offset = parseOffset(req.query.offset);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status && !AGENT_ACTION_STATUSES.includes(status as (typeof AGENT_ACTION_STATUSES)[number])) {
    res.status(400).json({ error: `status must be one of ${AGENT_ACTION_STATUSES.join(", ")}` });
    return;
  }

  const rows = await db
    .select()
    .from(agentActionsTable)
    .where(status ? eq(agentActionsTable.status, status) : undefined)
    .orderBy(
      status === "pending" ? agentActionsTable.createdAt : desc(agentActionsTable.createdAt),
      status === "pending" ? agentActionsTable.id : desc(agentActionsTable.id),
    )
    .limit(limit)
    .offset(offset);
  res.json({ actions: rows });
});

// POST /control/actions/{id}/decision — approve (executes) or reject.
// send_outreach_email approvals must come from the Outreach studio (body.reviewed === true).
router.post("/control/actions/:id/decision", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid action id" });
    return;
  }
  const parsed = DecideControlActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const reviewed = parsed.data.reviewed === true;

  const [existing] = await db
    .select({ actionType: agentActionsTable.actionType })
    .from(agentActionsTable)
    .where(eq(agentActionsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Action not found" });
    return;
  }
  const gate = checkDecisionGate({ actionType: existing.actionType, decision: parsed.data.decision, reviewed });
  if (!gate.ok) {
    res.status(409).json({ error: gate.error, code: "review_in_outreach" });
    return;
  }

  try {
    const action = await decideAction(id, parsed.data.decision, operator.email, parsed.data.note);
    res.json({ action });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Decision failed";
    res.status(409).json({ error: message });
  }
});

/* ————— Tasks ————— */

// GET /control/tasks — agent-raised work items.
router.get("/control/tasks", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 50, 200);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status && !AGENT_TASK_STATUSES.includes(status as (typeof AGENT_TASK_STATUSES)[number])) {
    res.status(400).json({ error: `status must be one of ${AGENT_TASK_STATUSES.join(", ")}` });
    return;
  }

  const rows = await db
    .select()
    .from(agentTasksTable)
    .where(status ? eq(agentTasksTable.status, status) : undefined)
    .orderBy(desc(agentTasksTable.createdAt))
    .limit(limit);
  res.json({ tasks: rows });
});

// POST /control/tasks/{id}/status — operator moves a task through its lifecycle.
router.post("/control/tasks/:id/status", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid task id" });
    return;
  }
  const parsed = SetControlTaskStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.status;
  if (!AGENT_TASK_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of ${AGENT_TASK_STATUSES.join(", ")}` });
    return;
  }

  const [task] = await db
    .update(agentTasksTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(agentTasksTable.id, id))
    .returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await recordAuditEvent({
    actorType: "operator",
    actor: operator.email,
    eventType: "task_status_changed",
    subjectType: "task",
    subjectId: id,
    detail: { status },
  });
  res.json({ task });
});

/* ————— Audit, policies ————— */

// GET /control/audit — the immutable audit trail.
router.get("/control/audit", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 80, 300);
  const rows = await db
    .select()
    .from(controlAuditEventsTable)
    .orderBy(desc(controlAuditEventsTable.createdAt))
    .limit(limit);
  res.json({ events: rows });
});

// GET /control/policies — governance policy limits.
router.get("/control/policies", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  res.json({ policies: await listPolicies() });
});

async function writePolicy(key: string, value: Record<string, unknown>) {
  const description = POLICY_DEFAULTS.find((policy) => policy.key === key)?.description ?? null;
  const [row] = await db
    .insert(controlPoliciesTable)
    .values({ key, value, description })
    .onConflictDoUpdate({ target: controlPoliciesTable.key, set: { value, updatedAt: new Date() } })
    .returning();
  return row ?? null;
}

// PUT /control/policies/{key} — operator edits one policy (validatePolicyUpdate enforces
// field names and bounds; system-managed keys refuse). Every edit is audited with before/after.
router.put("/control/policies/:key", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const key = String(req.params.key ?? "");
  const parsed = UpdateControlPolicyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const validation = validatePolicyUpdate(key, parsed.data.value);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const before = await getPolicy(key);
    const [guard, currentEffective] = await Promise.all([
      getPolicy("deliverability_guard"),
      getPolicyNumber("max_prospect_emails_per_day", "emails", 15),
    ]);
    const linked = linkedPolicyWrites({
      key,
      value: validation.value,
      guardStatus: String((guard as Record<string, unknown> | null)?.status ?? "ok"),
      currentEffective,
    });

    const policy = await writePolicy(key, validation.value);
    if (!policy) {
      res.status(500).json({ error: "The policy could not be saved; try again." });
      return;
    }
    for (const write of linked) await writePolicy(write.key, write.value);

    await recordAuditEvent({
      actorType: "operator",
      actor: operator.email,
      eventType: "policy_updated",
      subjectType: "policy",
      subjectId: key,
      detail: { before, after: validation.value, linked },
    });
    res.json({ policy });
  } catch (err) {
    logger.error({ err, key }, "Policy update failed");
    res.status(500).json({ error: "The policy could not be saved; try again." });
  }
});

/* ————— Campaigns ————— */

async function campaignCounts(campaignId: number | null) {
  return db
    .select({
      campaignId: controlProspectsTable.campaignId,
      status: controlProspectsTable.status,
      total: sql<number>`count(*)::int`,
    })
    .from(controlProspectsTable)
    .where(
      campaignId === null
        ? sql`${controlProspectsTable.campaignId} is not null`
        : eq(controlProspectsTable.campaignId, campaignId),
    )
    .groupBy(controlProspectsTable.campaignId, controlProspectsTable.status);
}

function withCounts(
  campaign: ControlCampaign,
  counts: Array<{ campaignId: number | null; status: string; total: number }>,
) {
  return {
    ...campaign,
    prospectCounts: Object.fromEntries(
      counts.filter((row) => row.campaignId === campaign.id).map((row) => [row.status, row.total]),
    ),
  };
}

// GET /control/campaigns — outreach campaigns with per-status prospect counts.
router.get("/control/campaigns", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 50, 100);
  const [campaigns, counts] = await Promise.all([
    db
      .select()
      .from(controlCampaignsTable)
      .orderBy(desc(controlCampaignsTable.createdAt))
      .limit(limit),
    campaignCounts(null),
  ]);
  res.json({ campaigns: campaigns.map((campaign) => withCounts(campaign, counts)) });
});

// POST /control/campaigns/{id}/status — operator launches, pauses, resumes, or completes a campaign.
// Launching never sends anything: every email still needs its own studio approval.
router.post("/control/campaigns/:id/status", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }
  const parsed = SetControlCampaignStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const target = parsed.data.status;

  const [current] = await db.select().from(controlCampaignsTable).where(eq(controlCampaignsTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const maxSteps = await getPolicyNumber("max_campaign_steps", "steps", 3);
  const gate = checkCampaignTransition({
    from: current.status,
    to: target,
    stepCount: Array.isArray(current.steps) ? current.steps.length : 0,
    maxSteps,
  });
  if (!gate.ok) {
    res.status(409).json({ error: gate.error });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(controlCampaignsTable)
    .set({
      status: target,
      updatedAt: now,
      ...(target === "active" ? { launchedAt: current.launchedAt ?? now } : {}),
      ...(target === "completed" ? { completedAt: now } : {}),
    })
    .where(and(eq(controlCampaignsTable.id, id), eq(controlCampaignsTable.status, current.status)))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "The campaign changed while you were editing it; reload and try again." });
    return;
  }

  // A launch or pause decided here supersedes any agent proposal still waiting for the same campaign.
  const superseded = await db
    .update(agentActionsTable)
    .set({
      status: "rejected",
      decidedBy: operator.email,
      decidedAt: now,
      decisionNote: `superseded: campaign set to ${target} from /control`,
    })
    .where(
      and(
        eq(agentActionsTable.status, "pending"),
        sql`${agentActionsTable.actionType} in ('launch_campaign', 'pause_campaign', 'complete_campaign')`,
        sql`(${agentActionsTable.params} ->> 'campaignId')::int = ${id}`,
      ),
    )
    .returning({ id: agentActionsTable.id });

  await recordAuditEvent({
    actorType: "operator",
    actor: operator.email,
    eventType: "campaign_status_changed",
    subjectType: "campaign",
    subjectId: id,
    detail: {
      from: current.status,
      to: target,
      note: parsed.data.note ?? null,
      supersededActionIds: superseded.map((row) => row.id),
    },
  });
  res.json({ campaign: withCounts(updated, await campaignCounts(id)) });
});

/* ————— Metrics history ————— */

// GET /control/metrics/history — KPI snapshots for trend charts.
router.get("/control/metrics/history", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 60, 200);
  const rows = await db
    .select()
    .from(controlMetricsSnapshotsTable)
    .orderBy(desc(controlMetricsSnapshotsTable.createdAt))
    .limit(limit);
  res.json({ snapshots: rows });
});

export default router;
