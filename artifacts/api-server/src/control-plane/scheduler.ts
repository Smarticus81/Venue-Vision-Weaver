import { db, controlAgentsTable, agentRunsTable, agentActionsTable } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { AGENT_DEFINITIONS } from "./agents.js";
import { ensurePolicyDefaults } from "./policies.js";
import { snapshotMetrics, latestSnapshotAgeMinutes } from "./metrics.js";
import { executeAction } from "./actions.js";
import { startAgentRun, isRunInProgress } from "./runner.js";
import { controlPlaneAiConfigured } from "./gemini.js";

const POLL_MS = 60_000;
const SNAPSHOT_INTERVAL_MINUTES = Number(process.env.CONTROL_PLANE_SNAPSHOT_MINUTES ?? "360");

let pollTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let disabledByMissingSchema = false;

export function controlPlaneEnabled(): boolean {
  return process.env.CONTROL_PLANE_ENABLED !== "off";
}

/** Mirror the code-defined agent registry into control_agents rows. */
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
          updatedAt: new Date(),
        },
      });
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
    logger.warn(
      { runIds: orphaned.map((r) => r.id) },
      "Marked orphaned control-plane runs as failed on startup",
    );
  }
}

/** Execute operator-approved actions that have not run yet. */
async function drainApprovedActions(): Promise<void> {
  const approved = await db
    .select({ id: agentActionsTable.id })
    .from(agentActionsTable)
    .where(eq(agentActionsTable.status, "approved"))
    .orderBy(asc(agentActionsTable.createdAt))
    .limit(5);
  for (const action of approved) {
    try {
      await executeAction(action.id, "system:scheduler");
    } catch (err) {
      logger.error({ err, actionId: action.id }, "Approved action execution threw");
    }
  }
}

async function maybeSnapshotMetrics(): Promise<void> {
  const age = await latestSnapshotAgeMinutes();
  if (age === null || age >= SNAPSHOT_INTERVAL_MINUTES) {
    await snapshotMetrics();
    logger.info("Captured control-plane metrics snapshot");
  }
}

/** Start the next due agent (active + interval elapsed), one at a time. */
async function maybeRunDueAgent(): Promise<void> {
  if (!controlPlaneAiConfigured() || isRunInProgress()) return;

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

async function tick(): Promise<void> {
  await drainApprovedActions();
  await maybeSnapshotMetrics();
  await maybeRunDueAgent();
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
        "GOOGLE_AI_API_KEY not set — control-plane agents cannot reason; approvals and metrics snapshots still run",
      );
    }
    safeTick();
    pollTimer = setInterval(safeTick, POLL_MS);
    logger.info(
      { agents: AGENT_DEFINITIONS.length, snapshotIntervalMinutes: SNAPSHOT_INTERVAL_MINUTES },
      "Autonomous Business Control Plane worker started",
    );
  })();
}
