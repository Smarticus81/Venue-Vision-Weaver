import type { Request } from "express";

function normalizeIp(value: string | undefined): string | null {
  const ip = value?.trim();
  if (!ip) return null;
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

export function clientKey(req: Request): string {
  return normalizeIp(req.ip) ?? normalizeIp(req.socket.remoteAddress) ?? "unknown";
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();
let lastPruneAt = 0;

function pruneExpiredBuckets(now: number): void {
  if (now - lastPruneAt < 60_000 && rateBuckets.size < 10_000) return;
  lastPruneAt = now;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt < now) rateBuckets.delete(key);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  pruneExpiredBuckets(now);
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}
