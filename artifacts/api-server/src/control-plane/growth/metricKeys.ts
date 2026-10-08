import type { BusinessMetrics } from "../metrics.js";
import type { GrowthKpis } from "./kpiTypes.js";
import { normalizeRegion } from "./segments.js";

/*
 * Metric registry for experiment cards (growth-loop.md 8.1). Every key names
 * one number the evaluator can read from a snapshot, with its unit, the
 * direction that counts as better, and which scopes (segment / copy variant)
 * it supports. Agents pick from this list; nothing else is measurable.
 */

export type MetricUnit = "rate" | "hours" | "cents" | "count";
export type MetricDirection = "higher" | "lower";

export interface MetricScope {
  segment: string | null;
  variantKey: string | null;
}

export interface MetricReading {
  value: number;
  n: number;
}

/** What the evaluator reads: the growth document plus (optionally) the live session metrics. */
export interface MetricSource {
  growth: GrowthKpis;
  sessions?: BusinessMetrics["sessions"];
}

export interface MetricDefinition {
  key: string;
  label: string;
  unit: MetricUnit;
  direction: MetricDirection;
  supportsSegment: boolean;
  supportsVariant: boolean;
  read(source: MetricSource, scope: MetricScope): MetricReading | null;
}

export function parseSegment(segment: string | null | undefined): { type: "region" | "venue_type"; value: string } | null {
  const raw = segment?.trim();
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  const type = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1).trim();
  if (!value) return null;
  if (type === "region") return { type, value: normalizeRegion(value) };
  if (type === "venue_type") return { type, value: value.toLowerCase() };
  return null;
}

function reading(value: number | null | undefined, n: number): MetricReading | null {
  if (value == null || !Number.isFinite(value)) return null;
  return { value, n: Math.max(0, Math.floor(n)) };
}

type OutboundField = "replyRate" | "positiveReplyRate" | "signupRate" | "paidRate";

/** Shared scoped reader for the outbound rates (segment via bySegment, variant via byVariant, both -> null). */
function outboundReader(field: OutboundField, denominator: "delivered" | "sent", allowVariant: boolean) {
  return (source: MetricSource, scope: MetricScope): MetricReading | null => {
    const outbound = source.growth.outbound;
    if (scope.segment && scope.variantKey) return null;
    if (scope.segment) {
      const parsed = parseSegment(scope.segment);
      if (!parsed) return null;
      const stat = outbound.bySegment.find((s) => s.segmentType === parsed.type && s.segment === parsed.value);
      if (!stat) return null;
      return reading(stat[field === "paidRate" ? "signupRate" : field] == null && field !== "paidRate" ? null : scopedValue(stat, field), stat[denominator]);
    }
    if (scope.variantKey) {
      if (!allowVariant) return null;
      const stat = outbound.byVariant.find((v) => v.variantKey === scope.variantKey);
      if (!stat) return null;
      return reading(stat[field as Exclude<OutboundField, "paidRate">], stat[denominator]);
    }
    return reading(outbound.rates[field], outbound.funnel[denominator]);
  };
}

function scopedValue(stat: GrowthKpis["outbound"]["bySegment"][number], field: OutboundField): number | null {
  if (field === "paidRate") return stat.sent > 0 ? Math.round((stat.paid / stat.sent) * 10_000) / 10_000 : null;
  return stat[field];
}

