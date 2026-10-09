import { db, controlAdaptationsTable, controlCopyVariantsTable, type ControlAdaptation, type ControlCopyVariant } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { recordAuditEvent } from "../audit.js";
import { previousGrowthSnapshot } from "../metrics.js";
import {
  baseDailyCap,
  computeEffectiveCap,
  computeSendingHealthSince,
  effectiveDailyCap,
  loadGuard,
  pauseGuard,
  setGuardStatus,
  type GuardState,
} from "../outreach/sendingHealth.js";
import { getPolicy, getPolicyNumber, setPolicy } from "../policies.js";
import { normalizeSegmentGuidance, type SegmentGuidance, type SegmentGuidanceEntry } from "./adaptationTypes.js";
import { growthLoopEnabled, guardMinSends, segmentMinSent, variantMinSent } from "./config.js";
import { DAY_MS, DELIVERABILITY_THRESHOLDS, rate } from "./kpiMath.js";
import type { GrowthKpis, SegmentStat } from "./kpiTypes.js";
import { listVariants, normalizeControlShare } from "./variants.js";

/*
 * Adaptation rules (growth-loop.md 9.2): deterministic, bounded, and logged.
 * R1 deliverability guard (periodic backstop next to the webhook-time rule in
 * sendingHealth.ts), R2 segment guidance, R3 copy-variant weights, R4
 * campaign step cap. deriveAdaptations is pure; runAdaptationRules loads
 * state, applies the changes through the owning helpers and writes one
 * control_adaptations row plus one audit event per change.
 */

export const SEGMENT_PAUSE_DAYS = 60;
export const VARIANT_PAUSE_MIN_DELIVERED = 20;
export const STEP_CAP_MIN_SENT = 20;
export const RESTORE_OK_DAYS = 7;

/** Deliverability counts rule R1 judges (the 14-day window, or sends since an operator reset). */
export interface GuardWindow {
  sent: number;
  bounced: number;
  complained: number;
  bounceRate: number | null;
  complaintRate: number | null;
}

export interface AdaptationInput {
  kpis: GrowthKpis;
  /** Overrides kpis.deliverability.window14d for R1 (sends since the guard's last operator reset). */
  guardWindow?: GuardWindow | null;
  guard: GuardState;
  baseCap: number;
  effectiveCap: number;
  stepCap: number;
  variants: ControlCopyVariant[];
  guidance: SegmentGuidance;
  now: Date;
  cfg: {
    minSendsForGuard: number;
    segmentMinSent: number;
    variantMinSent: number;
    /** Snapshot cadence used to grow okDays toward a restore. */
    hoursSinceLastRun: number;
  };
}

export type GuardWithCap = GuardState & { cap: number };

export type AdaptationChange =
  | {
      ruleKey: "deliverability_guard";
      action: "pause" | "throttle" | "restore" | "warn" | "clear";
      before: GuardWithCap;
      after: GuardWithCap;
      reason: string;
      /** okDays progress ticks update the policy but only log a row on whole-day boundaries. */
      quiet?: boolean;
    }
  | { ruleKey: "segment_guidance"; action: "update"; before: SegmentGuidance; after: SegmentGuidance; reason: string }
  | {
      ruleKey: "variant_weights";
      action: "reweight" | "pause" | "resume";
      subjectId: string;
      before: { weight: number; active: boolean };
      after: { weight: number; active: boolean };
      reason: string;
    }
  | { ruleKey: "campaign_step_cap"; action: "reduce"; before: { steps: number }; after: { steps: number }; reason: string };

function pct(value: number | null, digits = 2): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/* ————— R1: deliverability guard ————— */

