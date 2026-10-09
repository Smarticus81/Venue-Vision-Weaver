const DEFAULT_UPLOAD_INTENT_CLEANUP_BATCH_SIZE = 100;
const MIN_UPLOAD_INTENT_CLEANUP_BATCH_SIZE = 10;
const MAX_UPLOAD_INTENT_CLEANUP_BATCH_SIZE = 1000;
const DEFAULT_UPLOAD_INTENT_CLEANUP_INTERVAL_MINUTES = 15;
const MIN_UPLOAD_INTENT_CLEANUP_INTERVAL_MINUTES = 1;
const MAX_UPLOAD_INTENT_CLEANUP_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_UPLOAD_INTENT_VENUE_DAILY_CAP = 300;
const MIN_UPLOAD_INTENT_VENUE_DAILY_CAP = 20;
const MAX_UPLOAD_INTENT_VENUE_DAILY_CAP = 5000;
const DEFAULT_UPLOAD_INTENT_COUPLE_HOURLY_CAP = 60;
const MIN_UPLOAD_INTENT_COUPLE_HOURLY_CAP = 6;
const MAX_UPLOAD_INTENT_COUPLE_HOURLY_CAP = 1000;

function clampedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

export function uploadIntentCleanupBatchSize(env: NodeJS.ProcessEnv = process.env): number {
  return clampedInteger(
    env.UPLOAD_INTENT_CLEANUP_BATCH_SIZE,
    DEFAULT_UPLOAD_INTENT_CLEANUP_BATCH_SIZE,
    MIN_UPLOAD_INTENT_CLEANUP_BATCH_SIZE,
    MAX_UPLOAD_INTENT_CLEANUP_BATCH_SIZE,
  );
}

/** How often the server sweeps expired, unconsumed upload intents and their objects. */
export function uploadIntentCleanupIntervalMinutes(env: NodeJS.ProcessEnv = process.env): number {
  return clampedInteger(
    env.UPLOAD_INTENT_CLEANUP_INTERVAL_MINUTES,
    DEFAULT_UPLOAD_INTENT_CLEANUP_INTERVAL_MINUTES,
    MIN_UPLOAD_INTENT_CLEANUP_INTERVAL_MINUTES,
    MAX_UPLOAD_INTENT_CLEANUP_INTERVAL_MINUTES,
  );
}

/** Upload intents one venue may mint per rolling day (owner and couple uploads together). */
export function uploadIntentVenueDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  return clampedInteger(
    env.UPLOAD_INTENT_VENUE_DAILY_CAP,
    DEFAULT_UPLOAD_INTENT_VENUE_DAILY_CAP,
    MIN_UPLOAD_INTENT_VENUE_DAILY_CAP,
    MAX_UPLOAD_INTENT_VENUE_DAILY_CAP,
  );
}

/** Couple-purpose intents one venue may mint per rolling hour (anyone with the slug can ask). */
export function uploadIntentCoupleHourlyCap(env: NodeJS.ProcessEnv = process.env): number {
  return clampedInteger(
    env.UPLOAD_INTENT_COUPLE_HOURLY_CAP,
    DEFAULT_UPLOAD_INTENT_COUPLE_HOURLY_CAP,
    MIN_UPLOAD_INTENT_COUPLE_HOURLY_CAP,
    MAX_UPLOAD_INTENT_COUPLE_HOURLY_CAP,
  );
}