const DEFINITIONS: MetricDefinition[] = [
  {
    key: "outbound.reply_rate",
    label: "Reply rate (replies / delivered)",
    unit: "rate",
    direction: "higher",
    supportsSegment: true,
    supportsVariant: true,
    read: outboundReader("replyRate", "delivered", true),
  },
  {
    key: "outbound.positive_reply_rate",
    label: "Positive reply rate (positive replies / delivered)",
    unit: "rate",
    direction: "higher",
    supportsSegment: true,
    supportsVariant: true,
    read: outboundReader("positiveReplyRate", "delivered", true),
  },
  {
    key: "outbound.signup_rate",
    label: "Signup rate (signups / sent)",
    unit: "rate",
    direction: "higher",
    supportsSegment: true,
    supportsVariant: true,
    read: outboundReader("signupRate", "sent", true),
  },
  {
    key: "outbound.paid_rate",
    label: "Paid rate (paid signups / sent)",
    unit: "rate",
    direction: "higher",
    supportsSegment: true,
    supportsVariant: false,
    read: outboundReader("paidRate", "sent", false),
  },
  {
    key: "outbound.bounce_rate",
    label: "Bounce rate (bounced / sent, 30d)",
    unit: "rate",
    direction: "lower",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) =>
      scope.segment || scope.variantKey ? null : reading(source.growth.outbound.rates.bounceRate, source.growth.outbound.funnel.sent),
  },
  {
    key: "outbound.complaint_rate",
    label: "Complaint rate (complaints / sent, 30d)",
    unit: "rate",
    direction: "lower",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) =>
      scope.segment || scope.variantKey ? null : reading(source.growth.outbound.rates.complaintRate, source.growth.outbound.funnel.sent),
  },
  {
    key: "activation.first_gallery_rate",
    label: "First-gallery activation (first gallery / orgs with a venue)",
    unit: "rate",
    direction: "higher",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) => {
      if (scope.segment || scope.variantKey) return null;
      const funnel = source.growth.activation.funnel;
      if (funnel.withVenue <= 0) return null;
      return reading(Math.round((funnel.firstGallery / funnel.withVenue) * 10_000) / 10_000, funnel.withVenue);
    },
  },
  {
    key: "activation.first_gallery_within_14d",
    label: "First gallery within 14 days (matured orgs)",
    unit: "rate",
    direction: "higher",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) =>
      scope.segment || scope.variantKey
        ? null
        : reading(source.growth.activation.firstGalleryWithin14d, source.growth.activation.funnel.orgs),
  },
  {
    key: "activation.time_to_first_gallery_hours_median",
    label: "Median hours from signup to first gallery",
    unit: "hours",
    direction: "lower",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) =>
      scope.segment || scope.variantKey
        ? null
        : reading(source.growth.activation.timeToFirstGalleryHours.median, source.growth.activation.timeToFirstGalleryHours.n),
  },
  {
    key: "trial.paid_rate",
    label: "Trial to paid (matured cohorts)",
    unit: "rate",
    direction: "higher",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) =>
      scope.segment || scope.variantKey ? null : reading(source.growth.trialToPaid.overall.rate, source.growth.trialToPaid.overall.orgs),
  },
  {
    key: "trial.activated_paid_rate",
    label: "Trial to paid among activated orgs",
    unit: "rate",
    direction: "higher",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) =>
      scope.segment || scope.variantKey
        ? null
        : reading(source.growth.trialToPaid.byActivation.activated.rate, source.growth.trialToPaid.byActivation.activated.orgs),
  },
  {
    key: "revenue.mrr_cents",
    label: "MRR estimate (cents, display prices)",
    unit: "cents",
    direction: "higher",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) =>
      scope.segment || scope.variantKey ? null : reading(source.growth.revenue.mrrCents, source.growth.revenue.subscriptionOrgs),
  },
  {
    key: "credits.consumed_30d",
    label: "Credits consumed in 30 days",
    unit: "count",
    direction: "higher",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) =>
      scope.segment || scope.variantKey ? null : reading(source.growth.credits.consumed30d, source.growth.revenue.paidOrgs),
  },
  {
    key: "churn.logo_churn_rate_30d",
    label: "Logo churn (subscriptions deleted / paid orgs at window start)",
    unit: "rate",
    direction: "lower",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) =>
      scope.segment || scope.variantKey ? null : reading(source.growth.churn.logoChurnRate30d, source.growth.churn.paidOrgsAtWindowStart),
  },
  {
    key: "sessions.failure_rate_7d",
    label: "Gallery failure rate (failed / created, 7d)",
    unit: "rate",
    direction: "lower",
    supportsSegment: false,
    supportsVariant: false,
    read: (source, scope) => {
      if (scope.segment || scope.variantKey) return null;
      const sessions = source.sessions;
      if (!sessions || sessions.created7d <= 0) return null;
      return reading(Math.round((sessions.failureRate7d / 100) * 10_000) / 10_000, sessions.created7d);
    },
  },
];

export const METRIC_KEYS: Record<string, MetricDefinition> = Object.fromEntries(DEFINITIONS.map((d) => [d.key, d]));

export function listMetricKeys(): Array<Pick<MetricDefinition, "key" | "label" | "unit" | "direction" | "supportsSegment" | "supportsVariant">> {
  return DEFINITIONS.map(({ key, label, unit, direction, supportsSegment, supportsVariant }) => ({
    key,
    label,
    unit,
    direction,
    supportsSegment,
    supportsVariant,
  }));
}

/** One line per key for tool descriptions: "key (unit, higher is better)". */
export function describeMetricKeys(): string {
  return DEFINITIONS.map((m) => `${m.key} (${m.unit}, ${m.direction} is better)`).join(", ");
}