export function deriveGuardChange(input: AdaptationInput): Extract<AdaptationChange, { ruleKey: "deliverability_guard" }> | null {
  const { guard, baseCap, effectiveCap, now, cfg } = input;
  const window = input.guardWindow ?? input.kpis.deliverability.window14d;
  const resetAt = guard.resetAt ?? null;
  if (guard.status === "paused") return null; // never touches a paused guard; operator reset only
  if (window.sent < cfg.minSendsForGuard) return null;
  const bounce = window.bounceRate ?? 0;
  const complaint = window.complaintRate ?? 0;
  const nowIso = now.toISOString();
  const before: GuardWithCap = { ...guard, cap: effectiveCap };
  const stats = `bounce ${pct(window.bounceRate)} (${window.bounced}/${window.sent}), complaints ${pct(window.complaintRate, 3)} (${window.complained}/${window.sent}) ${input.guardWindow ? "since the operator reset" : "over 14 days"}`;

  if (bounce >= DELIVERABILITY_THRESHOLDS.pause.bounce || complaint >= DELIVERABILITY_THRESHOLDS.pause.complaint) {
    const reason = `paused by rule R1: ${stats}`;
    return { ruleKey: "deliverability_guard", action: "pause", before, after: { status: "paused", since: nowIso, reason, okDays: 0, cap: 0 }, reason };
  }
  if (bounce >= DELIVERABILITY_THRESHOLDS.throttle.bounce || complaint >= DELIVERABILITY_THRESHOLDS.throttle.complaint) {
    const cap = computeEffectiveCap({ status: "throttled" }, baseCap);
    if (guard.status === "throttled" && effectiveCap === cap && guard.okDays === 0) return null;
    const reason = `throttled by rule R1: ${stats}; cap ${cap} of base ${baseCap}`;
    return { ruleKey: "deliverability_guard", action: "throttle", before, after: { status: "throttled", since: nowIso, reason, okDays: 0, cap, resetAt }, reason };
  }
  if (bounce >= DELIVERABILITY_THRESHOLDS.warn.bounce || window.complained > 0) {
    if (guard.status === "warn" && guard.okDays === 0) return null;
    const reason = `warning from rule R1: ${stats}; cap unchanged`;
    // A warn never raises a throttled cap: keep the stricter of the two.
    const cap = guard.status === "throttled" ? effectiveCap : Math.min(effectiveCap, baseCap);
    const status = guard.status === "throttled" ? "throttled" : "warn";
    return { ruleKey: "deliverability_guard", action: "warn", before, after: { status, since: nowIso, reason, okDays: 0, cap, resetAt }, reason };
  }
  // Clean window.
  if ((guard.status === "throttled" || guard.status === "warn") && bounce < DELIVERABILITY_THRESHOLDS.restore.bounce && complaint < DELIVERABILITY_THRESHOLDS.restore.complaint) {
    const okDays = Math.round((guard.okDays + Math.max(0, cfg.hoursSinceLastRun) / 24) * 100) / 100;
    if (okDays >= RESTORE_OK_DAYS) {
      const reason = `restored by rule R1 after ${okDays.toFixed(1)} clean days: ${stats}; cap back to base ${baseCap}`;
      return { ruleKey: "deliverability_guard", action: "restore", before, after: { status: "ok", since: nowIso, reason: null, okDays: 0, cap: baseCap, resetAt }, reason };
    }
    const reason = `clean window (${stats}); ${okDays.toFixed(1)} of ${RESTORE_OK_DAYS} days toward restore`;
    return {
      ruleKey: "deliverability_guard",
      action: "clear",
      before,
      after: { status: guard.status, since: guard.since ?? nowIso, reason: guard.reason, okDays, cap: effectiveCap, resetAt },
      reason,
      quiet: Math.floor(okDays) === Math.floor(guard.okDays),
    };
  }
  return null;
}

/* ————— R2: segment guidance ————— */

function guidanceEntry(stat: SegmentStat, until?: string): SegmentGuidanceEntry {
  const entry: SegmentGuidanceEntry = {
    segmentType: stat.segmentType,
    segment: stat.segment,
    sent: stat.sent,
    positiveReplyRate: stat.positiveReplyRate,
    signupRate: stat.signupRate,
  };
  if (until) entry.until = until;
  return entry;
}

function sameGuidance(a: SegmentGuidance, b: SegmentGuidance): boolean {
  const strip = (g: SegmentGuidance) => JSON.stringify({ prioritize: g.prioritize, pause: g.pause });
  return strip(a) === strip(b);
}

