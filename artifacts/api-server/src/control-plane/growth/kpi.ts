import {
  db,
  agentActionsTable,
  controlCampaignsTable,
  controlExperimentsTable,
  controlProspectsTable,
  creditTransactionsTable,
  venuesTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { baseDailyCap, effectiveDailyCap, loadGuard } from "../outreach/sendingHealth.js";
import { getPolicy } from "../policies.js";
import { normalizeSegmentGuidance } from "./adaptationTypes.js";
import { planPrices } from "./config.js";
import {
  DAY_MS,
  buildActivation,
  buildChurn,
  buildCredits,
  buildDeliverability,
  buildExperimentsSummary,
  buildOutbound,
  buildRevenue,
  buildSignups,
  buildTrialToPaid,
  weekStarts,
} from "./kpiMath.js";
import {
  GROWTH_KPI_VERSION,
  type CampaignFact,
  type EmailFact,
  type ExperimentFact,
  type GrowthKpiOptions,
  type GrowthKpis,
  type GrowthLoaders,
  type LedgerFact,
  type OrgFact,
  type PolicyFacts,
  type ProspectFact,
} from "./kpiTypes.js";
import { listVariants } from "./variants.js";

/*
 * KPI data loaders (growth-loop.md 5.2). A few grouped queries produce fact
 * rows; every cohort/funnel computation is pure TypeScript in kpiMath.ts so
 * tests seed facts without a database. Raw SQL below always qualifies
 * identifiers with explicit aliases (o, v, vm, cs, e, a, ev) — unqualified
 * column references inside subselects are what broke list_organizations in
 * production.
 */

const COHORT_WEEKS = 12;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybeRows = (result as { rows?: unknown })?.rows;
  return Array.isArray(maybeRows) ? (maybeRows as T[]) : [];
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

type OrgRow = {
  id: number;
  created_at: unknown;
  plan: string;
  credits_balance: unknown;
  first_paid_at: unknown;
  trial_ends_at: unknown;
  trial_expired_at: unknown;
  churned_at: unknown;
  first_venue_at: unknown;
  photos_ready_at: unknown;
  first_gallery_at: unknown;
  first_viewed_at: unknown;
  second_gallery_at: unknown;
  ready_sessions: unknown;
};

/** One query: organizations with their first venue, photos-ready, first/second gallery and first view timestamps. */
export async function loadOrgFacts(minPhotos: number): Promise<OrgFact[]> {
  const rn = Math.max(1, Math.floor(minPhotos));
  const result = await db.execute<OrgRow>(sql`
    with photos as (
      select v.organization_id, min(t.created_at) as photos_ready_at
      from (
        select vm.venue_id, vm.created_at,
               row_number() over (partition by vm.venue_id order by vm.created_at, vm.id) as rn
        from venue_media vm
      ) t
      join venues v on v.id = t.venue_id
      where t.rn = ${rn} and v.organization_id is not null
      group by v.organization_id
    ), galleries as (
      select v.organization_id,
             min(cs.completed_at) as first_gallery_at,
             min(cs.first_viewed_at) as first_viewed_at,
             count(*)::int as ready_sessions,
             (array_agg(cs.completed_at order by cs.completed_at))[2] as second_gallery_at
      from couple_sessions cs
      join venues v on v.id = cs.venue_id
      where cs.status = 'ready' and cs.completed_at is not null and cs.kind = 'couple' and v.organization_id is not null
      group by v.organization_id
    ), first_venue as (
      select v.organization_id, min(v.created_at) as first_venue_at
      from venues v
      where v.organization_id is not null
      group by v.organization_id
    )
    select o.id, o.created_at, o.plan, o.credits_balance, o.first_paid_at, o.trial_ends_at, o.trial_expired_at, o.churned_at,
           fv.first_venue_at, p.photos_ready_at, g.first_gallery_at, g.first_viewed_at, g.second_gallery_at,
           coalesce(g.ready_sessions, 0)::int as ready_sessions
    from organizations o
    left join first_venue fv on fv.organization_id = o.id
    left join photos p on p.organization_id = o.id
    left join galleries g on g.organization_id = o.id
    order by o.created_at desc
    limit 5000
  `);
  return rowsOf<OrgRow>(result).map((row) => ({
    id: toInt(row.id),
    createdAt: toDate(row.created_at) ?? new Date(0),
    plan: String(row.plan),
    creditsBalance: toInt(row.credits_balance),
    firstPaidAt: toDate(row.first_paid_at),
    trialEndsAt: toDate(row.trial_ends_at),
    trialExpiredAt: toDate(row.trial_expired_at),
    churnedAt: toDate(row.churned_at),
    firstVenueAt: toDate(row.first_venue_at),
    photosReadyAt: toDate(row.photos_ready_at),
    firstGalleryAt: toDate(row.first_gallery_at),
    firstGalleryViewedAt: toDate(row.first_viewed_at),
    secondGalleryAt: toDate(row.second_gallery_at),
    readySessions: toInt(row.ready_sessions),
  }));
}

export async function loadProspectFacts(): Promise<ProspectFact[]> {
  const rows = await db
    .select({
      id: controlProspectsTable.id,
      email: controlProspectsTable.email,
      website: controlProspectsTable.website,
      region: controlProspectsTable.region,
      venueType: controlProspectsTable.venueType,
      status: controlProspectsTable.status,
      campaignId: controlProspectsTable.campaignId,
      contactCount: controlProspectsTable.contactCount,
      repliedAt: controlProspectsTable.repliedAt,
      replySentiment: controlProspectsTable.replySentiment,
      convertedAt: controlProspectsTable.convertedAt,
      convertedOrganizationId: controlProspectsTable.convertedOrganizationId,
      convertedCampaignId: controlProspectsTable.convertedCampaignId,
    })
    .from(controlProspectsTable)
    .orderBy(asc(controlProspectsTable.id))
    .limit(10_000);
  return rows;
}

type EmailRow = {
  id: number;
  prospect_id: number;
  campaign_id: number | null;
  step: number | null;
  variant_key: string | null;
  status: string;
  action_status: string | null;
  created_at: unknown;
  sent_at: unknown;
  delivered_at: unknown;
  bounced_at: unknown;
  complained_at: unknown;
};

export async function loadEmailFacts(since: Date): Promise<EmailFact[]> {
  const result = await db.execute<EmailRow>(sql`
    select e.id, e.prospect_id, e.campaign_id, e.step, e.variant_key, e.status, a.status as action_status,
           e.created_at, e.sent_at, e.delivered_at, e.bounced_at,
           (select min(ev.created_at) from control_email_events ev where ev.email_id = e.id and ev.event_type = 'complained') as complained_at
    from control_outreach_emails e
    left join agent_actions a on a.id = e.action_id
    where e.created_at >= ${since} or e.sent_at >= ${since}
    order by e.id asc
    limit 20000
  `);
  return rowsOf<EmailRow>(result).map((row) => ({
    id: toInt(row.id),
    prospectId: toInt(row.prospect_id),
    campaignId: row.campaign_id == null ? null : toInt(row.campaign_id),
    step: row.step == null ? null : toInt(row.step),
    variantKey: row.variant_key ?? null,
    status: String(row.status),
    actionStatus: row.action_status ?? null,
    createdAt: toDate(row.created_at) ?? new Date(0),
    sentAt: toDate(row.sent_at),
    deliveredAt: toDate(row.delivered_at),
    bouncedAt: toDate(row.bounced_at),
    complainedAt: toDate(row.complained_at),
  }));
}

export async function countLegacySends(since: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentActionsTable)
    .where(
      and(
        eq(agentActionsTable.actionType, "send_prospect_email"),
        eq(agentActionsTable.status, "executed"),
        gte(agentActionsTable.executedAt, since),
      ),
    );
  return row?.total ?? 0;
}

