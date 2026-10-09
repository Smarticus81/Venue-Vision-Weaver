import type { GuardState } from "../outreach/sendingHealth.js";

/*
 * Shapes shared by the adaptation rules, the KPI loaders and the agent
 * briefing. GuardState is imported from the vetting spec's module
 * (outreach/sendingHealth.ts) so there is exactly one definition.
 */

export type { GuardState };

export interface SegmentGuidanceEntry {
  segmentType: "region" | "venue_type";
  segment: string;
  sent: number;
  positiveReplyRate: number | null;
  signupRate: number | null;
  /** ISO date after which a "pause" entry is dropped. */
  until?: string;
}

export interface SegmentGuidance {
  prioritize: SegmentGuidanceEntry[];
  pause: SegmentGuidanceEntry[];
  updatedAt: string | null;
}

export const EMPTY_SEGMENT_GUIDANCE: SegmentGuidance = { prioritize: [], pause: [], updatedAt: null };

function normalizeEntry(raw: unknown): SegmentGuidanceEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const segmentType = value.segmentType === "venue_type" ? "venue_type" : value.segmentType === "region" ? "region" : null;
  if (!segmentType || typeof value.segment !== "string" || !value.segment) return null;
  const sent = Number(value.sent);
  const positiveReplyRate = typeof value.positiveReplyRate === "number" ? value.positiveReplyRate : null;
  const signupRate = typeof value.signupRate === "number" ? value.signupRate : null;
  const entry: SegmentGuidanceEntry = {
    segmentType,
    segment: value.segment,
    sent: Number.isFinite(sent) && sent >= 0 ? Math.floor(sent) : 0,
    positiveReplyRate,
    signupRate,
  };
  if (typeof value.until === "string" && value.until) entry.until = value.until;
  return entry;
}

/** Coerce a raw policy value into a well-formed SegmentGuidance (drops malformed entries). */
export function normalizeSegmentGuidance(raw: unknown): SegmentGuidance {
  if (!raw || typeof raw !== "object") return { ...EMPTY_SEGMENT_GUIDANCE };
  const value = raw as Record<string, unknown>;
  const list = (items: unknown): SegmentGuidanceEntry[] =>
    Array.isArray(items) ? items.map(normalizeEntry).filter((e): e is SegmentGuidanceEntry => e !== null) : [];
  return {
    prioritize: list(value.prioritize),
    pause: list(value.pause),
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : null,
  };
}