export function deriveSegmentGuidance(input: AdaptationInput): SegmentGuidance {
  const { now, cfg } = input;
  const nowMs = now.getTime();
  const existingPause = input.guidance.pause.filter((e) => !e.until || new Date(e.until).getTime() > nowMs);
  const prioritize: SegmentGuidanceEntry[] = [];
  const pause: SegmentGuidanceEntry[] = [];
  const pauseMin = Math.max(30, cfg.segmentMinSent);

  for (const type of ["region", "venue_type"] as const) {
    const eligible = input.kpis.outbound.bySegment.filter((s) => s.segmentType === type && s.sent >= cfg.segmentMinSent);
    const top = eligible
      .filter((s) => s.positiveReplied >= 1)
      .sort((a, b) => (b.positiveReplyRate ?? 0) - (a.positiveReplyRate ?? 0) || (b.signupRate ?? 0) - (a.signupRate ?? 0) || b.sent - a.sent)
      .slice(0, 3);
    prioritize.push(...top.map((s) => guidanceEntry(s)));

    const candidates = eligible
      .filter((s) => s.sent >= pauseMin && s.positiveReplied === 0 && s.signups === 0)
      .sort((a, b) => b.sent - a.sent); // drop the smallest-sent candidates first when over the bound
    const bound = Math.floor(eligible.length / 2);
    for (const stat of candidates.slice(0, bound)) {
      const existing = existingPause.find((e) => e.segmentType === type && e.segment === stat.segment);
      const until = existing?.until ?? new Date(nowMs + SEGMENT_PAUSE_DAYS * DAY_MS).toISOString();
      pause.push(guidanceEntry(stat, until));
    }
  }
  return { prioritize, pause, updatedAt: now.toISOString() };
}

/* ————— R3: variant weights ————— */

export function deriveVariantChanges(input: AdaptationInput): Array<Extract<AdaptationChange, { ruleKey: "variant_weights" }>> {
  const stats = new Map(input.kpis.outbound.byVariant.map((v) => [v.variantKey, v]));
  const minSent = input.cfg.variantMinSent;
  const working = input.variants.map((v) => ({ ...v }));

  // Reweight: active rows with enough sends take their smoothed positive-reply rate.
  for (const variant of working) {
    if (!variant.active) continue;
    const stat = stats.get(variant.key);
    if (!stat || stat.sent < minSent) continue;
    variant.weight = stat.smoothedPositiveReplyRate;
  }
  // Pause: a non-control variant far below the best measured variant.
  const measured = working
    .filter((v) => v.active && (stats.get(v.key)?.sent ?? 0) >= minSent)
    .map((v) => ({ variant: v, stat: stats.get(v.key)! }));
  const best = measured.reduce<number | null>((acc, m) => {
    const rate = m.stat.positiveReplyRate;
    if (rate == null) return acc;
    return acc == null ? rate : Math.max(acc, rate);
  }, null);
  const pauseReasons = new Map<string, string>();
  if (best != null && best > 0) {
    for (const { variant, stat } of measured) {
      if (variant.isControl) continue;
      if (stat.delivered < VARIANT_PAUSE_MIN_DELIVERED) continue;
      const rate = stat.positiveReplyRate ?? 0;
      if (rate < 0.5 * best) {
        const activeCount = working.filter((v) => v.active).length;
        if (activeCount <= 2) break; // never leave fewer than 2 active variants
        variant.active = false;
        pauseReasons.set(
          variant.key,
          `paused by rule R3: positive reply ${pct(stat.positiveReplyRate)} on ${stat.delivered} delivered vs best ${pct(best)}`,
        );
      }
    }
  }

  // Keep every active arm on one scale: once some arms carry a smoothed
  // reply rate (~0.05-0.1), a still-unmeasured arm left at its seeded weight
  // (0.2-0.4) would out-draw the best measured one. Unmeasured arms take the
  // mean of the measured arms until they reach minSent themselves.
  const unmeasuredReasons = new Map<string, string>();
  const measuredRates = working
    .filter((v) => v.active && (stats.get(v.key)?.sent ?? 0) >= minSent)
    .map((v) => stats.get(v.key)!.smoothedPositiveReplyRate);
  if (measuredRates.length > 0) {
    const mean = Math.round((measuredRates.reduce((sum, r) => sum + r, 0) / measuredRates.length) * 10_000) / 10_000;
    for (const variant of working) {
      if (!variant.active || (stats.get(variant.key)?.sent ?? 0) >= minSent) continue;
      variant.weight = mean;
      unmeasuredReasons.set(
        variant.key,
        `set by rule R3 to the mean smoothed positive-reply rate of the measured variants (${pct(mean)}) until it has ${minSent} sends`,
      );
    }
  }

  const normalized = normalizeControlShare(working);
  const changes: Array<Extract<AdaptationChange, { ruleKey: "variant_weights" }>> = [];
  for (const after of normalized) {
    const before = input.variants.find((v) => v.key === after.key)!;
    const weightChanged = Math.abs(after.weight - before.weight) > 0.0001;
    const activeChanged = after.active !== before.active;
    if (!weightChanged && !activeChanged) continue;
    const stat = stats.get(after.key);
    changes.push({
      ruleKey: "variant_weights",
      action: activeChanged ? (after.active ? "resume" : "pause") : "reweight",
      subjectId: after.key,
      before: { weight: before.weight, active: before.active },
      after: { weight: after.weight, active: after.active },
      reason:
        pauseReasons.get(after.key) ??
        unmeasuredReasons.get(after.key) ??
        `reweighted by rule R3 to smoothed positive-reply rate ${pct(stat?.smoothedPositiveReplyRate ?? null)} (${stat?.positiveReplied ?? 0}/${stat?.delivered ?? 0} delivered, ${stat?.sent ?? 0} sent; control keeps >= 20%)`,
    });
  }
  return changes;
}

