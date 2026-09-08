import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  controlPlaneAgentsTable,
  controlPlaneAuditTable,
  controlPlaneDecisionsTable,
  controlPlaneMemoryTable,
  controlPlaneMetricsTable,
  controlPlaneRunsTable,
} from "@workspace/db";
import {
  evaluateProposal,
  planTick,
  runAgent,
  stateOfBusiness,
  type AgentContext,
  type AgentOutput,
  type BusinessSnapshot,
  type ControlPlanePolicy,
  type DecisionEffect,
  type DecisionProposal,
  type Observation,
} from "@workspace/control-plane";
import { logger } from "../logger.js";
import { loadPolicy } from "./policyStore.js";
import { ensureFleet, resetExpiredBudgets, syncFleetMetadata } from "./registry.js";
import { buildBusinessSnapshot, loadAgentMemory, loadOpenDecisions } from "./snapshot.js";
import { executeEffect } from "./executor.js";
import { isControlPlaneReady } from "./schemaGuard.js";
import { narrateRun, narrationEnabled } from "./narrator.js";

const HOUR_MS = 3_600_000;

export interface AgentTickResult {
  agentKey: string;
  status: "succeeded" | "failed";
  runId: number | null;
  summary: string;
  proposed: number;
  executed: number;
  held: number;
  rejected: number;
  error: string | null;
}

export interface TickResult {
  organizationId: number;
  ran: AgentTickResult[];
  skipped: { agentKey: string; reason: string }[];
  headline: string;
  narrative: string;
  ready: boolean;
}

