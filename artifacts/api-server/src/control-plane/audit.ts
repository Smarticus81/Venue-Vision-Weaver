import { db, controlAuditEventsTable, type AuditActorType } from "@workspace/db";
import { lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * Append-only audit trail. Every agent decision, operator approval, and
 * system-side execution lands here; failures to audit must never break the
 * underlying operation.
 */
export async function recordAuditEvent(event: {
  actorType: AuditActorType;
  actor: string;
  eventType: string;
  subjectType?: string;
  subjectId?: string | number;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(controlAuditEventsTable).values({
      actorType: event.actorType,
      actor: event.actor,
      eventType: event.eventType,
      subjectType: event.subjectType ?? null,
      subjectId: event.subjectId != null ? String(event.subjectId) : null,
      detail: event.detail ?? null,
    });
  } catch (err) {
    logger.error({ err, event: event.eventType }, "Failed to record control-plane audit event");
  }
}

export const DEFAULT_AUDIT_RETENTION_DAYS = 180;

/**
 * Retention: drop audit rows older than the window (default 180 days). Returns
 * the number of rows removed; never throws (the nightly job logs and moves on).
 */
export async function pruneAuditEvents(
  olderThanDays = DEFAULT_AUDIT_RETENTION_DAYS,
  now = new Date(),
): Promise<number> {
  const days = Math.max(1, Math.floor(olderThanDays));
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  try {
    const removed = await db
      .delete(controlAuditEventsTable)
      .where(lt(controlAuditEventsTable.createdAt, cutoff))
      .returning({ id: controlAuditEventsTable.id });
    if (removed.length > 0) {
      logger.info({ count: removed.length, days }, "Pruned control-plane audit events");
    }
    return removed.length;
  } catch (err) {
    logger.error({ err, days }, "Failed to prune control-plane audit events");
    return 0;
  }
}

/** Audit rows written in the last `days` days (for the governance briefing). */
export async function countRecentAuditEvents(days: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - Math.max(1, days) * 86_400_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(controlAuditEventsTable)
    .where(sql`${controlAuditEventsTable.createdAt} >= ${cutoff}`);
  return row?.count ?? 0;
}