/* ————— R4: campaign step cap ————— */

export function deriveStepCapChange(input: AdaptationInput): Extract<AdaptationChange, { ruleKey: "campaign_step_cap" }> | null {
  if (input.stepCap !== 3) return null;
  const step1 = input.kpis.outbound.byStep.find((s) => s.step === 1);
  const step3 = input.kpis.outbound.byStep.find((s) => s.step === 3);
  if (!step1 || !step3 || step1.sent < STEP_CAP_MIN_SENT || step3.sent < STEP_CAP_MIN_SENT) return null;
  const r1 = step1.complaintRate ?? 0;
  const r3 = step3.complaintRate ?? 0;
  if (r3 > 0 && r3 > 2 * r1) {
    return {
      ruleKey: "campaign_step_cap",
      action: "reduce",
      before: { steps: 3 },
      after: { steps: 2 },
      reason: `step 3 complaint rate ${pct(r3, 3)} (${step3.complained}/${step3.sent}) is more than twice step 1's ${pct(r1, 3)} (${step1.complained}/${step1.sent}); campaigns capped at 2 touches`,
    };
  }
  return null;
}

/** Pure: every change the rules would apply to this state. */
export function deriveAdaptations(input: AdaptationInput): AdaptationChange[] {
  const changes: AdaptationChange[] = [];
  const guard = deriveGuardChange(input);
  if (guard) changes.push(guard);
  const guidance = deriveSegmentGuidance(input);
  if (!sameGuidance(guidance, input.guidance)) {
    changes.push({
      ruleKey: "segment_guidance",
      action: "update",
      before: input.guidance,
      after: guidance,
      reason: `prioritize ${guidance.prioritize.map((e) => `${e.segmentType}=${e.segment}`).join(", ") || "none"}; pause ${guidance.pause.map((e) => `${e.segmentType}=${e.segment}`).join(", ") || "none"}`,
    });
  }
  changes.push(...deriveVariantChanges(input));
  const step = deriveStepCapChange(input);
  if (step) changes.push(step);
  return changes;
}

/* ————— Application ————— */

async function logAdaptation(change: AdaptationChange, snapshotId: number | null): Promise<void> {
  const subjectType = change.ruleKey === "variant_weights" ? "variant" : "policy";
  const subjectId =
    change.ruleKey === "variant_weights"
      ? change.subjectId
      : change.ruleKey === "deliverability_guard"
        ? "deliverability_guard"
        : change.ruleKey === "segment_guidance"
          ? "segment_guidance"
          : "max_campaign_steps";
  const before = change.before as unknown as Record<string, unknown>;
  const after = change.after as unknown as Record<string, unknown>;
  if (!("quiet" in change && change.quiet)) {
    await db.insert(controlAdaptationsTable).values({
      ruleKey: change.ruleKey,
      subjectType,
      subjectId,
      action: change.action,
      before,
      after,
      reason: change.reason,
      snapshotId,
    });
  }
  await recordAuditEvent({
    actorType: "system",
    actor: "growth-rules",
    eventType: "adaptation_applied",
    subjectType,
    subjectId,
    detail: { ruleKey: change.ruleKey, action: change.action, before, after, reason: change.reason, snapshotId },
  });
}

async function applyChange(change: AdaptationChange, snapshotId: number | null): Promise<void> {
  const actor = "system:growth-rules";
  switch (change.ruleKey) {
    case "deliverability_guard": {
      const { cap, ...guard } = change.after;
      if (change.action === "pause") {
        await pauseGuard(change.reason, actor);
      } else if (change.action === "throttle" || change.action === "restore") {
        await setGuardStatus(guard, cap, actor);
      } else {
        await setGuardStatus(guard, null, actor);
      }
      break;
    }
    case "segment_guidance":
      await setPolicy("segment_guidance", { ...change.after });
      break;
    case "variant_weights":
      await db
        .update(controlCopyVariantsTable)
        .set({
          weight: change.after.weight,
          active: change.after.active,
          pausedReason: change.action === "pause" ? change.reason : change.action === "resume" ? null : undefined,
          updatedAt: new Date(),
        })
        .where(eq(controlCopyVariantsTable.key, change.subjectId));
      break;
    case "campaign_step_cap":
      await setPolicy("max_campaign_steps", { steps: change.after.steps });
      break;
  }
  await logAdaptation(change, snapshotId);
}