/** Count of decisions this org has executed automatically today. */
async function autoExecutionsToday(organizationId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(controlPlaneDecisionsTable)
    .where(
      and(
        eq(controlPlaneDecisionsTable.organizationId, organizationId),
        eq(controlPlaneDecisionsTable.status, "executed"),
        sql`${controlPlaneDecisionsTable.executedAt} >= date_trunc('day', now())`,
        eq(controlPlaneDecisionsTable.requiresApproval, false),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Retire decisions nobody acted on, so the queue reflects live conditions. */
export async function expireStaleDecisions(
  organizationId: number,
  policy: ControlPlanePolicy,
): Promise<number> {
  const cutoff = new Date(Date.now() - policy.decisionTtlHours * HOUR_MS);
  const rows = await db
    .update(controlPlaneDecisionsTable)
    .set({ status: "expired", decidedAt: new Date(), decidedBy: "system" })
    .where(
      and(
        eq(controlPlaneDecisionsTable.organizationId, organizationId),
        eq(controlPlaneDecisionsTable.status, "proposed"),
        lt(controlPlaneDecisionsTable.createdAt, cutoff),
      ),
    )
    .returning({ id: controlPlaneDecisionsTable.id });
  return rows.length;
}

async function recordMetrics(
  organizationId: number,
  metrics: AgentOutput["metrics"],
): Promise<void> {
  if (!metrics.length) return;
  const today = new Date().toISOString().slice(0, 10);
  for (const metric of metrics) {
    await db
      .insert(controlPlaneMetricsTable)
      .values({
        organizationId,
        metricDate: today,
        metricKey: metric.metricKey,
        value: metric.value,
        dimensions: metric.dimensions ?? {},
      })
      .onConflictDoUpdate({
        target: [
          controlPlaneMetricsTable.organizationId,
          controlPlaneMetricsTable.metricDate,
          controlPlaneMetricsTable.metricKey,
        ],
        set: { value: metric.value, dimensions: metric.dimensions ?? {} },
      });
  }
}

async function recordMemory(
  organizationId: number,
  agentKey: string,
  notes: AgentOutput["memory"],
): Promise<void> {
  if (!notes.length) return;
  await db.insert(controlPlaneMemoryTable).values(
    notes.map((note) => ({
      organizationId,
      agentKey,
      kind: note.kind,
      content: note.content,
      importance: note.importance,
      tags: note.tags,
    })),
  );
}

interface PersistedDecision {
  id: number;
  autoExecute: boolean;
  effect: DecisionEffect;
  proposal: DecisionProposal;
}

/**
 * Store one proposal as a decision. The dedupe key is unique per org, so a
 * standing condition updates its existing open decision instead of stacking
 * a new one every tick — and a decision a human already rejected is not
 * silently resurrected.
 */
async function persistProposal(
  organizationId: number,
  agentKey: string,
  domain: string,
  runId: number,
  proposal: DecisionProposal,
  verdict: ReturnType<typeof evaluateProposal>,
): Promise<PersistedDecision | null> {
  const expiresAt = proposal.expiresInHours
    ? new Date(Date.now() + proposal.expiresInHours * HOUR_MS)
    : null;

  const [inserted] = await db
    .insert(controlPlaneDecisionsTable)
    .values({
      organizationId,
      runId,
      agentKey,
      domain,
      kind: proposal.kind,
      title: proposal.title,
      rationale: proposal.rationale,
      evidence: proposal.evidence ?? {},
      effect: proposal.effect as unknown as Record<string, unknown>,
      confidence: proposal.confidence,
      impactScore: proposal.impactScore,
      riskLevel: verdict.riskLevel,
      requiresApproval: verdict.requiresApproval,
      blockedReason: verdict.holdReason,
      dedupeKey: proposal.dedupeKey,
      expiresAt,
    })
    .onConflictDoNothing({
      target: [controlPlaneDecisionsTable.organizationId, controlPlaneDecisionsTable.dedupeKey],
    })
    .returning({ id: controlPlaneDecisionsTable.id });

  if (inserted) {
    return {
      id: inserted.id,
      autoExecute: !verdict.requiresApproval,
      effect: proposal.effect,
      proposal,
    };
  }

  // An existing decision holds this key. Refresh a still-open one so the
  // operator sees current numbers; leave anything already decided alone.
  const [refreshed] = await db
    .update(controlPlaneDecisionsTable)
    .set({
      runId,
      title: proposal.title,
      rationale: proposal.rationale,
      evidence: proposal.evidence ?? {},
      effect: proposal.effect as unknown as Record<string, unknown>,
      confidence: proposal.confidence,
      impactScore: proposal.impactScore,
      riskLevel: verdict.riskLevel,
      blockedReason: verdict.holdReason,
      expiresAt,
    })
    .where(
      and(
        eq(controlPlaneDecisionsTable.organizationId, organizationId),
        eq(controlPlaneDecisionsTable.dedupeKey, proposal.dedupeKey),
        eq(controlPlaneDecisionsTable.status, "proposed"),
      ),
    )
    .returning({ id: controlPlaneDecisionsTable.id });

  return refreshed ? { id: refreshed.id, autoExecute: false, effect: proposal.effect, proposal } : null;
}

async function markExecuted(
  decisionId: number,
  result: { ok: boolean; detail: Record<string, unknown>; error?: string },
): Promise<void> {
  await db
    .update(controlPlaneDecisionsTable)
    .set({
      status: result.ok ? "executed" : "failed",
      executedAt: new Date(),
      executionResult: result.ok ? result.detail : { ...result.detail, error: result.error },
      decidedBy: "control-plane",
      decidedAt: new Date(),
    })
    .where(eq(controlPlaneDecisionsTable.id, decisionId));
}

/** Run one agent end to end and persist everything it produced. */
async function runOneAgent(
  organizationId: number,
  agentRow: typeof controlPlaneAgentsTable.$inferSelect,
  definition: Parameters<typeof runAgent>[0],
  snapshot: BusinessSnapshot,
  policy: ControlPlanePolicy,
  trigger: string,
  orgAutoBudgetRemaining: { value: number },
): Promise<{ result: AgentTickResult; observations: Observation[] }> {
  const now = new Date();
  const [run] = await db
    .insert(controlPlaneRunsTable)
    .values({
      organizationId,
      agentKey: agentRow.agentKey,
      domain: agentRow.domain,
      trigger,
      status: "running",
      startedAt: now,
    })
    .returning({ id: controlPlaneRunsTable.id });

  await db
    .update(controlPlaneAgentsTable)
    .set({ status: "running", updatedAt: now })
    .where(eq(controlPlaneAgentsTable.id, agentRow.id));

  const [memory, openDecisions] = await Promise.all([
    loadAgentMemory(organizationId, agentRow.agentKey, now),
    loadOpenDecisions(organizationId, now),
  ]);

  const ctx: AgentContext = {
    now,
    snapshot,
    agent: {
      agentKey: agentRow.agentKey,
      autonomy: agentRow.autonomy as AgentContext["agent"]["autonomy"],
      enabled: agentRow.enabled,
      actionsRemainingToday: Math.max(0, agentRow.dailyActionBudget - agentRow.actionsToday),
      config: agentRow.config,
    },
    memory,
    openDecisions,
  };

  const { output, error } = runAgent(definition, ctx);

  if (!output) {
    const finishedAt = new Date();
    await db
      .update(controlPlaneRunsTable)
      .set({
        status: "failed",
        finishedAt,
        durationMs: finishedAt.getTime() - now.getTime(),
        error,
      })
      .where(eq(controlPlaneRunsTable.id, run.id));
    await db
      .update(controlPlaneAgentsTable)
      .set({
        status: "error",
        lastError: error,
        lastRunAt: finishedAt,
        nextRunAt: new Date(finishedAt.getTime() + agentRow.intervalMinutes * 60_000),
        healthScore: Math.max(0, agentRow.healthScore - 0.25),
        updatedAt: finishedAt,
      })
      .where(eq(controlPlaneAgentsTable.id, agentRow.id));
    logger.error({ agentKey: agentRow.agentKey, organizationId, error }, "Control plane agent run failed");
    return {
      result: {
        agentKey: agentRow.agentKey,
        status: "failed",
        runId: run.id,
        summary: "Run failed",
        proposed: 0,
        executed: 0,
        held: 0,
        rejected: 0,
        error,
      },
      observations: [],
    };
  }

  await Promise.all([
    recordMetrics(organizationId, output.metrics),
    recordMemory(organizationId, agentRow.agentKey, output.memory),
  ]);

  let proposed = 0;
  let executed = 0;
  let held = 0;
  let rejected = 0;
  let actionsSpent = 0;

  for (const proposal of output.proposals) {
    const verdict = evaluateProposal(proposal, {
      policy,
      autonomy: agentRow.autonomy as AgentContext["agent"]["autonomy"],
      agentEnabled: agentRow.enabled,
      agentBudgetRemaining: agentRow.dailyActionBudget - agentRow.actionsToday - actionsSpent,
      orgAutoBudgetRemaining: orgAutoBudgetRemaining.value,
    });

    if (!verdict.admissible) {
      rejected += 1;
      logger.debug(
        { agentKey: agentRow.agentKey, kind: proposal.kind, reason: verdict.rejectReason },
        "Control plane proposal refused by policy",
      );
      continue;
    }

    const persisted = await persistProposal(
      organizationId,
      agentRow.agentKey,
      agentRow.domain,
      run.id,
      proposal,
      verdict,
    );
    if (!persisted) continue;
    proposed += 1;

    if (!persisted.autoExecute) {
      held += 1;
      continue;
    }

    const result = await executeEffect(persisted.effect, {
      organizationId,
      actor: agentRow.agentKey,
      actorType: "agent",
      policy,
      decisionId: persisted.id,
    });
    await markExecuted(persisted.id, result);
    if (result.ok) {
      executed += 1;
      actionsSpent += 1;
      orgAutoBudgetRemaining.value -= 1;
    } else {
      logger.warn(
        { agentKey: agentRow.agentKey, decisionId: persisted.id, error: result.error },
        "Control plane decision execution failed",
      );
    }
  }

  const narrative = narrationEnabled()
    ? await narrateRun(agentRow.agentKey, definition.charter, output, snapshot)
    : null;

  const finishedAt = new Date();
  await db
    .update(controlPlaneRunsTable)
    .set({
      status: "succeeded",
      finishedAt,
      durationMs: finishedAt.getTime() - now.getTime(),
      observations: output.observations,
      proposedCount: proposed,
      executedCount: executed,
      summary: output.summary,
      narrative,
    })
    .where(eq(controlPlaneRunsTable.id, run.id));

  await db
    .update(controlPlaneAgentsTable)
    .set({
      status: "idle",
      lastError: null,
      lastRunAt: finishedAt,
      nextRunAt: new Date(finishedAt.getTime() + agentRow.intervalMinutes * 60_000),
      actionsToday: agentRow.actionsToday + actionsSpent,
      healthScore: Math.min(1, agentRow.healthScore + 0.1),
      updatedAt: finishedAt,
    })
    .where(eq(controlPlaneAgentsTable.id, agentRow.id));

  return {
    result: {
      agentKey: agentRow.agentKey,
      status: "succeeded",
      runId: run.id,
      summary: output.summary,
      proposed,
      executed,
      held,
      rejected,
      error: null,
    },
    observations: output.observations,
  };
}

export interface TickOptions {
  /** Run one named agent regardless of its schedule. */
  forceAgentKey?: string;
  trigger?: string;
  maxAgents?: number;
}

/**
 * One pass of the control plane for one organisation: refresh the fleet,
 * snapshot the business, run every agent that is due, and apply whatever
 * policy allows to run on its own.
 */
export async function runControlPlaneTick(
  organizationId: number,
  options: TickOptions = {},
): Promise<TickResult> {
  if (!(await isControlPlaneReady())) {
    return {
      organizationId,
      ran: [],
      skipped: [],
      headline: "Control plane schema is not migrated",
      narrative:
        "The control plane tables do not exist yet. Run `pnpm run db:push` to create them, then the fleet starts on its own.",
      ready: false,
    };
  }

  await ensureFleet(organizationId);
  await syncFleetMetadata(organizationId);
  await resetExpiredBudgets(organizationId);

  const policy = await loadPolicy(organizationId);
  await expireStaleDecisions(organizationId, policy);

  const agentRows = await db
    .select()
    .from(controlPlaneAgentsTable)
    .where(eq(controlPlaneAgentsTable.organizationId, organizationId));

  const now = new Date();
  const plan = planTick(
    agentRows.map((row) => ({
      agentKey: row.agentKey,
      enabled: row.enabled,
      nextRunAt: row.nextRunAt,
      status: row.status,
    })),
    now,
    { forceAgentKey: options.forceAgentKey, maxAgents: options.maxAgents },
  );

  if (!plan.due.length) {
    const snapshot = await buildBusinessSnapshot(organizationId, {
      reviewSlaHours: policy.reviewSlaHours,
      now,
    });
    const state = stateOfBusiness(snapshot, []);
    return {
      organizationId,
      ran: [],
      skipped: plan.skipped,
      headline: state.headline,
      narrative: state.narrative,
      ready: true,
    };
  }

  const snapshot = await buildBusinessSnapshot(organizationId, {
    reviewSlaHours: policy.reviewSlaHours,
    now,
  });

  const orgAutoBudgetRemaining = {
    value: Math.max(0, policy.maxAutoExecutionsPerDay - (await autoExecutionsToday(organizationId))),
  };

  const ran: AgentTickResult[] = [];
  const allObservations: Observation[] = [];
  const byKey = new Map(agentRows.map((row) => [row.agentKey, row]));

  for (const scheduled of plan.due) {
    const agentRow = byKey.get(scheduled.agentKey);
    if (!agentRow) continue;
    try {
      const { result, observations } = await runOneAgent(
        organizationId,
        agentRow,
        scheduled.definition,
        snapshot,
        policy,
        options.trigger ?? (options.forceAgentKey ? "manual" : "schedule"),
        orgAutoBudgetRemaining,
      );
      ran.push(result);
      allObservations.push(...observations);
    } catch (err) {
      logger.error(
        { err, agentKey: scheduled.agentKey, organizationId },
        "Control plane agent tick threw outside the agent",
      );
      ran.push({
        agentKey: scheduled.agentKey,
        status: "failed",
        runId: null,
        summary: "Tick failed",
        proposed: 0,
        executed: 0,
        held: 0,
        rejected: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const state = stateOfBusiness(snapshot, allObservations);

  await db.insert(controlPlaneAuditTable).values({
    organizationId,
    actorType: "system",
    actor: "control-plane",
    action: "tick.completed",
    subjectType: "organization",
    subjectId: String(organizationId),
    detail: {
      agents: ran.map((entry) => entry.agentKey),
      executed: ran.reduce((sum, entry) => sum + entry.executed, 0),
      proposed: ran.reduce((sum, entry) => sum + entry.proposed, 0),
      trigger: options.trigger ?? "schedule",
    },
  });

  return {
    organizationId,
    ran,
    skipped: plan.skipped,
    headline: state.headline,
    narrative: state.narrative,
    ready: true,
  };
}

/**
 * Execute a decision a human approved. Policy is re-evaluated at this moment:
 * an approval from yesterday does not survive a kill switch engaged since.
 */
export async function executeApprovedDecision(
  organizationId: number,
  decisionId: number,
  actor: string,
): Promise<{ ok: boolean; error?: string; detail?: Record<string, unknown> }> {
  const policy = await loadPolicy(organizationId);
  const [decision] = await db
    .select()
    .from(controlPlaneDecisionsTable)
    .where(
      and(
        eq(controlPlaneDecisionsTable.id, decisionId),
        eq(controlPlaneDecisionsTable.organizationId, organizationId),
        inArray(controlPlaneDecisionsTable.status, ["proposed", "approved"]),
      ),
    );
  if (!decision) return { ok: false, error: "Decision is not open" };

  const result = await executeEffect(decision.effect as unknown as DecisionEffect, {
    organizationId,
    actor,
    actorType: "human",
    policy,
    decisionId: decision.id,
  });
  await markExecuted(decision.id, result);
  await db.insert(controlPlaneAuditTable).values({
    organizationId,
    actorType: "human",
    actor,
    action: result.ok ? "decision.executed" : "decision.execution_failed",
    subjectType: "decision",
    subjectId: String(decision.id),
    detail: { title: decision.title, error: result.error ?? null },
  });
  return { ok: result.ok, error: result.error, detail: result.detail };
}
