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
  AGENT_TASK_STATUSES,
  AGENT_ACTION_STATUSES,
  AGENT_STATUSES,
  PROSPECT_STATUSES,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  SetControlAgentStatusBody,
  DecideControlActionBody,
  SetControlTaskStatusBody,
  SetControlProspectStatusBody,
  UpdateControlOutreachEmailBody,
  RegenerateControlOutreachEmailBody,
  DraftControlOutreachEmailBody,
} from "@workspace/api-zod";
import { requireOperator } from "../control-plane/operatorAuth.js";
import { requireOwnerMutationOrigin } from "../lib/orgAuth.js";
import { getAgentDefinition, AGENT_DEFINITIONS } from "../control-plane/agents.js";
import { computeBusinessMetrics } from "../control-plane/metrics.js";
import { startAgentRun } from "../control-plane/runner.js";
import { decideAction } from "../control-plane/actions.js";
import { listPolicies } from "../control-plane/policies.js";
import { controlPlaneAiConfigured, controlPlaneModel } from "../control-plane/grok.js";
import { recordAuditEvent } from "../control-plane/audit.js";
import {
  createDraft,
  ensureResearch,
  getEmailDetail,
  listEmails,
  loadProspectAssets,
  loadProspectById,
  regenerateEmail,
  updateEmail,
} from "../control-plane/outreach/studio.js";
import { publicObjectUrl, samplePreviewsEnabled } from "../control-plane/outreach/config.js";
import { OUTREACH_EMAIL_STATUSES } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/* ————— Overview ————— */

// GET /control/overview — operator cockpit: KPIs, agents, queue counts.
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

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
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

// GET /control/actions — governed actions, filterable by status.
router.get("/control/actions", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 50, 200);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status && !AGENT_ACTION_STATUSES.includes(status as (typeof AGENT_ACTION_STATUSES)[number])) {
    res.status(400).json({ error: `status must be one of ${AGENT_ACTION_STATUSES.join(", ")}` });
    return;
  }

  const rows = await db
    .select()
    .from(agentActionsTable)
    .where(status ? eq(agentActionsTable.status, status) : undefined)
    .orderBy(desc(agentActionsTable.createdAt))
    .limit(limit);
  res.json({ actions: rows });
});

// POST /control/actions/{id}/decision — approve (executes) or reject.
router.post("/control/actions/:id/decision", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid action id" });
    return;
  }
  const parsed = DecideControlActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
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

/* ————— Experiments, audit, policies, metrics history ————— */

// GET /control/experiments — the experiment portfolio.
router.get("/control/experiments", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 50, 200);
  const rows = await db
    .select()
    .from(controlExperimentsTable)
    .orderBy(desc(controlExperimentsTable.createdAt))
    .limit(limit);
  res.json({ experiments: rows });
});

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

/* ————— Prospect pipeline + campaigns ————— */

// GET /control/prospects — the prospect pipeline, filterable by status/campaign.
router.get("/control/prospects", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 50, 200);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status && !PROSPECT_STATUSES.includes(status as (typeof PROSPECT_STATUSES)[number])) {
    res.status(400).json({ error: `status must be one of ${PROSPECT_STATUSES.join(", ")}` });
    return;
  }
  const campaignId = Number(req.query.campaignId);

  const conditions = [];
  if (status) conditions.push(eq(controlProspectsTable.status, status));
  if (Number.isInteger(campaignId) && campaignId > 0) {
    conditions.push(eq(controlProspectsTable.campaignId, campaignId));
  }

  const rows = await db
    .select()
    .from(controlProspectsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(controlProspectsTable.updatedAt))
    .limit(limit);
  res.json({ prospects: rows });
});

// Operators record outcomes agents cannot observe (inbound email is human-read):
// replies, conversions, unsubscribes — plus re-staging. "contacted" is reserved
// for the governed send action so contact bookkeeping stays truthful.
const OPERATOR_PROSPECT_STATUSES = [
  "new",
  "qualified",
  "replied",
  "converted",
  "unsubscribed",
  "disqualified",
] as const;

