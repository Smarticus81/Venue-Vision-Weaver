import { db, coupleSessionsTable, coupleMediaTable } from "@workspace/db";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { logger } from "./logger.js";
import { ObjectStorageService } from "./objectStorage.js";
import { readRetentionDays } from "./publicConfig.js";

/*
 * Couple source-photo retention (funnel-ux.md 10.8, orchestrator consent
 * rules): the photos a couple uploads are deleted COUPLE_PHOTO_RETENTION_DAYS
 * after their gallery was delivered, and couple_sessions.source_photos_deleted_at
 * records that it happened. Generated galleries are untouched. Sessions that
 * never reached "ready" keep their photos until the owner deletes the session
 * or the orphan cleanup in index.ts refunds and removes them.
 */

const DAY_MS = 86_400_000;
export const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
export const RETENTION_SWEEP_BATCH = 50;
const FIRST_SWEEP_DELAY_MS = 90_000;

export interface RetentionCandidate {
  sessionId: number;
  objectKeys: string[];
}

export interface RetentionStore {
  /** Ready sessions delivered before `cutoff` whose source photos are still stored. */
  listDue(cutoff: Date, limit: number): Promise<RetentionCandidate[]>;
  deleteObject(objectKey: string): Promise<void>;
  /** Remove the couple_media rows and stamp source_photos_deleted_at in one step. */
  markDeleted(sessionId: number, deletedAt: Date): Promise<void>;
}

export interface RetentionSweepResult {
  candidates: number;
  sessionsCleared: number;
  objectsDeleted: number;
  objectsFailed: number;
}

/** Delivery timestamps on or before this instant are due for deletion. */
export function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - Math.max(1, retentionDays) * DAY_MS);
}

/**
 * One sweep. A session is stamped only when every one of its objects was
 * deleted (or was already gone); a failed delete leaves the session for the
 * next run so nothing is marked deleted while bytes still exist.
 */
export async function runPhotoRetentionSweep(
  store: RetentionStore,
  options: { now?: Date; retentionDays?: number; limit?: number } = {},
): Promise<RetentionSweepResult> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? readRetentionDays();
  const due = await store.listDue(retentionCutoff(now, retentionDays), options.limit ?? RETENTION_SWEEP_BATCH);
  const result: RetentionSweepResult = { candidates: due.length, sessionsCleared: 0, objectsDeleted: 0, objectsFailed: 0 };

  for (const candidate of due) {
    let failed = false;
    for (const objectKey of candidate.objectKeys) {
      try {
        await store.deleteObject(objectKey);
        result.objectsDeleted += 1;
      } catch (err) {
        failed = true;
        result.objectsFailed += 1;
        logger.warn({ err, sessionId: candidate.sessionId, objectKey }, "Retention sweep could not delete a couple photo");
      }
    }
    if (failed) continue;
    await store.markDeleted(candidate.sessionId, now);
    result.sessionsCleared += 1;
  }
  return result;
}

export function createDbRetentionStore(storage = new ObjectStorageService()): RetentionStore {
  return {
    async listDue(cutoff, limit) {
      const sessions = await db
        .select({ id: coupleSessionsTable.id })
        .from(coupleSessionsTable)
        .where(
          and(
            eq(coupleSessionsTable.status, "ready"),
            isNull(coupleSessionsTable.sourcePhotosDeletedAt),
            lt(coupleSessionsTable.completedAt, cutoff),
          ),
        )
        .orderBy(coupleSessionsTable.completedAt)
        .limit(limit);
      if (sessions.length === 0) return [];
      const ids = sessions.map((row) => row.id);
      const media = await db
        .select({ sessionId: coupleMediaTable.sessionId, objectKey: coupleMediaTable.objectKey })
        .from(coupleMediaTable)
        .where(inArray(coupleMediaTable.sessionId, ids));
      const byId = new Map<number, string[]>(ids.map((id) => [id, []]));
      for (const row of media) byId.get(row.sessionId)?.push(row.objectKey);
      return ids.map((sessionId) => ({ sessionId, objectKeys: byId.get(sessionId) ?? [] }));
    },
    deleteObject: (objectKey) => storage.deleteObjectEntity(objectKey),
    async markDeleted(sessionId, deletedAt) {
      await db.transaction(async (tx) => {
        await tx.delete(coupleMediaTable).where(eq(coupleMediaTable.sessionId, sessionId));
        await tx
          .update(coupleSessionsTable)
          .set({ sourcePhotosDeletedAt: deletedAt })
          .where(eq(coupleSessionsTable.id, sessionId));
      });
    },
  };
}

let timer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

async function sweepSafely(store: RetentionStore): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const result = await runPhotoRetentionSweep(store);
    if (result.candidates > 0) logger.info(result, "Photo retention sweep finished");
  } catch (err) {
    logger.error({ err }, "Photo retention sweep failed");
  } finally {
    sweeping = false;
  }
}

/** Boot hook (index.ts): first sweep shortly after start, then hourly. Idempotent. */
export function startPhotoRetentionSweep(store: RetentionStore = createDbRetentionStore()): void {
  if (timer) return;
  logger.info({ retentionDays: readRetentionDays() }, "Photo retention sweep scheduled");
  setTimeout(() => void sweepSafely(store), FIRST_SWEEP_DELAY_MS).unref?.();
  timer = setInterval(() => void sweepSafely(store), RETENTION_SWEEP_INTERVAL_MS);
  timer.unref?.();
}
