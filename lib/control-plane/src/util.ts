import type { Observation, Severity } from "./types.js";

export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

/** Relative change from `previous` to `current`, clamped for readability. */
export function changeRatio(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 1 : null;
  return (current - previous) / previous;
}

export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatPercent(value: number): string {
  return `${round(value * 100, 1)}%`;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function observation(
  key: string,
  label: string,
  value: number | string | null,
  extra: Partial<Omit<Observation, "key" | "label" | "value">> = {},
): Observation {
  return { key, label, value, ...extra };
}

export function severityRank(severity: Severity): number {
  return severity === "critical" ? 2 : severity === "warning" ? 1 : 0;
}

/** Deterministic day bucket so a standing condition dedupes per day, not per tick. */
export function dayBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function weekBucket(now: Date): string {
  const date = new Date(now.getTime());
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

/**
 * Two-proportion z-test. Returns the z score and a rough two-sided p value —
 * enough to stop an experiment honestly without pulling in a stats library.
 */
export function twoProportionTest(
  successesA: number,
  totalA: number,
  successesB: number,
  totalB: number,
): { z: number; p: number } | null {
  if (totalA < 1 || totalB < 1) return null;
  const pA = successesA / totalA;
  const pB = successesB / totalB;
  const pooled = (successesA + successesB) / (totalA + totalB);
  const variance = pooled * (1 - pooled) * (1 / totalA + 1 / totalB);
  if (variance <= 0) return null;
  const z = (pB - pA) / Math.sqrt(variance);
  return { z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

/** Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const probability =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - probability : probability;
}

/** Cluster free-text error messages into recognisable failure families. */
export function classifyFailure(message: string | null): string {
  const text = (message ?? "").toLowerCase();
  if (!text.trim()) return "unknown";
  if (text.includes("quality") || text.includes("likeness")) return "quality_gate";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("etimedout")) {
    return "timeout";
  }
  if (text.includes("quota") || text.includes("rate limit") || text.includes("429")) {
    return "provider_quota";
  }
  if (text.includes("reference") || text.includes("photo") || text.includes("upload")) {
    return "reference_media";
  }
  if (text.includes("storage") || text.includes("bucket") || text.includes("object")) {
    return "storage";
  }
  if (text.includes("ffmpeg") || text.includes("reel") || text.includes("video")) {
    return "motion_reel";
  }
  if (text.includes("restart")) return "server_restart";
  if (text.includes("credit")) return "credits";
  return "other";
}

export const FAILURE_FAMILY_LABELS: Record<string, string> = {
  quality_gate: "Quality gate rejections",
  timeout: "Generation timeouts",
  provider_quota: "Model provider quota or rate limits",
  reference_media: "Reference photo problems",
  storage: "Object storage failures",
  motion_reel: "Motion reel rendering failures",
  server_restart: "Sessions lost to server restarts",
  credits: "Credit accounting failures",
  unknown: "Failures with no recorded reason",
  other: "Uncategorised failures",
};

export function topEntries<T>(
  items: T[],
  keyOf: (item: T) => string,
  limit = 3,
): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
