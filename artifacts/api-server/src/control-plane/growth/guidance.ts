import type { ControlCopyVariant } from "@workspace/db";
import { baseDailyCap, effectiveDailyCap, loadGuard, type GuardState } from "../outreach/sendingHealth.js";
import { getPolicy, getPolicyNumber } from "../policies.js";
import { listRecentAdaptations } from "./adaptation.js";
import { normalizeSegmentGuidance, type SegmentGuidance, type SegmentGuidanceEntry } from "./adaptationTypes.js";
import type { GrowthKpis, VariantStat } from "./kpiTypes.js";
import { listVariants } from "./variants.js";

/*
 * The deterministic adaptation state as one document: what the rules decided
 * (segment prioritize/pause, guard + caps, variant weights, step cap) and the
 * last rule firings. Read by the get_growth_guidance tool, injected into the
 * revenue agents' briefings (runner.ts) and returned by GET /control/growth.
 * Nothing here calls a model.
 */

export const GUIDANCE_AGENT_KEYS: readonly string[] = ["prospecting", "outreach", "campaigns", "growth", "finance"];

export interface GrowthGuidance {
  segmentGuidance: SegmentGuidance;
  guard: GuardState;
  caps: { base: number; effective: number; lifecyclePerDay: number; campaignSteps: number };
  variants: VariantStat[];
  recentAdaptations: Array<{ id: number; ruleKey: string; action: string; subjectId: string | null; reason: string; createdAt: string }>;
}

function zeroVariantStat(variant: ControlCopyVariant): VariantStat {
  return {
    variantKey: variant.key,
    name: variant.name,
    isControl: variant.isControl,
    active: variant.active,
    weight: variant.weight,
    sent: 0,
    delivered: 0,
    replied: 0,
    positiveReplied: 0,
    signups: 0,
    replyRate: null,
    positiveReplyRate: null,
    signupRate: null,
    smoothedPositiveReplyRate: 0.5,
  };
}

/**
 * Pure: registry rows are the source of truth for name/active/weight (the
 * snapshot may be hours old); the snapshot supplies the counts. Stats for
 * keys that are not registry rows (e.g. "unassigned") are kept as reported.
 */
export function mergeVariantStats(variants: ControlCopyVariant[], stats: VariantStat[]): VariantStat[] {
  const byKey = new Map(stats.map((s) => [s.variantKey, s]));
  const merged: VariantStat[] = variants.map((variant) => {
    const stat = byKey.get(variant.key);
    if (!stat) return zeroVariantStat(variant);
    return { ...stat, name: variant.name, isControl: variant.isControl, active: variant.active, weight: variant.weight };
  });
  const known = new Set(variants.map((v) => v.key));
  for (const stat of stats) {
    if (!known.has(stat.variantKey)) merged.push(stat);
  }
  return merged;
}

export async function loadSegmentGuidance(): Promise<SegmentGuidance> {
  return normalizeSegmentGuidance(await getPolicy("segment_guidance"));
}

/** Everything the agents and the Growth tab need about the current adaptation state. */
export async function loadGrowthGuidance(options: { kpis?: GrowthKpis | null; adaptationLimit?: number } = {}): Promise<GrowthGuidance> {
  const [segmentGuidance, guard, base, effective, lifecyclePerDay, campaignSteps, variants, adaptations] = await Promise.all([
    loadSegmentGuidance(),
    loadGuard(),
    baseDailyCap(),
    effectiveDailyCap(),
    getPolicyNumber("max_lifecycle_emails_per_day", "emails", 50),
    getPolicyNumber("max_campaign_steps", "steps", 3),
    listVariants(),
    listRecentAdaptations(options.adaptationLimit ?? 10),
  ]);
  return {
    segmentGuidance,
    guard,
    caps: { base, effective, lifecyclePerDay, campaignSteps },
    variants: mergeVariantStats(variants, options.kpis?.outbound.byVariant ?? []),
    recentAdaptations: adaptations.map((a) => ({
      id: a.id,
      ruleKey: a.ruleKey,
      action: a.action,
      subjectId: a.subjectId,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

/* ————— Briefing block (growth-loop.md 11.4) ————— */

export const GUIDANCE_BLOCK_MAX_CHARS = 1200;
const GUIDANCE_LIST_LIMIT = 5;

function pct(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function describePrioritize(entries: SegmentGuidanceEntry[]): string {
  const shown = entries.slice(0, GUIDANCE_LIST_LIMIT).map((e) => `${e.segmentType}=${e.segment} (${pct(e.positiveReplyRate)} positive replies on ${e.sent})`);
  if (entries.length > GUIDANCE_LIST_LIMIT) shown.push(`+${entries.length - GUIDANCE_LIST_LIMIT} more`);
  return shown.join("; ") || "none yet (insufficient data)";
}

function describePause(entries: SegmentGuidanceEntry[]): string {
  const shown = entries.slice(0, GUIDANCE_LIST_LIMIT).map((e) => `${e.segmentType}=${e.segment}${e.until ? ` until ${e.until.slice(0, 10)}` : ""}`);
  if (entries.length > GUIDANCE_LIST_LIMIT) shown.push(`+${entries.length - GUIDANCE_LIST_LIMIT} more`);
  return shown.join("; ") || "none";
}

/** Pure: the GROWTH GUIDANCE paragraph appended to revenue-agent briefings (kept under 1,200 characters). */
export function renderGuidanceBlock(input: { guard: GuardState; baseCap: number; effectiveCap: number; guidance: SegmentGuidance; campaignSteps?: number }): string {
  const lines = [
    "GROWTH GUIDANCE (deterministic, applied by code; see get_growth_guidance for detail):",
    `Deliverability guard: ${input.guard.status}${input.guard.reason ? ` — ${input.guard.reason}` : ""}. Prospect emails allowed today: ${input.effectiveCap} of base ${input.baseCap}.${
      input.campaignSteps != null ? ` Campaign step cap: ${input.campaignSteps}.` : ""
    }`,
    `Prioritize segments: ${describePrioritize(input.guidance.prioritize)}.`,
    `Stop spending on: ${describePause(input.guidance.pause)}.`,
  ];
  const block = lines.join("\n");
  if (block.length <= GUIDANCE_BLOCK_MAX_CHARS) return block;
  return `${block.slice(0, GUIDANCE_BLOCK_MAX_CHARS - 1)}…`;
}
