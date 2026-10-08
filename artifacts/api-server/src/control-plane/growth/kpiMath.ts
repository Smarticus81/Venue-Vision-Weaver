import type { ControlCopyVariant } from "@workspace/db";
import type { GuardState, SegmentGuidance } from "./adaptationTypes.js";
import type {
  CampaignFact,
  EmailFact,
  ExperimentFact,
  GrowthKpis,
  LedgerFact,
  OrgFact,
  Prices,
  ProspectFact,
  RateTriple,
  SegmentStat,
  VariantStat,
} from "./kpiTypes.js";
import { normalizeRegion } from "./segments.js";

/*
 * Pure KPI math (growth-loop.md 5.3). Every function is deterministic over
 * fact rows and a `now`, so the suite seeds facts without a database. The
 * definitions below are the contract the Growth tab, the digest, the
 * evaluator and the agents all read; change them only together with the
 * spec section they cite.
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** UTC Monday 00:00 of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sunday
  const back = (day + 6) % 7; // Monday -> 0, Sunday -> 6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
}

/** The last `weeks` Mondays, ascending, ending with the current week's Monday. */
export function weekStarts(now: Date, weeks: number): Date[] {
  const current = mondayOf(now);
  const out: Date[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    out.push(new Date(current.getTime() - i * 7 * DAY_MS));
  }
  return out;
}

/** num / den rounded to 4 dp; null when den is 0 (never divide into NaN). */
export function rate(num: number, den: number): number | null {
  if (!Number.isFinite(den) || den <= 0 || !Number.isFinite(num)) return null;
  return Math.round((num / den) * 10_000) / 10_000;
}

/** Linear-interpolated percentile of an ascending array; null when empty. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const clamped = Math.min(1, Math.max(0, p));
  const index = (sorted.length - 1) * clamped;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  const lo = sorted[lower]!;
  const hi = sorted[upper]!;
  return Math.round((lo + (hi - lo) * weight) * 100) / 100;
}

function inWeek(at: Date | null, weekStart: Date): boolean {
  if (!at) return false;
  const t = at.getTime();
  return t >= weekStart.getTime() && t < weekStart.getTime() + 7 * DAY_MS;
}

function since(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/* ————— Signups ————— */

export function buildSignups(
  orgs: OrgFact[],
  prospects: ProspectFact[],
  venueCreatedAts: Date[],
  now: Date,
  weeks: Date[],
): GrowthKpis["signups"] {
  const s7 = since(now, 7);
  const s30 = since(now, 30);
  const attributed = prospects.filter((p) => p.convertedAt != null && p.contactCount > 0);
  return {
    orgs7d: orgs.filter((o) => o.createdAt >= s7).length,
    orgs30d: orgs.filter((o) => o.createdAt >= s30).length,
    venues7d: venueCreatedAts.filter((d) => d >= s7).length,
    venues30d: venueCreatedAts.filter((d) => d >= s30).length,
    attributedToOutbound30d: attributed.filter((p) => p.convertedAt! >= s30).length,
    byWeek: weeks.map((weekStart) => ({
      weekStart: weekStart.toISOString(),
      orgs: orgs.filter((o) => inWeek(o.createdAt, weekStart)).length,
      venues: venueCreatedAts.filter((d) => inWeek(d, weekStart)).length,
      attributed: attributed.filter((p) => inWeek(p.convertedAt, weekStart)).length,
    })),
  };
}

/* ————— Activation ————— */

export function isActivated(org: Pick<OrgFact, "firstGalleryAt">): boolean {
  return org.firstGalleryAt != null;
}

export function hasSecondGallery14d(org: Pick<OrgFact, "firstGalleryAt" | "secondGalleryAt">): boolean {
  return (
    org.firstGalleryAt != null &&
    org.secondGalleryAt != null &&
    org.secondGalleryAt.getTime() - org.firstGalleryAt.getTime() <= 14 * DAY_MS
  );
}

