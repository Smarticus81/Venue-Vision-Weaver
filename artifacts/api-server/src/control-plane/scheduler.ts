import { db, controlAgentsTable, agentRunsTable, agentActionsTable } from "@workspace/db";
import { and, asc, eq, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { AGENT_DEFINITIONS, AGENT_KEYS } from "./agents.js";
import { ensurePolicyDefaults } from "./policies.js";
import { snapshotMetrics, latestSnapshotAgeMinutes, type MetricsSnapshot } from "./metrics.js";
import { ACTION_CATALOG, executeAction, recoverStaleExecutingActions } from "./actions.js";
import { startAgentRun, isRunInProgress, providerBackoffRemainingMs } from "./runner.js";
import { controlPlaneAiConfigured } from "./grok.js";
import { runAdaptationRules } from "./growth/adaptation.js";
import { maybeRunAttribution } from "./growth/attribution.js";
import { runGrowthBackfills } from "./growth/backfill.js";
import { growthLoopEnabled } from "./growth/config.js";
import { maybeGenerateWeeklyDigest, maybeSendAgingApprovalsNudge } from "./growth/digest.js";
import { runExperimentDecisions, type ExperimentSnapshot } from "./growth/experiments.js";
import { agentRunGate, drainCutoff, retireLegacyActions, runRetention } from "./growth/governance.js";
import type { GrowthKpis } from "./growth/kpiTypes.js";
import { runTrialClock } from "./growth/trialClock.js";

/*
 * The control-plane worker: one in-process poller that drains approved
 * actions, keeps the KPI trend line, runs the growth loop's deterministic
 * steps (evaluator, adaptation rules, trial clock, attribution, digest,
 * nudge, retention) and starts the next due agent. Every growth step is
 * guarded so one failure never stops the others; a missing table pauses the
 * worker until the schema is pushed.
 */

const POLL_MS = 60_000;
const SNAPSHOT_INTERVAL_MINUTES = Number(process.env.CONTROL_PLANE_SNAPSHOT_MINUTES ?? "360");
/** How many approved actions one tick executes. */
const DRAIN_BATCH = 5;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let disabledByMissingSchema = false;
let lastGateLog: { reason: string; at: number } | null = null;

export function controlPlaneEnabled(): boolean {
  return process.env.CONTROL_PLANE_ENABLED !== "off";
}

/** Mirror the code-defined agent registry into control_agents rows (name, domain and interval re-synced on every boot). */
async function seedAgents(): Promise<void> {
  for (const definition of AGENT_DEFINITIONS) {
    await db
      .insert(controlAgentsTable)
      .values({
        key: definition.key,
        name: definition.name,
        domain: definition.domain,
        intervalMinutes: definition.intervalMinutes,
      })
      .onConflictDoUpdate({
        target: controlAgentsTable.key,
        set: {
          name: definition.name,
          domain: definition.domain,
          intervalMinutes: definition.intervalMinutes,
          updatedAt: new Date(),
        },
      });
  }
  // Agents removed from the registry (e.g. the experiments agent, replaced by
  // growth) can never run again; drop their rows so the scheduler does not
  // pick dead keys. Their runs/tasks/actions keep the historical agentKey.
  const retired = await db
    .delete(controlAgentsTable)
    .where(notInArray(controlAgentsTable.key, AGENT_KEYS))
    .returning({ key: controlAgentsTable.key });
  if (retired.length > 0) {
    logger.info({ keys: retired.map((r) => r.key) }, "Retired control-plane agents not in registry");
  }
}

/** Runs interrupted by a restart can never finish; fail them explicitly. */
async function failOrphanedRuns(): Promise<void> {
  const orphaned = await db
    .update(agentRunsTable)
    .set({
      status: "failed",
      error: "Server restarted while the run was in progress.",
      finishedAt: new Date(),
    })
    .where(eq(agentRunsTable.status, "running"))
    .returning({ id: agentRunsTable.id });
  if (orphaned.length > 0) {
    logger.warn({ runIds: orphaned.map((r) => r.id) }, "Marked orphaned control-plane runs as failed on startup");
  }
}

/**
 * Execute operator-approved actions that have not run yet. Only rows whose
 * approval is at least two minutes old are picked up: decideAction and
 * proposeAction execute inline right after approving, so a fresh row is
 * normally already running in another call stack. Rows in "executing" (the
 * atomic claim the executor takes) are never selected, so an action can
 * never run twice.
 */
async function drainApprovedActions(now: Date): Promise<void> {
  const cutoff = drainCutoff(now);
  const approved = await db
    .select({ id: agentActionsTable.id })
    .from(agentActionsTable)
    .where(
      and(
        eq(agentActionsTable.status, "approved"),
        or(lt(agentActionsTable.decidedAt, cutoff), and(isNull(agentActionsTable.decidedAt), lt(agentActionsTable.createdAt, cutoff))),
      ),
    )
    .orderBy(asc(agentActionsTable.createdAt))
    .limit(DRAIN_BATCH);
  for (const action of approved) {
    try {
      await executeAction(action.id, "system:scheduler");
    } catch (err) {
      logger.error({ err, actionId: action.id }, "Approved action execution threw");
    }
  }
}

async function maybeSnapshotMetrics(): Promise<MetricsSnapshot | null> {
  const age = await latestSnapshotAgeMinutes();
  if (age !== null && age < SNAPSHOT_INTERVAL_MINUTES) return null;
  const snapshot = await snapshotMetrics();
  logger.info({ snapshotId: snapshot.snapshotId, growth: Boolean(snapshot.metrics.growth) }, "Captured control-plane metrics snapshot");
  return snapshot;
}

function logGateOnce(reason: string, now: Date): void {
  if (lastGateLog && lastGateLog.reason === reason && now.getTime() - lastGateLog.at < 3_600_000) return;
  lastGateLog = { reason, at: now.getTime() };
  logger.warn({ reason }, "Agent runs are held by a kill switch");
}

/** Start the next due agent (active + interval elapsed), one at a time. */
async function maybeRunDueAgent(now: Date): Promise<void> {
  if (!controlPlaneAiConfigured() || isRunInProgress()) return;
  if (providerBackoffRemainingMs(now) > 0) return;
  const gate = await agentRunGate(now);
  if (!gate.ok) {
    logGateOnce(gate.reason, now);
    return;
  }

  const dueAgents = await db
    .select({
      key: controlAgentsTable.key,
      lastRunAt: controlAgentsTable.lastRunAt,
      intervalMinutes: controlAgentsTable.intervalMinutes,
    })
    .from(controlAgentsTable)
    .where(
      sql`${controlAgentsTable.status} = 'active' and (${controlAgentsTable.lastRunAt} is null or ${controlAgentsTable.lastRunAt} < now() - (${controlAgentsTable.intervalMinutes} * interval '1 minute'))`,
    )
    .orderBy(
      // Never-run agents first, then whoever has waited longest past due.
      sql`${controlAgentsTable.lastRunAt} asc nulls first`,
    )
    .limit(1);

  const due = dueAgents[0];
  if (!due) return;

  try {
    const run = await startAgentRun(due.key, "schedule");
    logger.info({ agentKey: due.key, runId: run.id }, "Scheduler started control-plane agent run");
  } catch (err) {
    logger.error({ err, agentKey: due.key }, "Scheduler failed to start agent run");
  }
}

function isMissingSchemaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /relation .* does not exist|42P01/i.test(message);
}