export async function loadLedgerFacts(since: Date): Promise<LedgerFact[]> {
  return db
    .select({
      organizationId: creditTransactionsTable.organizationId,
      reason: creditTransactionsTable.reason,
      delta: creditTransactionsTable.delta,
      createdAt: creditTransactionsTable.createdAt,
    })
    .from(creditTransactionsTable)
    .where(gte(creditTransactionsTable.createdAt, since));
}

export async function loadVenueCreatedAts(since: Date): Promise<Date[]> {
  const rows = await db
    .select({ createdAt: venuesTable.createdAt })
    .from(venuesTable)
    .where(gte(venuesTable.createdAt, since))
    .orderBy(desc(venuesTable.createdAt))
    .limit(5000);
  return rows.map((r) => r.createdAt);
}

export async function loadCampaignFacts(): Promise<CampaignFact[]> {
  return db
    .select({ id: controlCampaignsTable.id, name: controlCampaignsTable.name, status: controlCampaignsTable.status })
    .from(controlCampaignsTable)
    .orderBy(asc(controlCampaignsTable.id))
    .limit(500);
}

export async function loadExperimentFacts(): Promise<ExperimentFact[]> {
  return db
    .select({
      id: controlExperimentsTable.id,
      status: controlExperimentsTable.status,
      decisionDate: controlExperimentsTable.decisionDate,
      decidedAt: controlExperimentsTable.decidedAt,
    })
    .from(controlExperimentsTable)
    .limit(1000);
}

export async function loadPolicyFacts(): Promise<PolicyFacts> {
  const [guidanceRaw, guard, baseCap, effectiveCap] = await Promise.all([
    getPolicy("segment_guidance"),
    loadGuard(),
    baseDailyCap(),
    effectiveDailyCap(),
  ]);
  return { segmentGuidance: normalizeSegmentGuidance(guidanceRaw), guard, baseCap, effectiveCap };
}