export function buildActivation(
  orgs: OrgFact[],
  now: Date,
  weeks: Date[],
  minPhotos: number,
  maturityDays = 14,
): GrowthKpis["activation"] {
  const withVenue = orgs.filter((o) => o.firstVenueAt != null);
  const photosReady = withVenue.filter((o) => o.photosReadyAt != null);
  const firstGallery = orgs.filter(isActivated);
  const galleryViewed = firstGallery.filter((o) => o.firstGalleryViewedAt != null);
  const secondGallery = firstGallery.filter(hasSecondGallery14d);

  const hours = firstGallery
    .map((o) => (o.firstGalleryAt!.getTime() - o.createdAt.getTime()) / HOUR_MS)
    .filter((h) => Number.isFinite(h) && h >= 0)
    .sort((a, b) => a - b);

  const within = (days: number): number | null => {
    const matured = orgs.filter((o) => o.createdAt.getTime() + days * DAY_MS <= now.getTime());
    const hit = matured.filter(
      (o) => o.firstGalleryAt != null && o.firstGalleryAt.getTime() - o.createdAt.getTime() <= days * DAY_MS,
    );
    return rate(hit.length, matured.length);
  };

  return {
    minPhotos,
    funnel: {
      orgs: orgs.length,
      withVenue: withVenue.length,
      photosReady: photosReady.length,
      firstGallery: firstGallery.length,
      galleryViewed: galleryViewed.length,
      secondGallery14d: secondGallery.length,
    },
    rates: {
      withVenue: rate(withVenue.length, orgs.length),
      photosReady: rate(photosReady.length, withVenue.length),
      firstGallery: rate(firstGallery.length, photosReady.length),
      galleryViewed: rate(galleryViewed.length, firstGallery.length),
      secondGallery14d: rate(secondGallery.length, firstGallery.length),
    },
    timeToFirstGalleryHours: { median: percentile(hours, 0.5), p75: percentile(hours, 0.75), n: hours.length },
    firstGalleryWithin7d: within(7),
    firstGalleryWithin14d: within(14),
    byCohortWeek: weeks.map((weekStart) => {
      const cohort = orgs.filter((o) => inWeek(o.createdAt, weekStart));
      return {
        weekStart: weekStart.toISOString(),
        orgs: cohort.length,
        photosReady: cohort.filter((o) => o.photosReadyAt != null).length,
        firstGallery: cohort.filter(isActivated).length,
        galleryViewed: cohort.filter((o) => o.firstGalleryViewedAt != null).length,
        secondGallery14d: cohort.filter(hasSecondGallery14d).length,
        paid: cohort.filter((o) => o.firstPaidAt != null).length,
        matured: weekStart.getTime() + (7 + maturityDays) * DAY_MS <= now.getTime(),
      };
    }),
  };
}

/* ————— Trial -> paid ————— */

export function isPaid(org: Pick<OrgFact, "firstPaidAt">): boolean {
  return org.firstPaidAt != null;
}

/** An org's cohort has matured when its week has had a full trial to convert. */
export function isMaturedForTrial(org: Pick<OrgFact, "createdAt">, now: Date, trialDays: number): boolean {
  return mondayOf(org.createdAt).getTime() + (7 + trialDays) * DAY_MS <= now.getTime();
}

function triple(list: OrgFact[]): RateTriple {
  const paid = list.filter(isPaid).length;
  return { orgs: list.length, paid, rate: rate(paid, list.length) };
}

export function buildTrialToPaid(
  orgs: OrgFact[],
  now: Date,
  weeks: Date[],
  trialDays: number,
): GrowthKpis["trialToPaid"] {
  const matured = orgs.filter((o) => isMaturedForTrial(o, now, trialDays));
  const paidDays = orgs
    .filter(isPaid)
    .map((o) => (o.firstPaidAt!.getTime() - o.createdAt.getTime()) / DAY_MS)
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);
  return {
    overall: triple(matured),
    byActivation: {
      activated: triple(matured.filter(isActivated)),
      notActivated: triple(matured.filter((o) => !isActivated(o))),
    },
    byCohortWeek: weeks.map((weekStart) => {
      const cohort = orgs.filter((o) => inWeek(o.createdAt, weekStart));
      const isMatured = weekStart.getTime() + (7 + trialDays) * DAY_MS <= now.getTime();
      const paid = cohort.filter(isPaid).length;
      return {
        weekStart: weekStart.toISOString(),
        orgs: cohort.length,
        paid,
        rate: isMatured ? rate(paid, cohort.length) : null,
        matured: isMatured,
      };
    }),
    medianDaysToPaid: percentile(paidDays, 0.5),
  };
}

/* ————— Revenue and credits ————— */

const PLAN_KEYS = ["trial", "starter", "growth", "payg", "none"] as const;

