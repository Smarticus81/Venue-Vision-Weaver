import { and, eq, lte, or, sql } from "drizzle-orm";
import { db, organizationsTable, controlPlaneAgentsTable } from "@workspace/db";
import { logger } from "../logger.js";
import { runControlPlaneTick } from "./engine.js";
import { isControlPlaneReady } from "./schemaGuard.js";
import { ensureFleet } from "./registry.js";

/**
 * The heartbeat. One poller for the whole process: it finds organisations
 * with at least one agent due, ticks them one at a time, and gets out of the
 * way. Deliberately serial — the fleet is not latency-sensitive, and a
 * runaway tick loop is a far worse failure than a late one.
 */

const POLL_MS = Number(process.env.CONTROL_PLANE_POLL_MS ?? "60000");
const MAX_ORGS_PER_TICK = Number(process.env.CONTROL_PLANE_MAX_ORGS_PER_TICK ?? "5");
const ENABLED = process.env.CONTROL_PLANE_WORKER !== "off";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Organisations with an enabled agent whose next run is due (or unset). */
async function dueOrganizationIds(now: Date): Promise<number[]> {
  const rows = await db
    .selectDistinct({ organizationId: controlPlaneAgentsTable.organizationId })
    .from(controlPlaneAgentsTable)
    .where(
      and(
        eq(controlPlaneAgentsTable.enabled, true),
        or(
          sql`${controlPlaneAgentsTable.nextRunAt} is null`,
          lte(controlPlaneAgentsTable.nextRunAt, now),
        ),
      ),
    )
    .limit(MAX_ORGS_PER_TICK);
  return rows.map((row) => row.organizationId);
}

/**
 * Organisations that have never been touched by the control plane get their
 * fleet on the next poll rather than waiting for someone to open the console.
 */
async function provisionNewOrganizations(): Promise<void> {
  const rows = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(
      sql`not exists (select 1 from control_plane_agents a where a.organization_id = ${organizationsTable.id})`,
    )
    .limit(MAX_ORGS_PER_TICK);
  for (const row of rows) {
    await ensureFleet(row.id);
  }
}

async function tick(): Promise<void> {
  if (running) return;
  if (!(await isControlPlaneReady())) return;
  running = true;
  try {
    await provisionNewOrganizations();
    const now = new Date();
    const organizationIds = await dueOrganizationIds(now);
    for (const organizationId of organizationIds) {
      try {
        const result = await runControlPlaneTick(organizationId);
        if (result.ran.length) {
          logger.info(
            {
              organizationId,
              agents: result.ran.map((entry) => entry.agentKey),
              executed: result.ran.reduce((sum, entry) => sum + entry.executed, 0),
              proposed: result.ran.reduce((sum, entry) => sum + entry.proposed, 0),
            },
            "Control plane tick completed",
          );
        }
      } catch (err) {
        logger.error({ err, organizationId }, "Control plane tick failed for organization");
      }
    }
  } finally {
    running = false;
  }
}

function safeTick(): void {
  // A failed poll must never surface as an unhandled rejection — that would
  // take the whole API server down with it.
  tick().catch((err) => {
    logger.error({ err }, "Control plane worker poll failed");
  });
}

export function startControlPlaneWorker(): void {
  if (timer) return;
  if (!ENABLED) {
    logger.info("Control plane worker disabled by CONTROL_PLANE_WORKER=off");
    return;
  }
  logger.info({ pollMs: POLL_MS, maxOrgsPerTick: MAX_ORGS_PER_TICK }, "Control plane worker started");
  safeTick();
  timer = setInterval(safeTick, POLL_MS);
}

export function stopControlPlaneWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Clear a run that was in flight when the process restarted. */
export async function recoverInFlightRuns(): Promise<void> {
  try {
    if (!(await isControlPlaneReady())) return;
    const rows = await db
      .update(controlPlaneAgentsTable)
      .set({ status: "idle", nextRunAt: new Date() })
      .where(eq(controlPlaneAgentsTable.status, "running"))
      .returning({ id: controlPlaneAgentsTable.id });
    if (rows.length) {
      logger.warn({ count: rows.length }, "Reset control plane agents left running by a restart");
    }
    await db.execute(sql`
      update control_plane_runs
         set status = 'failed',
             finished_at = now(),
             error = 'Server restarted during the run'
       where status = 'running'
         and started_at < now() - interval '15 minutes'
    `);
  } catch (err) {
    logger.error({ err }, "Could not recover in-flight control plane runs");
  }
}