/** One growth-loop step: logged on failure, never fatal for the tick (a missing table still pauses the worker). */
async function guarded(step: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isMissingSchemaError(err)) throw err;
    logger.error({ err, step }, "Growth loop step failed");
  }
}

async function tick(now: Date = new Date()): Promise<void> {
  await guarded("stale_executing_actions", async () => {
    const interrupted = await recoverStaleExecutingActions(15, now);
    if (interrupted > 0) logger.warn({ interrupted }, "Failed actions left executing by an interrupted process");
  });
  await drainApprovedActions(now);
  const snapshot = await maybeSnapshotMetrics();
  if (snapshot?.metrics.growth) {
    const growth: GrowthKpis = snapshot.metrics.growth;
    await guarded("experiment_decisions", () => runExperimentDecisions(snapshot.metrics as ExperimentSnapshot, snapshot.snapshotId, now));
    if (growthLoopEnabled()) {
      await guarded("adaptation_rules", () => runAdaptationRules(growth, snapshot.snapshotId, now));
    }
  }
  if (growthLoopEnabled()) {
    await guarded("trial_clock", () => runTrialClock(now)); // hourly inside
    await guarded("attribution", () => maybeRunAttribution(now)); // hourly inside
    await guarded("weekly_digest", () => maybeGenerateWeeklyDigest(now));
    await guarded("aging_approvals_nudge", () => maybeSendAgingApprovalsNudge(now));
  }
  await guarded("retention", () => runRetention(now)); // nightly inside
  await maybeRunDueAgent(now);
}

function safeTick(): void {
  if (ticking || disabledByMissingSchema) return;
  ticking = true;
  tick()
    .catch((err) => {
      if (isMissingSchemaError(err)) {
        disabledByMissingSchema = true;
        logger.error(
          { err },
          "Control-plane tables are missing — run `pnpm db:push` to create them. Worker paused until restart.",
        );
        return;
      }
      logger.error({ err }, "Control-plane worker poll failed");
    })
    .finally(() => {
      ticking = false;
    });
}

export function startControlPlaneWorker(): void {
  if (pollTimer) return;
  if (!controlPlaneEnabled()) {
    logger.warn("Control plane disabled via CONTROL_PLANE_ENABLED=off");
    return;
  }

  void (async () => {
    try {
      await seedAgents();
      await ensurePolicyDefaults();
      await failOrphanedRuns();
      // E8: pending/approved rows of retired action types can never execute; reject them with the retirement note.
      await retireLegacyActions(ACTION_CATALOG);
      // Rows a crashed process left in "executing" are failed (never re-run:
      // the side effect may already have happened) so an operator can check.
      const interrupted = await recoverStaleExecutingActions();
      if (interrupted > 0) logger.warn({ interrupted }, "Failed actions interrupted by a restart");
      // Growth backfills are idempotent and never throw.
      await runGrowthBackfills();
    } catch (err) {
      if (isMissingSchemaError(err)) {
        disabledByMissingSchema = true;
        logger.error(
          { err },
          "Control-plane tables are missing — run `pnpm db:push` to create them. Worker paused until restart.",
        );
        return;
      }
      logger.error({ err }, "Control-plane worker startup failed");
    }
    if (!controlPlaneAiConfigured()) {
      logger.warn(
        "XAI_API_KEY not set — control-plane agents stay idle; approvals, metrics snapshots and the growth loop still run",
      );
    }
    if (!growthLoopEnabled()) {
      logger.warn("GROWTH_LOOP_ENABLED=off — trial clock, attribution, adaptation rules and digests are paused; KPI snapshots still run");
    }
    safeTick();
    pollTimer = setInterval(safeTick, POLL_MS);
    logger.info(
      { agents: AGENT_DEFINITIONS.length, snapshotIntervalMinutes: SNAPSHOT_INTERVAL_MINUTES, growthLoop: growthLoopEnabled() },
      "Autonomous Business Control Plane worker started",
    );
  })();
}