export function buildRevenue(
  orgs: OrgFact[],
  ledger: LedgerFact[],
  prices: Prices,
  since30: Date,
): GrowthKpis["revenue"] {
  const planMix: GrowthKpis["revenue"]["planMix"] = { trial: 0, starter: 0, growth: 0, payg: 0, none: 0 };
  for (const org of orgs) {
    const key = (PLAN_KEYS as readonly string[]).includes(org.plan) ? (org.plan as (typeof PLAN_KEYS)[number]) : "none";
    planMix[key] += 1;
  }
  const paidOrgs = orgs.filter(
    (o) => o.firstPaidAt != null && (o.churnedAt == null || o.firstPaidAt.getTime() > o.churnedAt.getTime()),
  ).length;
  const subscriptionOrgs = planMix.starter + planMix.growth;
  const mrrCents = planMix.starter * prices.starterCents + planMix.growth * prices.growthCents;
  const packs = ledger.filter((l) => l.reason === "pack_purchase" && l.delta > 0 && l.createdAt >= since30);
  return {
    planMix,
    paidOrgs,
    subscriptionOrgs,
    mrrCents,
    arpaCents: subscriptionOrgs > 0 ? Math.round(mrrCents / subscriptionOrgs) : null,
    packPurchases30d: packs.length,
    packRevenueCents30d: packs.length * prices.creditPackCents,
    prices,
  };
}

export function buildCredits(orgs: OrgFact[], ledger: LedgerFact[], since30: Date): GrowthKpis["credits"] {
  const window = ledger.filter((l) => l.createdAt >= since30);
  const sumWhere = (pred: (l: LedgerFact) => boolean): number =>
    window.filter(pred).reduce((acc, l) => acc + l.delta, 0);
  const consumed30d = Math.abs(sumWhere((l) => l.reason === "session_debit"));
  const paidOrgs = orgs.filter(isPaid).length;
  return {
    purchased30d: sumWhere((l) => l.reason === "pack_purchase" && l.delta > 0),
    subscriptionGranted30d: sumWhere((l) => l.reason === "subscription_grant" && l.delta > 0),
    consumed30d,
    refunded30d: sumWhere((l) => l.reason === "session_refund"),
    promo30d: sumWhere((l) => l.reason === "admin_adjust" && l.delta > 0),
    trialGranted30d: sumWhere((l) => l.reason === "trial_grant"),
    consumedPerPaidOrg30d: paidOrgs > 0 ? Math.round((consumed30d / paidOrgs) * 100) / 100 : null,
    float: orgs.reduce((acc, o) => acc + o.creditsBalance, 0),
  };
}

/* ————— Churn ————— */

export function buildChurn(orgs: OrgFact[], now: Date, since30: Date): GrowthKpis["churn"] {
  const next7 = new Date(now.getTime() + 7 * DAY_MS);
  const subscriptionsDeleted30d = orgs.filter((o) => o.churnedAt != null && o.churnedAt >= since30).length;
  const expired = orgs.filter((o) => o.trialExpiredAt != null && o.trialExpiredAt >= since30);
  const paidOrgsAtWindowStart = orgs.filter(
    (o) => o.firstPaidAt != null && o.firstPaidAt < since30 && (o.churnedAt == null || o.churnedAt >= since30),
  ).length;
  const expiring = orgs.filter(
    (o) =>
      o.plan === "trial" &&
      o.trialExpiredAt == null &&
      o.trialEndsAt != null &&
      o.trialEndsAt >= now &&
      o.trialEndsAt < next7,
  );
  return {
    subscriptionsDeleted30d,
    trialsExpired30d: expired.length,
    trialsExpiredWithoutPurchase30d: expired.filter((o) => o.firstPaidAt == null).length,
    paidOrgsAtWindowStart,
    logoChurnRate30d: rate(subscriptionsDeleted30d, paidOrgsAtWindowStart),
    trialsExpiringNext7d: expiring.length,
    trialsExpiringNext7dWithoutGallery: expiring.filter((o) => o.firstGalleryAt == null).length,
  };
}

/* ————— Outbound ————— */

export interface EmailAttribution {
  replied: boolean;
  positive: boolean;
  converted: boolean;
}

/**
 * One reply per prospect, credited to the latest email sent at or before the
 * reply (or the latest sent email when none precedes it). The same email
 * gets `converted` when the prospect converted after being contacted.
 */
