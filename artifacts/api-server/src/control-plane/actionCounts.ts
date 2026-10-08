import { db, agentActionsTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

/**
 * Daily action counters shared by the core catalog and the growth catalog.
 * Lives outside actions.ts so growth/actions.ts can import it without an
 * import cycle (actions.ts imports growth/actions.ts).
 */
export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Number of actions of one type that executed successfully today (UTC). */
export async function executedTodayCount(actionType: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentActionsTable)
    .where(
      and(
        eq(agentActionsTable.actionType, actionType),
        eq(agentActionsTable.status, "executed"),
        gte(agentActionsTable.executedAt, startOfUtcDay()),
      ),
    );
  return row?.total ?? 0;
}
