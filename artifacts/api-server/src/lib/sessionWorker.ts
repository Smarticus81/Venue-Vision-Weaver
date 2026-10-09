import { logger } from "./logger.js";
import { SessionDeadlineError } from "./stillImageErrors.js";

/*
 * In-process gallery worker. Every charged session must end ready or refunded
 * within SESSION_DEADLINE_MS:
 *   - each job races a deadline; when it fires, the job's AbortSignal stops
 *     in-flight provider calls, the session is marked failed (couple-safe
 *     timeout copy) and refunded, and the worker slot is released at once;
 *   - a reaper (every REAP_INTERVAL_MS) fails and refunds sessions left in
 *     processing past deadline + grace by a crashed or redeployed process.
 * The pipeline's failure path is guarded on status=processing, so the
 * deadline, the reaper and the job itself can race without double refunds.
 */

const DEFAULT_DEADLINE_MS = 15 * 60_000;
const DEFAULT_MAX_CONCURRENT = 2;
const POLL_MS = 2000;
const REAP_INTERVAL_MS = 60_000;
/** Extra wait past the deadline before the reaper treats a row as orphaned. */
export const REAPER_GRACE_MS = 60_000;

type EnvLike = Record<string, string | undefined>;

export function sessionDeadlineMsFromEnv(env: EnvLike = process.env): number {
  const parsed = Number(env.SESSION_DEADLINE_MS ?? DEFAULT_DEADLINE_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DEADLINE_MS;
  return Math.max(60_000, Math.min(60 * 60_000, Math.round(parsed)));
}

export function maxConcurrentSessionsFromEnv(env: EnvLike = process.env): number {
  const parsed = Number(env.GALLERY_MAX_CONCURRENT ?? DEFAULT_MAX_CONCURRENT);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_CONCURRENT;
  return Math.max(1, Math.min(8, Math.round(parsed)));
}

export interface SessionWorkerDeps {
  listPendingIds(limit: number): Promise<number[]>;
  processSession(sessionId: number, options: { signal: AbortSignal }): Promise<void>;
  /** Fail + refund one session (guarded: no-op unless it is still processing). */
  failSession(sessionId: number, err: SessionDeadlineError): Promise<void>;
  /** Fail + refund processing rows older than cutoff, except excludeIds. Returns the ids reaped. */
  reapStale(cutoff: Date, excludeIds: number[], err: SessionDeadlineError): Promise<number[]>;
  now(): number;
}

export interface SessionWorkerConfig {
  maxConcurrent: number;
  deadlineMs: number;
  reapIntervalMs?: number;
}

export interface SessionWorker {
  tick(): Promise<void>;
  /** Run one session under the deadline (exposed for tests). */
  runJob(sessionId: number): Promise<void>;
  stats(): { running: number; inFlight: number[] };
}

export function createSessionWorker(deps: SessionWorkerDeps, config: SessionWorkerConfig): SessionWorker {
  const reapIntervalMs = config.reapIntervalMs ?? REAP_INTERVAL_MS;
  let running = 0;
  const inFlight = new Set<number>();
  let lastReapAt = Number.NEGATIVE_INFINITY;

  async function runJob(sessionId: number): Promise<void> {
    running += 1;
    inFlight.add(sessionId);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = deps.processSession(sessionId, { signal: controller.signal });
      // The job may settle after the deadline; never leave that rejection unhandled.
      work.catch(() => {});
      const deadline = new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), config.deadlineMs);
      });
      const outcome = await Promise.race([work.then(() => "done" as const), deadline]);
      if (outcome === "deadline") {
        const err = new SessionDeadlineError(config.deadlineMs);
        logger.error({ sessionId, deadlineMs: config.deadlineMs }, "Gallery session hit its deadline; failing and refunding");
        controller.abort(err);
        await deps.failSession(sessionId, err);
      }
    } catch (err) {
      logger.error({ err, sessionId }, "Session worker job threw");
    } finally {
      if (timer) clearTimeout(timer);
      inFlight.delete(sessionId);
      running -= 1;
    }
  }

  async function reap(): Promise<void> {
    const now = deps.now();
    if (now - lastReapAt < reapIntervalMs) return;
    lastReapAt = now;
    const cutoff = new Date(now - config.deadlineMs - REAPER_GRACE_MS);
    const reaped = await deps.reapStale(cutoff, [...inFlight], new SessionDeadlineError(config.deadlineMs));
    if (reaped.length > 0) {
      logger.warn({ count: reaped.length, ids: reaped }, "Reaped gallery sessions stuck in processing past the deadline");
    }
  }

  async function tick(): Promise<void> {
    try {
      await reap();
    } catch (err) {
      logger.error({ err }, "Session reaper failed");
    }
    if (running >= config.maxConcurrent) return;
    const queued = await deps.listPendingIds(20);
    for (const id of queued) {
      if (running >= config.maxConcurrent) break;
      if (inFlight.has(id)) continue;
      void runJob(id);
    }
  }

  return {
    tick,
    runJob,
    stats: () => ({ running, inFlight: [...inFlight] }),
  };
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let starting = false;

export function startSessionWorker(): void {
  if (pollTimer || starting) return;
  starting = true;
  bootSessionWorker()
    .catch((err) => logger.error({ err }, "Session generation worker failed to start"))
    .finally(() => {
      starting = false;
    });
}

async function bootSessionWorker(): Promise<void> {
  // Loaded lazily so the worker core (and its tests) never pulls in the DB.
  const pipeline = await import("./gallerySessionPipeline.js");
  const { db, coupleSessionsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const config = {
    maxConcurrent: maxConcurrentSessionsFromEnv(),
    deadlineMs: sessionDeadlineMsFromEnv(),
  };
  const worker = createSessionWorker(
    {
      listPendingIds: pipeline.listPendingSessionIds,
      processSession: (sessionId, options) => pipeline.processSession(sessionId, options),
      async failSession(sessionId, err) {
        const [row] = await db
          .select({
            id: coupleSessionsTable.id,
            venueId: coupleSessionsTable.venueId,
            kind: coupleSessionsTable.kind,
            startedAt: coupleSessionsTable.startedAt,
          })
          .from(coupleSessionsTable)
          .where(eq(coupleSessionsTable.id, sessionId));
        if (row) await pipeline.failSession(row, err);
      },
      reapStale: pipeline.reapStaleSessions,
      now: () => Date.now(),
    },
    config,
  );

  const safeTick = () => {
    // A failed poll (e.g. a transient DB outage) must never become an
    // unhandled rejection - that would crash the whole server. Log and let
    // the next interval retry.
    worker.tick().catch((err) => {
      logger.error({ err }, "Session worker poll failed");
    });
  };
  logger.info(config, "Session generation worker started");
  safeTick();
  pollTimer = setInterval(safeTick, POLL_MS);
}