export function attributeRepliesToEmails(
  emails: EmailFact[],
  prospects: ProspectFact[],
  now: Date = new Date(),
): Map<number, EmailAttribution> {
  const sentByProspect = new Map<number, EmailFact[]>();
  for (const email of emails) {
    if (!email.sentAt) continue;
    const list = sentByProspect.get(email.prospectId) ?? [];
    list.push(email);
    sentByProspect.set(email.prospectId, list);
  }
  for (const list of sentByProspect.values()) list.sort((a, b) => a.sentAt!.getTime() - b.sentAt!.getTime());

  const out = new Map<number, EmailAttribution>();
  for (const prospect of prospects) {
    const sent = sentByProspect.get(prospect.id);
    if (!sent || sent.length === 0) continue;
    const repliedStatus = prospect.status === "replied" || prospect.status === "converted";
    const repliedAt = prospect.repliedAt ?? (repliedStatus ? prospect.convertedAt ?? now : null);
    const converted = prospect.convertedAt != null && prospect.contactCount > 0;
    if (!repliedAt && !converted) continue;
    const anchor = repliedAt ?? prospect.convertedAt ?? now;
    const before = sent.filter((e) => e.sentAt!.getTime() <= anchor.getTime());
    const attributed = before.length > 0 ? before[before.length - 1]! : sent[sent.length - 1]!;
    out.set(attributed.id, {
      replied: repliedAt != null,
      positive: repliedAt != null && prospect.replySentiment === "positive",
      converted,
    });
  }
  return out;
}

interface FunnelCounts {
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  replied: number;
  positiveReplied: number;
  signups: number;
  activated: number;
  paid: number;
}

function emptyCounts(): FunnelCounts {
  return { sent: 0, delivered: 0, bounced: 0, complained: 0, replied: 0, positiveReplied: 0, signups: 0, activated: 0, paid: 0 };
}

function isBounced(e: EmailFact): boolean {
  return e.bouncedAt != null || e.status === "bounced";
}

function isComplained(e: EmailFact): boolean {
  return e.complainedAt != null || e.status === "complained";
}

function addEmail(
  counts: FunnelCounts,
  email: EmailFact,
  attribution: EmailAttribution | undefined,
  convertedOrg: OrgFact | undefined,
): void {
  counts.sent += 1;
  if (email.deliveredAt) counts.delivered += 1;
  if (isBounced(email)) counts.bounced += 1;
  if (isComplained(email)) counts.complained += 1;
  if (attribution?.replied) counts.replied += 1;
  if (attribution?.positive) counts.positiveReplied += 1;
  if (attribution?.converted) {
    counts.signups += 1;
    if (convertedOrg && isActivated(convertedOrg)) counts.activated += 1;
    if (convertedOrg && isPaid(convertedOrg)) counts.paid += 1;
  }
}

export function segmentKeyFor(prospect: Pick<ProspectFact, "region" | "venueType">, type: "region" | "venue_type"): string {
  return type === "region" ? normalizeRegion(prospect.region) : prospect.venueType ?? "other";
}