export async function loadAdaptationState(): Promise<Pick<AdaptationInput, "guard" | "baseCap" | "effectiveCap" | "stepCap" | "variants" | "guidance">> {
  const [guard, baseCap, effectiveCap, stepCap, variants, guidanceRaw] = await Promise.all([
    loadGuard(),
    baseDailyCap(),
    effectiveDailyCap(),
    getPolicyNumber("max_campaign_steps", "steps", 3),
    listVariants(),
    getPolicy("segment_guidance"),
  ]);
  return { guard, baseCap, effectiveCap, stepCap, variants, guidance: normalizeSegmentGuidance(guidanceRaw) };
}

/** R1 window after an operator reset (within 14 days): sends since the reset only. */
export function guardWindowSinceReset(
  guard: Pick<GuardState, "resetAt">,
  now: Date,
): Date | null {
  if (!guard.resetAt) return null;
  const resetAt = new Date(guard.resetAt);
  if (Number.isNaN(resetAt.getTime())) return null;
  return now.getTime() - resetAt.getTime() < 14 * DAY_MS ? resetAt : null;
}

/** Load state, derive, apply, audit. Skipped entirely when GROWTH_LOOP_ENABLED=off. */
export async function runAdaptationRules(
  kpis: GrowthKpis,
  snapshotId: number,
  now = new Date(),
  options: { hoursSinceLastRun?: number } = {},
): Promise<AdaptationChange[]> {
  if (!growthLoopEnabled()) return [];
  const state = await loadAdaptationState();
  let hoursSinceLastRun = options.hoursSinceLastRun ?? Number(process.env.CONTROL_PLANE_SNAPSHOT_MINUTES ?? "360") / 60;
  if (options.hoursSinceLastRun == null) {
    try {
      const previous = await previousGrowthSnapshot(snapshotId);
      if (previous) hoursSinceLastRun = Math.max(0, (now.getTime() - previous.createdAt.getTime()) / 3_600_000);
    } catch (err) {
      logger.warn({ err }, "Could not read the previous snapshot; using the configured cadence for okDays");
    }
  }
  let guardWindow: GuardWindow | null = null;
  const resetSince = guardWindowSinceReset(state.guard, now);
  if (resetSince) {
    const health = await computeSendingHealthSince(resetSince);
    guardWindow = {
      sent: health.sent,
      bounced: health.bounced,
      complained: health.complained,
      bounceRate: rate(health.bounced, health.sent),
      complaintRate: rate(health.complained, health.sent),
    };
  }
  const changes = deriveAdaptations({
    kpis,
    guardWindow,
    ...state,
    now,
    cfg: { minSendsForGuard: guardMinSends(), segmentMinSent: segmentMinSent(), variantMinSent: variantMinSent(), hoursSinceLastRun },
  });
  for (const change of changes) {
    try {
      await applyChange(change, snapshotId);
    } catch (err) {
      logger.error({ err, ruleKey: change.ruleKey, action: change.action }, "Adaptation rule application failed");
    }
  }
  if (changes.length > 0) {
    logger.info({ changes: changes.map((c) => `${c.ruleKey}:${c.action}`) }, "Adaptation rules applied");
  }
  return changes;
}

export async function listRecentAdaptations(limit = 20): Promise<ControlAdaptation[]> {
  return db.select().from(controlAdaptationsTable).orderBy(desc(controlAdaptationsTable.createdAt)).limit(Math.max(1, Math.min(limit, 200)));
}

/** Operator reset of the guard: one adaptation row so the Growth tab shows who cleared it and why. */
export async function recordOperatorGuardReset(before: GuardState, after: GuardState, note: string, operatorEmail: string, cap: number): Promise<void> {
  await db.insert(controlAdaptationsTable).values({
    ruleKey: "deliverability_guard",
    subjectType: "policy",
    subjectId: "deliverability_guard",
    action: "operator_reset",
    before: { ...before } as unknown as Record<string, unknown>,
    after: { ...after, cap } as unknown as Record<string, unknown>,
    reason: `${note} (reset by ${operatorEmail})`,
    snapshotId: null,
  });
}
