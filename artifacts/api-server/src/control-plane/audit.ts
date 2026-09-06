import { db, controlAuditEventsTable, type AuditActorType } from "@workspace/db";
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