export function buildOutbound(
  emails: EmailFact[],
  prospects: ProspectFact[],
  orgs: OrgFact[],
  campaigns: CampaignFact[],
  variants: ControlCopyVariant[],
  legacySends: number,
  guidance: SegmentGuidance,
  since30: Date,
  now: Date = new Date(),
): GrowthKpis["outbound"] {
  const prospectById = new Map(prospects.map((p) => [p.id, p]));
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const attribution = attributeRepliesToEmails(emails, prospects, now);
  const convertedOrgFor = (email: EmailFact): OrgFact | undefined => {
    const prospect = prospectById.get(email.prospectId);
    return prospect?.convertedOrganizationId != null ? orgById.get(prospect.convertedOrganizationId) : undefined;
  };

  const drafted = emails.filter((e) => e.createdAt >= since30);
  const sentInWindow = emails.filter((e) => e.sentAt != null && e.sentAt >= since30);

  const total = emptyCounts();
  for (const email of sentInWindow) addEmail(total, email, attribution.get(email.id), convertedOrgFor(email));

  const funnel: GrowthKpis["outbound"]["funnel"] = {
    drafted: drafted.length,
    approved: drafted.filter((e) => e.actionStatus === "approved" || e.actionStatus === "executed" || e.actionStatus === "executing")
      .length,
    ...total,
    legacySends,
  };
  const rates: GrowthKpis["outbound"]["rates"] = {
    deliveryRate: rate(total.delivered, total.sent),
    bounceRate: rate(total.bounced, total.sent),
    complaintRate: rate(total.complained, total.sent),
    replyRate: rate(total.replied, total.delivered),
    positiveReplyRate: rate(total.positiveReplied, total.delivered),
    signupRate: rate(total.signups, total.sent),
    paidRate: rate(total.paid, total.sent),
  };

  // Segments: prospects counted for every prospect; funnel fields from sent emails only.
  const bySegment: SegmentStat[] = [];
  for (const type of ["region", "venue_type"] as const) {
    const buckets = new Map<string, FunnelCounts & { prospects: number }>();
    for (const prospect of prospects) {
      const key = segmentKeyFor(prospect, type);
      const bucket = buckets.get(key) ?? { ...emptyCounts(), prospects: 0 };
      bucket.prospects += 1;
      buckets.set(key, bucket);
    }
    for (const email of sentInWindow) {
      const prospect = prospectById.get(email.prospectId);
      if (!prospect) continue;
      const key = segmentKeyFor(prospect, type);
      const bucket = buckets.get(key) ?? { ...emptyCounts(), prospects: 0 };
      addEmail(bucket, email, attribution.get(email.id), convertedOrgFor(email));
      buckets.set(key, bucket);
    }
    const stats = [...buckets.entries()]
      .map(([segment, c]): SegmentStat => ({
        segmentType: type,
        segment,
        prospects: c.prospects,
        sent: c.sent,
        delivered: c.delivered,
        replied: c.replied,
        positiveReplied: c.positiveReplied,
        signups: c.signups,
        activated: c.activated,
        paid: c.paid,
        replyRate: rate(c.replied, c.delivered),
        positiveReplyRate: rate(c.positiveReplied, c.delivered),
        signupRate: rate(c.signups, c.sent),
        guidance: guidanceFor(guidance, type, segment),
      }))
      .sort((a, b) => b.sent - a.sent || b.prospects - a.prospects || a.segment.localeCompare(b.segment))
      .slice(0, 20);
    bySegment.push(...stats);
  }

  // Variants: registry rows always listed; unassigned reported but never a registry row.
  const variantBuckets = new Map<string, FunnelCounts>();
  for (const email of sentInWindow) {
    const key = email.variantKey ?? "unassigned";
    const bucket = variantBuckets.get(key) ?? emptyCounts();
    addEmail(bucket, email, attribution.get(email.id), convertedOrgFor(email));
    variantBuckets.set(key, bucket);
  }
  const byVariant: VariantStat[] = variants.map((variant) =>
    variantStat(variant.key, variant.name, variant.isControl, variant.active, variant.weight, variantBuckets.get(variant.key) ?? emptyCounts()),
  );
  const knownKeys = new Set(variants.map((v) => v.key));
  for (const [key, counts] of variantBuckets) {
    if (knownKeys.has(key)) continue;
    byVariant.push(variantStat(key, key === "unassigned" ? "Unassigned" : `${key} (not in registry)`, false, false, 0, counts));
  }

  // Campaigns: every campaign row, sorted by sent.
  const campaignBuckets = new Map<number, FunnelCounts>();
  for (const email of sentInWindow) {
    if (email.campaignId == null) continue;
    const bucket = campaignBuckets.get(email.campaignId) ?? emptyCounts();
    addEmail(bucket, email, attribution.get(email.id), convertedOrgFor(email));
    campaignBuckets.set(email.campaignId, bucket);
  }
  const byCampaign = campaigns
    .map((campaign) => {
      const c = campaignBuckets.get(campaign.id) ?? emptyCounts();
      return {
        campaignId: campaign.id,
        name: campaign.name,
        status: campaign.status,
        sent: c.sent,
        delivered: c.delivered,
        replied: c.replied,
        positiveReplied: c.positiveReplied,
        signups: c.signups,
        replyRate: rate(c.replied, c.delivered),
      };
    })
    .sort((a, b) => b.sent - a.sent || a.campaignId - b.campaignId);

  // Steps: step ?? 1, ascending.
  const stepBuckets = new Map<number, FunnelCounts>();
  for (const email of sentInWindow) {
    const step = email.step ?? 1;
    const bucket = stepBuckets.get(step) ?? emptyCounts();
    addEmail(bucket, email, attribution.get(email.id), convertedOrgFor(email));
    stepBuckets.set(step, bucket);
  }
  const byStep = [...stepBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, c]) => ({
      step,
      sent: c.sent,
      delivered: c.delivered,
      replied: c.replied,
      complained: c.complained,
      complaintRate: rate(c.complained, c.sent),
    }));

  return { funnel, rates, bySegment, byVariant, byCampaign, byStep };
}