// POST /control/prospects/{id}/status — record a prospect outcome.
router.post("/control/prospects/:id/status", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid prospect id" });
    return;
  }
  const parsed = SetControlProspectStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.status;
  if (!OPERATOR_PROSPECT_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of ${OPERATOR_PROSPECT_STATUSES.join(", ")}` });
    return;
  }

  const [prospect] = await db
    .update(controlProspectsTable)
    .set({ status, statusChangedBy: operator.email, updatedAt: new Date() })
    .where(eq(controlProspectsTable.id, id))
    .returning();
  if (!prospect) {
    res.status(404).json({ error: "Prospect not found" });
    return;
  }

  await recordAuditEvent({
    actorType: "operator",
    actor: operator.email,
    eventType: "prospect_status_changed",
    subjectType: "prospect",
    subjectId: id,
    detail: { status },
  });
  res.json({ prospect });
});

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
    db
      .select({
        campaignId: controlProspectsTable.campaignId,
        status: controlProspectsTable.status,
        total: sql<number>`count(*)::int`,
      })
      .from(controlProspectsTable)
      .where(sql`${controlProspectsTable.campaignId} is not null`)
      .groupBy(controlProspectsTable.campaignId, controlProspectsTable.status),
  ]);
  res.json({
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      prospectCounts: Object.fromEntries(
        counts.filter((row) => row.campaignId === campaign.id).map((row) => [row.status, row.total]),
      ),
    })),
  });
});

/* ————— Outreach email studio ————— */

function parseId(raw: string, res: import("express").Response, label: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: `Invalid ${label} id` });
    return null;
  }
  return id;
}

function studioError(res: import("express").Response, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : fallback;
  const status = /not found/i.test(message) ? 404 : 409;
  res.status(status).json({ error: message });
}

// GET /control/outreach/emails — studio emails with prospect + approval state.
router.get("/control/outreach/emails", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const limit = parseLimit(req.query.limit, 50, 200);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status && !OUTREACH_EMAIL_STATUSES.includes(status as (typeof OUTREACH_EMAIL_STATUSES)[number])) {
    res.status(400).json({ error: `status must be one of ${OUTREACH_EMAIL_STATUSES.join(", ")}` });
    return;
  }
  const prospectId = Number(req.query.prospectId);
  const emails = await listEmails({
    status,
    prospectId: Number.isInteger(prospectId) && prospectId > 0 ? prospectId : null,
    limit,
  });
  res.json({ emails });
});

// GET /control/outreach/emails/{id} — full review payload with rendered previews.
router.get("/control/outreach/emails/:id", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "email");
  if (!id) return;
  const detail = await getEmailDetail(id);
  if (!detail) {
    res.status(404).json({ error: "Outreach email not found" });
    return;
  }
  res.json({ detail });
});

// POST /control/outreach/emails/{id} — operator edits (subject, copy, images, CTA).
router.post("/control/outreach/emails/:id", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "email");
  if (!id) return;
  const parsed = UpdateControlOutreachEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const detail = await updateEmail(id, parsed.data, operator.email);
    res.json({ detail });
  } catch (err) {
    studioError(res, err, "Update failed");
  }
});

// POST /control/outreach/emails/{id}/regenerate — rewrite copy and/or re-run research.
router.post("/control/outreach/emails/:id/regenerate", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "email");
  if (!id) return;
  const parsed = RegenerateControlOutreachEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if ((parsed.data.mode === "copy" || parsed.data.mode === "both") && !controlPlaneAiConfigured()) {
    res.status(503).json({ error: "XAI_API_KEY is not configured; copy cannot be regenerated (research still can)." });
    return;
  }
  try {
    const detail = await regenerateEmail(id, parsed.data.mode, operator.email, { ask: parsed.data.ask });
    res.json({ detail });
  } catch (err) {
    studioError(res, err, "Regeneration failed");
  }
});

// POST /control/outreach/emails/{id}/sample-preview — operator-only hook for a labeled
// Dreemer sample image. Generation is not wired in this build; the request is audited
// and refused so the UI can show the honest state.
router.post("/control/outreach/emails/:id/sample-preview", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "email");
  if (!id) return;
  const detail = await getEmailDetail(id);
  if (!detail) {
    res.status(404).json({ error: "Outreach email not found" });
    return;
  }
  await recordAuditEvent({
    actorType: "operator",
    actor: operator.email,
    eventType: "sample_preview_requested",
    subjectType: "outreach_email",
    subjectId: id,
    detail: { enabled: samplePreviewsEnabled() },
  });
  res.status(501).json({
    error: samplePreviewsEnabled()
      ? "Sample previews are enabled but the generation path is not available in this build."
      : "Sample previews are not enabled (OUTREACH_SAMPLE_PREVIEWS=on). The hook is in place; generation lands in a follow-up.",
  });
});

// POST /control/prospects/{id}/draft — operator-initiated studio draft (still gated by approval).
router.post("/control/prospects/:id/draft", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "prospect");
  if (!id) return;
  const parsed = DraftControlOutreachEmailBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await createDraft({
      prospectId: id,
      ask: parsed.data.ask,
      campaignId: parsed.data.campaignId ?? null,
      step: parsed.data.step ?? null,
      agentKey: "operator",
      runId: null,
      actor: `operator:${operator.email}`,
      forceResearch: parsed.data.refreshResearch === true,
    });
    const detail = await getEmailDetail(result.email.id);
    res.status(201).json({ detail });
  } catch (err) {
    studioError(res, err, "Draft failed");
  }
});

// POST /control/prospects/{id}/research — re-run the venue website research.
router.post("/control/prospects/:id/research", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "prospect");
  if (!id) return;
  const prospect = await loadProspectById(id);
  if (!prospect) {
    res.status(404).json({ error: "Prospect not found" });
    return;
  }
  try {
    const result = await ensureResearch(prospect, { force: true, actor: `operator:${operator.email}` });
    const assets = await loadProspectAssets(id);
    res.json({
      research: {
        status: result.research.status,
        facts: result.research.facts,
        sourceUrls: result.research.sourceUrls,
        warnings: result.research.warnings,
        fetchedAt: result.research.fetchedAt,
      },
      assets: assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        url: publicObjectUrl(asset.objectKey),
        sourceUrl: asset.sourceUrl,
        pageUrl: asset.pageUrl,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
        altText: asset.altText,
        score: asset.score,
        selected: asset.selected,
        inEmail: false,
        createdAt: asset.createdAt,
      })),
    });
  } catch (err) {
    studioError(res, err, "Research failed");
  }
});

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