export function defaultGrowthLoaders(minPhotos: number): GrowthLoaders {
  return {
    orgs: () => loadOrgFacts(minPhotos),
    prospects: () => loadProspectFacts(),
    emails: (since) => loadEmailFacts(since),
    legacySends: (since) => countLegacySends(since),
    ledger: (since) => loadLedgerFacts(since),
    venueCreatedAts: (since) => loadVenueCreatedAts(since),
    campaigns: () => loadCampaignFacts(),
    variants: () => listVariants(),
    experiments: () => loadExperimentFacts(),
    policies: () => loadPolicyFacts(),
    prices: async () => planPrices(),
  };
}

/**
 * Compute the full KPI document from the loaders. Pure given the loader
 * output; an empty database yields zeros and nulls, never an exception.
 */
export async function computeGrowthKpis(
  loaders: GrowthLoaders,
  now: Date,
  options: GrowthKpiOptions,
): Promise<GrowthKpis> {
  const weeks = weekStarts(now, COHORT_WEEKS);
  const cohortStart = weeks[0]!;
  const start30d = new Date(now.getTime() - 30 * DAY_MS);
  const start14d = new Date(now.getTime() - 14 * DAY_MS);
  const start7d = new Date(now.getTime() - 7 * DAY_MS);
  const earliest = new Date(Math.min(cohortStart.getTime(), start30d.getTime()));

  const [orgs, prospects, emails, legacySends, ledger, venueCreatedAts, campaigns, variants, experiments, policies, prices] =
    await Promise.all([
      loaders.orgs(),
      loaders.prospects(earliest),
      loaders.emails(start30d),
      loaders.legacySends(start30d),
      loaders.ledger(start30d),
      loaders.venueCreatedAts(earliest),
      loaders.campaigns(),
      loaders.variants(),
      loaders.experiments(),
      loaders.policies(),
      loaders.prices(),
    ]);

  const signups = buildSignups(orgs, prospects, venueCreatedAts, now, weeks);
  const activation = buildActivation(orgs, now, weeks, options.minPhotos, options.trialDays);
  const trialToPaid = buildTrialToPaid(orgs, now, weeks, options.trialDays);
  const revenue = buildRevenue(orgs, ledger, prices, start30d);
  const credits = buildCredits(orgs, ledger, start30d);
  const churn = buildChurn(orgs, now, start30d);
  const outbound = buildOutbound(
    emails,
    prospects,
    orgs,
    campaigns,
    variants,
    legacySends,
    policies.segmentGuidance,
    start30d,
    now,
  );
  const deliverability = buildDeliverability(
    emails,
    start14d,
    options.minSendsForGuard,
    policies.guard,
    policies.baseCap,
    policies.effectiveCap,
  );

  const dataQuality: string[] = [
    "Prices from PRICING_* env (display prices); Stripe amounts are not read, so MRR is an estimate",
    "Gallery views include owner previews of the public share link",
  ];
  if (orgs.length === 0) dataQuality.push("No organizations yet; every funnel figure is zero");
  if (outbound.funnel.sent === 0) {
    dataQuality.push("No studio outreach sent in the last 30 days; outbound and segment rates are empty");
  }
  if (deliverability.status === "insufficient_data" && deliverability.window14d.sent > 0) {
    dataQuality.push(
      `Deliverability needs ${options.minSendsForGuard} sends in 14 days before the rule acts (${deliverability.window14d.sent} so far)`,
    );
  }
  const trialsWithoutClock = orgs.filter((o) => o.plan === "trial" && o.trialEndsAt == null).length;
  if (trialsWithoutClock > 0) {
    dataQuality.push(`${trialsWithoutClock} trial organization(s) have no trial_ends_at yet (startup backfill pending)`);
  }
  if (outbound.funnel.legacySends > 0) {
    dataQuality.push(`${outbound.funnel.legacySends} legacy send_prospect_email action(s) executed in the window are not in the studio funnel`);
  }
  const unassigned = outbound.byVariant.find((v) => v.variantKey === "unassigned");
  if (unassigned && unassigned.sent > 0) {
    dataQuality.push(`${unassigned.sent} sent email(s) carry no copy variant (operator or legacy drafts)`);
  }

  return {
    version: GROWTH_KPI_VERSION,
    computedAt: now.toISOString(),
    window: {
      start30d: start30d.toISOString(),
      start14d: start14d.toISOString(),
      start7d: start7d.toISOString(),
      cohortStart: cohortStart.toISOString(),
    },
    signups,
    activation,
    trialToPaid,
    revenue,
    credits,
    churn,
    outbound,
    deliverability,
    experiments: buildExperimentsSummary(experiments, now),
    dataQuality,
  };
}