function variantStat(
  variantKey: string,
  name: string,
  isControl: boolean,
  active: boolean,
  weight: number,
  c: FunnelCounts,
): VariantStat {
  return {
    variantKey,
    name,
    isControl,
    active,
    weight,
    sent: c.sent,
    delivered: c.delivered,
    replied: c.replied,
    positiveReplied: c.positiveReplied,
    signups: c.signups,
    replyRate: rate(c.replied, c.delivered),
    positiveReplyRate: rate(c.positiveReplied, c.delivered),
    signupRate: rate(c.signups, c.sent),
    smoothedPositiveReplyRate: Math.round(((c.positiveReplied + 1) / (c.delivered + 2)) * 10_000) / 10_000,
  };
}

function guidanceFor(guidance: SegmentGuidance, type: "region" | "venue_type", segment: string): "prioritize" | "pause" | null {
  if (guidance.pause.some((e) => e.segmentType === type && e.segment === segment)) return "pause";
  if (guidance.prioritize.some((e) => e.segmentType === type && e.segment === segment)) return "prioritize";
  return null;
}

/* ————— Deliverability ————— */

/** Thresholds from research-gtm.md 1.7 (Resend hard limits: 4% bounces, 0.08% complaints). */
export const DELIVERABILITY_THRESHOLDS = {
  pause: { bounce: 0.04, complaint: 0.0008 },
  throttle: { bounce: 0.03, complaint: 0.0005 },
  warn: { bounce: 0.02 },
  restore: { bounce: 0.02, complaint: 0.0003 },
} as const;

export function deliverabilityStatusFor(
  window: { sent: number; bounced: number; complained: number; bounceRate: number | null; complaintRate: number | null },
  minSends: number,
): GrowthKpis["deliverability"]["status"] {
  if (window.sent < minSends) return "insufficient_data";
  const bounce = window.bounceRate ?? 0;
  const complaint = window.complaintRate ?? 0;
  if (bounce >= DELIVERABILITY_THRESHOLDS.pause.bounce || complaint >= DELIVERABILITY_THRESHOLDS.pause.complaint) return "paused";
  if (bounce >= DELIVERABILITY_THRESHOLDS.throttle.bounce || complaint >= DELIVERABILITY_THRESHOLDS.throttle.complaint) {
    return "throttled";
  }
  if (bounce >= DELIVERABILITY_THRESHOLDS.warn.bounce || window.complained > 0) return "warn";
  return "ok";
}

export function buildDeliverability(
  emails: EmailFact[],
  since14: Date,
  minSends: number,
  guard: GuardState,
  baseCap: number,
  effectiveCap: number,
): GrowthKpis["deliverability"] {
  const sent = emails.filter((e) => e.sentAt != null && e.sentAt >= since14);
  const window14d = {
    sent: sent.length,
    delivered: sent.filter((e) => e.deliveredAt != null).length,
    bounced: sent.filter(isBounced).length,
    complained: sent.filter(isComplained).length,
    bounceRate: null as number | null,
    complaintRate: null as number | null,
  };
  window14d.bounceRate = rate(window14d.bounced, window14d.sent);
  window14d.complaintRate = rate(window14d.complained, window14d.sent);
  return {
    window14d,
    status: deliverabilityStatusFor(window14d, minSends),
    guard: { status: guard.status, since: guard.since, reason: guard.reason, baseCap, effectiveCap },
  };
}

/* ————— Experiments summary ————— */

export function buildExperimentsSummary(experiments: ExperimentFact[], now: Date): GrowthKpis["experiments"] {
  const next7 = new Date(now.getTime() + 7 * DAY_MS);
  const since30 = since(now, 30);
  return {
    proposed: experiments.filter((e) => e.status === "proposed").length,
    running: experiments.filter((e) => e.status === "running").length,
    decisionsDue7d: experiments.filter(
      (e) => e.status === "running" && e.decisionDate != null && e.decisionDate < next7,
    ).length,
    decided30d: experiments.filter((e) => e.decidedAt != null && e.decidedAt >= since30).length,
  };
}

/* ————— Legacy fix ————— */

