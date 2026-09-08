import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../logger.js";

/**
 * The control plane ships ahead of its migration on any deployment that has
 * not run `pnpm run db:push` yet. Rather than 500ing every ops request (or,
 * worse, crashing the tick worker in a loop), every entry point checks once
 * whether the tables exist and degrades to a clear "not migrated" state.
 */

export const CONTROL_PLANE_TABLES = [
  "control_plane_agents",
  "control_plane_signals",
  "control_plane_runs",
  "control_plane_decisions",
  "control_plane_policies",
  "control_plane_audit",
  "control_plane_experiments",
  "control_plane_experiment_assignments",
  "control_plane_experiment_events",
  "control_plane_tickets",
  "control_plane_leads",
  "control_plane_work_items",
  "control_plane_metrics",
  "control_plane_memory",
] as const;

type TableRow = { table_name: string };

let cachedReady: boolean | null = null;
let cachedMissing: string[] = [];

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = (result as { rows?: unknown })?.rows;
  return Array.isArray(maybe) ? (maybe as T[]) : [];
}

export async function controlPlaneMissingTables(force = false): Promise<string[]> {
  if (!force && cachedReady !== null) return cachedMissing;
  try {
    const names = sql.join(
      CONTROL_PLANE_TABLES.map((table) => sql`${table}`),
      sql`, `,
    );
    const result = await db.execute<TableRow>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in (${names})`,
    );
    const found = new Set(rows<TableRow>(result).map((row) => row.table_name));
    cachedMissing = CONTROL_PLANE_TABLES.filter((table) => !found.has(table));
    cachedReady = cachedMissing.length === 0;
    if (!cachedReady) {
      logger.warn(
        { missing: cachedMissing },
        "Control plane tables are missing — run `pnpm run db:push` to enable the autonomous control plane",
      );
    }
    return cachedMissing;
  } catch (err) {
    logger.error({ err }, "Could not inspect control plane schema");
    cachedReady = false;
    cachedMissing = [...CONTROL_PLANE_TABLES];
    return cachedMissing;
  }
}

export async function isControlPlaneReady(): Promise<boolean> {
  return (await controlPlaneMissingTables()).length === 0;
}

/** Called after a migration so a running process picks the tables up. */
export function resetControlPlaneSchemaCache(): void {
  cachedReady = null;
  cachedMissing = [];
}
