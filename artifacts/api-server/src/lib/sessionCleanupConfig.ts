const DEFAULT_STALE_PROCESSING_MINUTES = 90;
const MIN_STALE_PROCESSING_MINUTES = 15;
const MAX_STALE_PROCESSING_MINUTES = 24 * 60;
const DEFAULT_UPLOAD_INTENT_CLEANUP_BATCH_SIZE = 100;
const MIN_UPLOAD_INTENT_CLEANUP_BATCH_SIZE = 10;
const MAX_UPLOAD_INTENT_CLEANUP_BATCH_SIZE = 1000;
const DEFAULT_OWNER_AUTH_CLEANUP_BATCH_SIZE = 500;
const MIN_OWNER_AUTH_CLEANUP_BATCH_SIZE = 50;
const MAX_OWNER_AUTH_CLEANUP_BATCH_SIZE = 5000;

export function staleProcessingSessionMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STALE_PROCESSING_SESSION_MINUTES?.trim();
  if (!raw) return DEFAULT_STALE_PROCESSING_MINUTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_PROCESSING_MINUTES;

  const rounded = Math.floor(parsed);
  return Math.min(
    MAX_STALE_PROCESSING_MINUTES,
    Math.max(MIN_STALE_PROCESSING_MINUTES, rounded),
  );
}

export function uploadIntentCleanupBatchSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.UPLOAD_INTENT_CLEANUP_BATCH_SIZE?.trim();
  if (!raw) return DEFAULT_UPLOAD_INTENT_CLEANUP_BATCH_SIZE;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_UPLOAD_INTENT_CLEANUP_BATCH_SIZE;

  const rounded = Math.floor(parsed);
  return Math.min(
    MAX_UPLOAD_INTENT_CLEANUP_BATCH_SIZE,
    Math.max(MIN_UPLOAD_INTENT_CLEANUP_BATCH_SIZE, rounded),
  );
}

export function ownerAuthCleanupBatchSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OWNER_AUTH_CLEANUP_BATCH_SIZE?.trim();
  if (!raw) return DEFAULT_OWNER_AUTH_CLEANUP_BATCH_SIZE;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_OWNER_AUTH_CLEANUP_BATCH_SIZE;

  const rounded = Math.floor(parsed);
  return Math.min(
    MAX_OWNER_AUTH_CLEANUP_BATCH_SIZE,
    Math.max(MIN_OWNER_AUTH_CLEANUP_BATCH_SIZE, rounded),
  );
}