/** Paid = first_paid_at set, or a paid plan already recorded (payg counts). Used by metrics.ts paidCount. */
export function countPaidOrgs(rows: Array<{ plan: string; firstPaidAt: Date | null }>): number {
  return rows.filter((r) => r.firstPaidAt != null || ["starter", "growth", "payg"].includes(r.plan)).length;
}

/* ————— Deltas between two KPI documents (digest, briefing, tool output) ————— */

export interface KpiSeriesDefinition {
  key: string;
  label: string;
  unit: "rate" | "count" | "cents" | "hours";
  direction: "higher" | "lower";
  read(k: GrowthKpis): number | null;
}

/** The headline series every trend readout shares (digest rows, briefing deltas, get_growth_kpis). */
export const KPI_SERIES: KpiSeriesDefinition[] = [
  { key: "signups.orgs7d", label: "Signups (7d)", unit: "count", direction: "higher", read: (k) => k.signups.orgs7d },
  { key: "signups.venues7d", label: "Venues created (7d)", unit: "count", direction: "higher", read: (k) => k.signups.venues7d },
  {
    key: "activation.first_gallery_rate",
    label: "First-gallery activation",
    unit: "rate",
    direction: "higher",
    read: (k) => rate(k.activation.funnel.firstGallery, k.activation.funnel.withVenue),
  },
  {
    key: "activation.time_to_first_gallery_hours_median",
    label: "Median hours to first gallery",
    unit: "hours",
    direction: "lower",
    read: (k) => k.activation.timeToFirstGalleryHours.median,
  },
  { key: "trial.paid_rate", label: "Trial to paid (matured)", unit: "rate", direction: "higher", read: (k) => k.trialToPaid.overall.rate },
  { key: "revenue.mrr_cents", label: "MRR estimate", unit: "cents", direction: "higher", read: (k) => k.revenue.mrrCents },
  { key: "revenue.paid_orgs", label: "Paid organizations", unit: "count", direction: "higher", read: (k) => k.revenue.paidOrgs },
  { key: "credits.consumed_30d", label: "Credits consumed (30d)", unit: "count", direction: "higher", read: (k) => k.credits.consumed30d },
  {
    key: "outbound.positive_reply_rate",
    label: "Positive reply rate",
    unit: "rate",
    direction: "higher",
    read: (k) => k.outbound.rates.positiveReplyRate,
  },
  {
    key: "signups.attributed_30d",
    label: "Signups from outbound (30d)",
    unit: "count",
    direction: "higher",
    read: (k) => k.signups.attributedToOutbound30d,
  },
  { key: "outbound.bounce_rate_14d", label: "Bounce rate (14d)", unit: "rate", direction: "lower", read: (k) => k.deliverability.window14d.bounceRate },
  {
    key: "outbound.complaint_rate_14d",
    label: "Complaint rate (14d)",
    unit: "rate",
    direction: "lower",
    read: (k) => k.deliverability.window14d.complaintRate,
  },
  {
    key: "churn.trials_expiring_7d",
    label: "Trials expiring next 7 days",
    unit: "count",
    direction: "lower",
    read: (k) => k.churn.trialsExpiringNext7d,
  },
  {
    key: "churn.trials_expiring_7d_without_gallery",
    label: "Trials expiring without a gallery",
    unit: "count",
    direction: "lower",
    read: (k) => k.churn.trialsExpiringNext7dWithoutGallery,
  },
];

export interface KpiDelta {
  key: string;
  label: string;
  unit: KpiSeriesDefinition["unit"];
  direction: KpiSeriesDefinition["direction"];
  current: number | null;
  previous: number | null;
  /** current - previous; null when either side is null. */
  delta: number | null;
  tone: "good" | "bad" | "neutral";
}

export function kpiDeltas(current: GrowthKpis, previous: GrowthKpis | null): KpiDelta[] {
  return KPI_SERIES.map((series) => {
    const cur = series.read(current);
    const prev = previous ? series.read(previous) : null;
    const delta = cur != null && prev != null ? Math.round((cur - prev) * 10_000) / 10_000 : null;
    let tone: KpiDelta["tone"] = "neutral";
    if (delta != null && delta !== 0) {
      const improved = series.direction === "higher" ? delta > 0 : delta < 0;
      tone = improved ? "good" : "bad";
    }
    return { key: series.key, label: series.label, unit: series.unit, direction: series.direction, current: cur, previous: prev, delta, tone };
  });
}
