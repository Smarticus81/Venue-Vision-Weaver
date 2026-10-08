import type { ControlCopyVariant } from "@workspace/db";
import type { GuardState } from "../outreach/sendingHealth.js";
import type { SegmentGuidance } from "./adaptationTypes.js";

/*
 * Outcome KPI model (growth-loop.md 5.1). Stored at
 * control_metrics_snapshots.metrics.growth and returned by GET /control/growth.
 * All rates are fractions 0..1 (the UI formats %), money is integer cents,
 * durations are hours. The shape mirrors the OpenAPI GrowthKpis schema; the
 * route handler asserts assignability at compile time.
 */

export const GROWTH_KPI_VERSION = 1;

export interface SegmentStat {
  segmentType: "region" | "venue_type";
  segment: string;
  prospects: number;
  sent: number;
  delivered: number;
  replied: number;
  positiveReplied: number;
  signups: number;
  activated: number;
  paid: number;
  replyRate: number | null;
  positiveReplyRate: number | null;
  signupRate: number | null;
  /** From policy segment_guidance. */
  guidance: "prioritize" | "pause" | null;
}

export interface VariantStat {
  variantKey: string;
  name: string;
  isControl: boolean;
  active: boolean;
  weight: number;
  sent: number;
  delivered: number;
  replied: number;
  positiveReplied: number;
  signups: number;
  replyRate: number | null;
  positiveReplyRate: number | null;
  signupRate: number | null;
  /** (positiveReplied + 1) / (delivered + 2): the Laplace-smoothed rate the reweight rule uses. */
  smoothedPositiveReplyRate: number;
}

export interface Prices {
  /** "stripe" is reserved for a later Stripe unit_amount lookup; this window reads env only. */
  source: "env";
  starterCents: number;
  growthCents: number;
  creditPackCents: number;
}

export interface GrowthKpis {
  version: number;
  computedAt: string;
  window: { start30d: string; start14d: string; start7d: string; cohortStart: string };
  signups: {
    orgs7d: number;
    orgs30d: number;
    venues7d: number;
    venues30d: number;
    /** Prospects converted in the window with contactCount > 0. */
    attributedToOutbound30d: number;
    byWeek: Array<{ weekStart: string; orgs: number; venues: number; attributed: number }>;
  };
  activation: {
    minPhotos: number;
    funnel: {
      orgs: number;
      withVenue: number;
      photosReady: number;
      firstGallery: number;
      galleryViewed: number;
      secondGallery14d: number;
    };
    /** Each stage over the previous one. */
    rates: {
      withVenue: number | null;
      photosReady: number | null;
      firstGallery: number | null;
      galleryViewed: number | null;
      secondGallery14d: number | null;
    };
    timeToFirstGalleryHours: { median: number | null; p75: number | null; n: number };
    /** Share of matured orgs (createdAt + 7d <= now) that reached a first gallery within 7 days. */
    firstGalleryWithin7d: number | null;
    firstGalleryWithin14d: number | null;
    byCohortWeek: Array<{
      weekStart: string;
      orgs: number;
      photosReady: number;
      firstGallery: number;
      galleryViewed: number;
      secondGallery14d: number;
      paid: number;
      matured: boolean;
    }>;
  };
  trialToPaid: {
    /** Matured cohorts only (mondayOf(createdAt) + 7d + trialDays <= now). */
    overall: RateTriple;
    byActivation: { activated: RateTriple; notActivated: RateTriple };
    byCohortWeek: Array<{ weekStart: string; orgs: number; paid: number; rate: number | null; matured: boolean }>;
    medianDaysToPaid: number | null;
  };
  revenue: {
    planMix: Record<"trial" | "starter" | "growth" | "payg" | "none", number>;
    /** firstPaidAt not null and not churned since (churnedAt null or firstPaidAt > churnedAt). */
    paidOrgs: number;
    /** plan in (starter, growth). */
    subscriptionOrgs: number;
    /** starter * price + growth * price, from the published PRICING_* env (display prices). */
    mrrCents: number;
    arpaCents: number | null;
    packPurchases30d: number;
    packRevenueCents30d: number;
    prices: Prices;
  };
  credits: {
    purchased30d: number;
    subscriptionGranted30d: number;
    consumed30d: number;
    refunded30d: number;
    promo30d: number;
    trialGranted30d: number;
    consumedPerPaidOrg30d: number | null;
    /** Sum of every organization's current balance. */
    float: number;
  };
  churn: {
    subscriptionsDeleted30d: number;
    trialsExpired30d: number;
    trialsExpiredWithoutPurchase30d: number;
    paidOrgsAtWindowStart: number;
    logoChurnRate30d: number | null;
    trialsExpiringNext7d: number;
    trialsExpiringNext7dWithoutGallery: number;
  };
  outbound: {
    funnel: {
      drafted: number;
      approved: number;
      sent: number;
      delivered: number;
      bounced: number;
      complained: number;
      replied: number;
      positiveReplied: number;
      signups: number;
      activated: number;
      paid: number;
      /** Executed legacy send_prospect_email actions in the window (zero in production). */
      legacySends: number;
    };
    rates: {
      deliveryRate: number | null;
      bounceRate: number | null;
      complaintRate: number | null;
      replyRate: number | null;
      positiveReplyRate: number | null;
      signupRate: number | null;
      paidRate: number | null;
    };
    /** Top 20 by sent per segment type. */
    bySegment: SegmentStat[];
    byVariant: VariantStat[];
    byCampaign: Array<{
      campaignId: number;
      name: string;
      status: string;
      sent: number;
      delivered: number;
      replied: number;
      positiveReplied: number;
      signups: number;
      replyRate: number | null;
    }>;
    byStep: Array<{
      step: number;
      sent: number;
      delivered: number;
      replied: number;
      complained: number;
      complaintRate: number | null;
    }>;
  };
  deliverability: {
    window14d: {
      sent: number;
      delivered: number;
      bounced: number;
      complained: number;
      bounceRate: number | null;
      complaintRate: number | null;
    };
    status: DeliverabilityStatus;
    guard: { status: string; since: string | null; reason: string | null; baseCap: number; effectiveCap: number };
  };
  experiments: { proposed: number; running: number; decisionsDue7d: number; decided30d: number };
  /** Human-readable caveats, e.g. "Prices from PRICING_* env (display prices)". */
  dataQuality: string[];
}

