import type { ControlCopyVariant } from "@workspace/db";
import type { GuardState } from "../outreach/sendingHealth.js";
import { EMPTY_SEGMENT_GUIDANCE, type SegmentGuidance } from "./adaptationTypes.js";
import { computeGrowthKpis } from "./kpi.js";
import { DAY_MS } from "./kpiMath.js";
import type {
  CampaignFact,
  EmailFact,
  ExperimentFact,
  GrowthKpiOptions,
  GrowthKpis,
  GrowthLoaders,
  LedgerFact,
  OrgFact,
  Prices,
  ProspectFact,
  SegmentStat,
  VariantStat,
} from "./kpiTypes.js";
import { VARIANT_DEFAULTS } from "./variants.js";

/*
 * In-memory fixtures for the growth suites (growth-loop.md section 15). No
 * database: computeGrowthKpis runs over loaders that return these rows.
 */

export const NOW = new Date("2026-10-08T12:00:00Z");

export function daysAgo(days: number, from: Date = NOW): Date {
  return new Date(from.getTime() - days * DAY_MS);
}

export function hoursAfter(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 3_600_000);
}

export const DEFAULT_PRICES: Prices = { source: "env", starterCents: 12900, growthCents: 27900, creditPackCents: 5900 };

export const OK_GUARD: GuardState = { status: "ok", since: null, reason: null, okDays: 0 };

export function makeOrg(overrides: Partial<OrgFact> & { id: number }): OrgFact {
  return {
    createdAt: daysAgo(30),
    plan: "trial",
    creditsBalance: 5,
    firstPaidAt: null,
    trialEndsAt: null,
    trialExpiredAt: null,
    churnedAt: null,
    firstVenueAt: null,
    photosReadyAt: null,
    firstGalleryAt: null,
    firstGalleryViewedAt: null,
    secondGalleryAt: null,
    readySessions: 0,
    ...overrides,
  };
}

export function makeProspect(overrides: Partial<ProspectFact> & { id: number }): ProspectFact {
  return {
    email: `venue${overrides.id}@example.com`,
    website: null,
    region: "Austin, TX",
    venueType: "barn_farm",
    status: "contacted",
    campaignId: null,
    contactCount: 1,
    repliedAt: null,
    replySentiment: null,
    convertedAt: null,
    convertedOrganizationId: null,
    convertedCampaignId: null,
    ...overrides,
  };
}

export function makeEmail(overrides: Partial<EmailFact> & { id: number; prospectId: number }): EmailFact {
  const sentAt = overrides.sentAt === undefined ? daysAgo(5) : overrides.sentAt;
  return {
    campaignId: null,
    step: 1,
    variantKey: "tours_to_bookings",
    status: "sent",
    actionStatus: "executed",
    createdAt: sentAt ?? daysAgo(5),
    sentAt,
    deliveredAt: sentAt,
    bouncedAt: null,
    complainedAt: null,
    ...overrides,
  };
}

export function makeLedger(reason: string, delta: number, createdAt: Date = daysAgo(3), organizationId: number | null = 1): LedgerFact {
  return { organizationId, reason, delta, createdAt };
}

let variantSeq = 1;
export function makeVariant(overrides: Partial<ControlCopyVariant> & { key: string }): ControlCopyVariant {
  const defaults = VARIANT_DEFAULTS.find((v) => v.key === overrides.key);
  return {
    id: variantSeq++,
    name: defaults?.name ?? overrides.key,
    angle: defaults?.angle ?? "An angle long enough for the registry to accept it as a real angle.",
    defaultAsk: defaults?.defaultAsk ?? "preview",
    isControl: defaults?.isControl ?? false,
    active: true,
    weight: defaults?.weight ?? 0.25,
    pausedReason: null,
    createdBy: "seed",
    createdAt: daysAgo(60),
    updatedAt: daysAgo(60),
    ...overrides,
  };
}

export function defaultVariants(): ControlCopyVariant[] {
  return VARIANT_DEFAULTS.map((v) => makeVariant({ key: v.key }));
}

export interface FixtureData {
  orgs?: OrgFact[];
  prospects?: ProspectFact[];
  emails?: EmailFact[];
  legacySends?: number;
  ledger?: LedgerFact[];
  venueCreatedAts?: Date[];
  campaigns?: CampaignFact[];
  variants?: ControlCopyVariant[];
  experiments?: ExperimentFact[];
  guard?: GuardState;
  baseCap?: number;
  effectiveCap?: number;
  segmentGuidance?: SegmentGuidance;
  prices?: Prices;
}

export function makeLoaders(data: FixtureData = {}): GrowthLoaders {
  return {
    orgs: async () => data.orgs ?? [],
    prospects: async () => data.prospects ?? [],
    emails: async () => data.emails ?? [],
    legacySends: async () => data.legacySends ?? 0,
    ledger: async () => data.ledger ?? [],
    venueCreatedAts: async () => data.venueCreatedAts ?? [],
    campaigns: async () => data.campaigns ?? [],
    variants: async () => data.variants ?? defaultVariants(),
    experiments: async () => data.experiments ?? [],
    policies: async () => ({
      segmentGuidance: data.segmentGuidance ?? { ...EMPTY_SEGMENT_GUIDANCE },
      guard: data.guard ?? OK_GUARD,
      baseCap: data.baseCap ?? 15,
      effectiveCap: data.effectiveCap ?? data.baseCap ?? 15,
    }),
    prices: async () => data.prices ?? DEFAULT_PRICES,
  };
}

export const DEFAULT_OPTIONS: GrowthKpiOptions = { minPhotos: 3, trialDays: 14, minSendsForGuard: 50 };

export async function fixtureKpis(data: FixtureData = {}, options: Partial<GrowthKpiOptions> = {}, now: Date = NOW): Promise<GrowthKpis> {
  return computeGrowthKpis(makeLoaders(data), now, { ...DEFAULT_OPTIONS, ...options });
}

export function makeSegment(overrides: Partial<SegmentStat> & { segment: string }): SegmentStat {
  const sent = overrides.sent ?? 0;
  const delivered = overrides.delivered ?? sent;
  const replied = overrides.replied ?? 0;
  const positiveReplied = overrides.positiveReplied ?? 0;
  const signups = overrides.signups ?? 0;
  const r = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null);
  return {
    segmentType: "region",
    prospects: Math.max(sent, 1),
    sent,
    delivered,
    replied,
    positiveReplied,
    signups,
    activated: 0,
    paid: 0,
    replyRate: r(replied, delivered),
    positiveReplyRate: r(positiveReplied, delivered),
    signupRate: r(signups, sent),
    guidance: null,
    ...overrides,
  };
}

export function makeVariantStat(overrides: Partial<VariantStat> & { variantKey: string }): VariantStat {
  const sent = overrides.sent ?? 0;
  const delivered = overrides.delivered ?? sent;
  const replied = overrides.replied ?? 0;
  const positiveReplied = overrides.positiveReplied ?? 0;
  const signups = overrides.signups ?? 0;
  const r = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null);
  return {
    name: overrides.variantKey,
    isControl: false,
    active: true,
    weight: 0.25,
    sent,
    delivered,
    replied,
    positiveReplied,
    signups,
    replyRate: r(replied, delivered),
    positiveReplyRate: r(positiveReplied, delivered),
    signupRate: r(signups, sent),
    smoothedPositiveReplyRate: Math.round(((positiveReplied + 1) / (delivered + 2)) * 10_000) / 10_000,
    ...overrides,
  };
}
