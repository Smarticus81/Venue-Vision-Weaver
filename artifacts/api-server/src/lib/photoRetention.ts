import { db, coupleSessionsTable, coupleMediaTable, generatedAssetsTable } from "@workspace/db";
import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { ObjectStorageService } from "./objectStorage.js";
import { readRetentionDays } from "./publicConfig.js";

/*
 * Couple source-photo retention (funnel-ux.md 10.8, orchestrator consent
 * rules): the photos a couple uploads are deleted COUPLE_PHOTO_RETENTION_DAYS
 * after their gallery was delivered, and couple_sessions.source_photos_deleted_at
 * records that it happened. Delivered (ready) galleries are untouched.
 * Sessions that never reached "ready" (failed, or stuck and never reaped) are
 * swept on the same window, keyed on completed_at or else created_at: their
 * couple photos AND their generated frames (kept only for a retry, never
 * delivered, and showing the couple's likeness) are deleted, and
 * source_photos_deleted_at is stamped so a later requeue is refused.
 */

const DAY_MS = 86_400_000;
export const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
export const RETENTION_SWEEP_BATCH = 50;
const FIRST_SWEEP_DELAY_MS = 90_000;

export interface RetentionCandidate {
  sessionId: number;
  objectKeys: string[];
  /** Never-delivered session: its generated frames are deleted too (and listed in objectKeys). */
  purgeGenerated?: boolean;
}

export interface RetentionStore {
  /**
   * Sessions whose source photos are still stored and that are past the
   * window: ready ones delivered before `cutoff`, and never-ready ones
   * (failed, stuck) that ended, or were created, before `cutoff`.
   */
  listDue(cutoff: Date, limit: number): Promise<RetentionCandidate[]>;
  deleteObject(objectKey: string): Promise<void>;
  /** Remove the couple_media rows (and generated_assets when purging) and stamp source_photos_deleted_at in one step. */
  markDeleted(sessionId: number, deletedAt: Date, options?: { purgeGenerated?: boolean }): Promise<void>;
}

/** Where clause for listDue: ready past delivery + window, or never-ready past end/creation + window. */
export function retentionDueWhere(cutoff: Date) {
  return and(
    isNull(coupleSessionsTable.sourcePhotosDeletedAt),
    or(
      and(eq(coupleSessionsTable.status, "ready"), lt(coupleSessionsTable.completedAt, cutoff)),
      and(
        ne(coupleSessionsTable.status, "ready"),
        lt(sql`coalesce(${coupleSessionsTable.completedAt}, ${coupleSessionsTable.createdAt})`, cutoff),
      ),
    ),
  );
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
    await store.markDeleted(candidate.sessionId, now, { purgeGenerated: candidate.purgeGenerated === true });
    result.sessionsCleared += 1;
  }
  return result;
}

export function createDbRetentionStore(storage = new ObjectStorageService()): RetentionStore {
  return {
    async listDue(cutoff, limit) {
      const sessions = await db
        .select({ id: coupleSessionsTable.id, status: coupleSessionsTable.status })
        .from(coupleSessionsTable)
        .where(retentionDueWhere(cutoff))
        .orderBy(sql`coalesce(${coupleSessionsTable.completedAt}, ${coupleSessionsTable.createdAt})`)
        .limit(limit);
      if (sessions.length === 0) return [];
      const ids = sessions.map((row) => row.id);
      const purgeIds = sessions.filter((row) => row.status !== "ready").map((row) => row.id);
      const media = await db
        .select({ sessionId: coupleMediaTable.sessionId, objectKey: coupleMediaTable.objectKey })
        .from(coupleMediaTable)
        .where(inArray(coupleMediaTable.sessionId, ids));
      const byId = new Map<number, string[]>(ids.map((id) => [id, []]));
      for (const row of media) byId.get(row.sessionId)?.push(row.objectKey);
      if (purgeIds.length > 0) {
        const frames = await db
          .select({ sessionId: generatedAssetsTable.sessionId, objectKey: generatedAssetsTable.objectKey })
          .from(generatedAssetsTable)
          .where(inArray(generatedAssetsTable.sessionId, purgeIds));
        for (const row of frames) byId.get(row.sessionId)?.push(row.objectKey);
      }
      const purge = new Set(purgeIds);
      return ids.map((sessionId) => ({
        sessionId,
        objectKeys: byId.get(sessionId) ?? [],
        purgeGenerated: purge.has(sessionId),
      }));
    },
    deleteObject: (objectKey) => storage.deleteObjectEntity(objectKey),
    async markDeleted(sessionId, deletedAt, options = {}) {
      await db.transaction(async (tx) => {
        await tx.delete(coupleMediaTable).where(eq(coupleMediaTable.sessionId, sessionId));
        if (options.purgeGenerated) {
          await tx.delete(generatedAssetsTable).where(eq(generatedAssetsTable.sessionId, sessionId));
        }
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