export interface RateTriple {
  orgs: number;
  paid: number;
  rate: number | null;
}

export type DeliverabilityStatus = "ok" | "warn" | "throttled" | "paused" | "insufficient_data";

/* ————— Fact rows the loaders produce; all cohort math is pure over these ————— */

export interface OrgFact {
  id: number;
  createdAt: Date;
  plan: string;
  creditsBalance: number;
  firstPaidAt: Date | null;
  trialEndsAt: Date | null;
  trialExpiredAt: Date | null;
  churnedAt: Date | null;
  firstVenueAt: Date | null;
  /** When the org's first venue reached `minPhotos` uploads. */
  photosReadyAt: Date | null;
  firstGalleryAt: Date | null;
  firstGalleryViewedAt: Date | null;
  secondGalleryAt: Date | null;
  readySessions: number;
}

export interface ProspectFact {
  id: number;
  email: string;
  website: string | null;
  region: string | null;
  venueType: string | null;
  status: string;
  campaignId: number | null;
  contactCount: number;
  repliedAt: Date | null;
  replySentiment: string | null;
  convertedAt: Date | null;
  convertedOrganizationId: number | null;
  convertedCampaignId: number | null;
}

export interface EmailFact {
  id: number;
  prospectId: number;
  campaignId: number | null;
  step: number | null;
  variantKey: string | null;
  status: string;
  actionStatus: string | null;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  bouncedAt: Date | null;
  /** min(control_email_events.created_at) where event_type = 'complained'. */
  complainedAt: Date | null;
}

export interface LedgerFact {
  organizationId: number | null;
  reason: string;
  delta: number;
  createdAt: Date;
}

export interface ExperimentFact {
  id: number;
  status: string;
  decisionDate: Date | null;
  decidedAt: Date | null;
}

export interface CampaignFact {
  id: number;
  name: string;
  status: string;
}

export interface PolicyFacts {
  segmentGuidance: SegmentGuidance;
  guard: GuardState;
  baseCap: number;
  effectiveCap: number;
}

export interface GrowthLoaders {
  /** All organizations (small table; newest 5000). */
  orgs(): Promise<OrgFact[]>;
  /** All prospects (segments need uncontacted ones too); cap 10000. */
  prospects(since: Date): Promise<ProspectFact[]>;
  /** Studio emails created >= since plus any sent >= since. */
  emails(since: Date): Promise<EmailFact[]>;
  /** Executed legacy send_prospect_email actions since `since`. */
  legacySends(since: Date): Promise<number>;
  ledger(since: Date): Promise<LedgerFact[]>;
  /** Venue creation timestamps since `since` (signups by week). */
  venueCreatedAts(since: Date): Promise<Date[]>;
  campaigns(): Promise<CampaignFact[]>;
  variants(): Promise<ControlCopyVariant[]>;
  experiments(): Promise<ExperimentFact[]>;
  policies(): Promise<PolicyFacts>;
  prices(): Promise<Prices>;
}

export interface GrowthKpiOptions {
  minPhotos: number;
  trialDays: number;
  minSendsForGuard: number;
}
