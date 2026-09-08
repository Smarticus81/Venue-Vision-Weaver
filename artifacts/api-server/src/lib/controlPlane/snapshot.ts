import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  organizationsTable,
  venuesTable,
  venueMediaTable,
  coupleSessionsTable,
  creditTransactionsTable,
  controlPlaneAgentsTable,
  controlPlaneDecisionsTable,
  controlPlaneExperimentsTable,
  controlPlaneExperimentEventsTable,
  controlPlaneLeadsTable,
  controlPlaneMemoryTable,
  controlPlaneMetricsTable,
  controlPlaneRunsTable,
  controlPlaneSignalsTable,
  controlPlaneTicketsTable,
  controlPlaneWorkItemsTable,
} from "@workspace/db";
import type {
  AgentDomain,
  BusinessSnapshot,
  DecisionLedgerSnapshot,
  ExperimentSnapshot,
  FunnelWindowSnapshot,
  MemoryNote,
  MetricPoint,
  OpenDecisionRef,
  Severity,
  VenueSnapshot,
} from "@workspace/control-plane";
import { estimateSessionCostUsd } from "../cost.js";
import { VENUE_MEDIA_COVERAGES } from "../venueMediaCoverage.js";
import { MIN_VENUE_PHOTOS } from "../credits.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Monthly list price per plan, used for the margin estimate only. */
function planPriceUsd(plan: string): number {
  const key = `CONTROL_PLANE_PRICE_${plan.toUpperCase()}_USD`;
  const configured = Number(process.env[key]);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  if (plan === "starter") return 99;
  if (plan === "growth") return 299;
  return 0;
}

function hoursSince(date: Date | null | undefined, now: Date): number | null {
  if (!date) return null;
  return (now.getTime() - date.getTime()) / HOUR_MS;
}

function daysSince(date: Date | null | undefined, now: Date): number | null {
  if (!date) return null;
  return (now.getTime() - date.getTime()) / DAY_MS;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = (result as { rows?: unknown })?.rows;
  return Array.isArray(maybe) ? (maybe as T[]) : [];
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface FunnelRow extends Record<string, unknown> {
  started: unknown;
  ready: unknown;
  failed: unknown;
  processing: unknown;
  median_minutes: unknown;
}

/**
 * One window of the delivery funnel. Median time-to-ready is computed in
 * Postgres rather than pulled into memory — these windows can be large on a
 * busy organisation and only five numbers ever leave the database.
 */
async function funnelWindow(
  organizationId: number,
  fromMs: number,
  toMs: number,
): Promise<FunnelWindowSnapshot> {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const result = await db.execute<FunnelRow>(sql`
    select
      count(*) filter (where s.created_at >= ${from} and s.created_at < ${to}) as started,
      count(*) filter (where s.status = 'ready' and s.completed_at >= ${from} and s.completed_at < ${to}) as ready,
      count(*) filter (where s.status = 'failed' and coalesce(s.completed_at, s.created_at) >= ${from} and coalesce(s.completed_at, s.created_at) < ${to}) as failed,
      count(*) filter (where s.status in ('pending','processing') and s.created_at >= ${from}) as processing,
      percentile_cont(0.5) within group (
        order by extract(epoch from (s.completed_at - s.created_at)) / 60.0
      ) filter (where s.status = 'ready' and s.completed_at >= ${from} and s.completed_at < ${to}) as median_minutes
    from couple_sessions s
    join venues v on v.id = s.venue_id
    where v.organization_id = ${organizationId}
  `);

  const row = rowsOf<FunnelRow>(result)[0];
  const median = row?.median_minutes;
  return {
    started: toNumber(row?.started),
    ready: toNumber(row?.ready),
    failed: toNumber(row?.failed),
    processing: toNumber(row?.processing),
    medianMinutesToReady:
      median === null || median === undefined ? null : Math.round(toNumber(median) * 100) / 100,
  };
}

interface VenueAggregateRow extends Record<string, unknown> {
  id: number;
  name: string;
  slug: string;
  owner_email: string;
  contact_email: string | null;
  created_at: Date;
  media_count: unknown;
  coverages: string[] | null;
  sessions_total: unknown;
  sessions_7d: unknown;
  sessions_prev_7d: unknown;
  sessions_30d: unknown;
  ready_count: unknown;
  failed_count: unknown;
  last_session_at: Date | null;
}

async function venueSnapshots(organizationId: number, now: Date): Promise<VenueSnapshot[]> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const result = await db.execute<VenueAggregateRow>(sql`
    select
      v.id, v.name, v.slug, v.owner_email, v.contact_email, v.created_at,
      (select count(*) from venue_media m where m.venue_id = v.id) as media_count,
      (select array_agg(distinct m.coverage) from venue_media m where m.venue_id = v.id) as coverages,
      count(s.id) as sessions_total,
      count(s.id) filter (where s.created_at >= ${sevenDaysAgo}) as sessions_7d,
      count(s.id) filter (where s.created_at >= ${fourteenDaysAgo} and s.created_at < ${sevenDaysAgo}) as sessions_prev_7d,
      count(s.id) filter (where s.created_at >= ${thirtyDaysAgo}) as sessions_30d,
      count(s.id) filter (where s.status = 'ready') as ready_count,
      count(s.id) filter (where s.status = 'failed') as failed_count,
      max(s.created_at) as last_session_at
    from venues v
    left join couple_sessions s on s.venue_id = v.id
    where v.organization_id = ${organizationId}
    group by v.id
    order by v.created_at asc
  `);

  return rowsOf<VenueAggregateRow>(result).map((row) => {
    const present = new Set((row.coverages ?? []).filter(Boolean));
    const mediaCount = toNumber(row.media_count);
    const createdAt = new Date(row.created_at);
    const lastSessionAt = row.last_session_at ? new Date(row.last_session_at) : null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerEmail: row.owner_email,
      contactEmail: row.contact_email,
      createdAt: createdAt.toISOString(),
      ageDays: Math.floor(daysSince(createdAt, now) ?? 0),
      mediaCount,
      coverageGaps: VENUE_MEDIA_COVERAGES.filter((coverage) => !present.has(coverage)),
      ready: mediaCount >= MIN_VENUE_PHOTOS,
      sessionsTotal: toNumber(row.sessions_total),
      sessionsLast7d: toNumber(row.sessions_7d),
      sessionsPrev7d: toNumber(row.sessions_prev_7d),
      sessionsLast30d: toNumber(row.sessions_30d),
      readyCount: toNumber(row.ready_count),
      failedCount: toNumber(row.failed_count),
      lastSessionAt: lastSessionAt?.toISOString() ?? null,
      daysSinceLastSession:
        lastSessionAt === null ? null : Math.floor(daysSince(lastSessionAt, now) ?? 0),
    } satisfies VenueSnapshot;
  });
}

interface CreditRow extends Record<string, unknown> {
  granted_30d: unknown;
  burned_30d: unknown;
  burned_7d: unknown;
  refunds_30d: unknown;
}

async function financeSnapshot(
  organizationId: number,
  creditsBalance: number,
  plan: string,
  now: Date,
) {
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const result = await db.execute<CreditRow>(sql`
    select
      coalesce(sum(delta) filter (where delta > 0 and created_at >= ${thirtyDaysAgo}), 0) as granted_30d,
      coalesce(-sum(delta) filter (where delta < 0 and created_at >= ${thirtyDaysAgo}), 0) as burned_30d,
      coalesce(-sum(delta) filter (where delta < 0 and created_at >= ${sevenDaysAgo}), 0) as burned_7d,
      coalesce(count(*) filter (where reason = 'session_refund' and created_at >= ${thirtyDaysAgo}), 0) as refunds_30d
    from credit_transactions
    where organization_id = ${organizationId}
  `);

  const row = rowsOf<CreditRow>(result)[0];
  const burned30d = toNumber(row?.burned_30d);
  const burned7d = toNumber(row?.burned_7d);
  const perDay = burned7d / 7;
  const price = planPriceUsd(plan);

  return {
    creditsBalance,
    creditsGranted30d: toNumber(row?.granted_30d),
    creditsBurned30d: burned30d,
    creditsBurned7d: burned7d,
    estimatedCogsUsd30d: Math.round(burned30d * estimateSessionCostUsd() * 100) / 100,
    estimatedRevenueUsd30d: price,
    runwayDays: perDay > 0 ? Math.round((creditsBalance / perDay) * 100) / 100 : null,
    refunds30d: toNumber(row?.refunds_30d),
    planPriceUsd: price,
  };
}

interface ExperimentAggregateRow {
  experiment_id: number;
  variant: string;
  metric: string;
  exposures: unknown;
  conversions: unknown;
}

async function experimentSnapshots(
  organizationId: number,
  now: Date,
): Promise<ExperimentSnapshot[]> {
  const experiments = await db
    .select()
    .from(controlPlaneExperimentsTable)
    .where(eq(controlPlaneExperimentsTable.organizationId, organizationId))
    .orderBy(desc(controlPlaneExperimentsTable.createdAt))
    .limit(50);
  if (!experiments.length) return [];

  const ids = experiments.map((experiment) => experiment.id);
  const events = await db
    .select({
      experimentId: controlPlaneExperimentEventsTable.experimentId,
      variant: controlPlaneExperimentEventsTable.variant,
      metric: controlPlaneExperimentEventsTable.metric,
      total: sql<number>`count(*)`,
    })
    .from(controlPlaneExperimentEventsTable)
    .where(inArray(controlPlaneExperimentEventsTable.experimentId, ids))
    .groupBy(
      controlPlaneExperimentEventsTable.experimentId,
      controlPlaneExperimentEventsTable.variant,
      controlPlaneExperimentEventsTable.metric,
    );

  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(`${event.experimentId}|${event.variant}|${event.metric}`, toNumber(event.total));
  }

  return experiments.map((experiment) => {
    const startedAt = experiment.startedAt ? new Date(experiment.startedAt) : null;
    return {
      id: experiment.id,
      key: experiment.key,
      hypothesis: experiment.hypothesis,
      surface: experiment.surface,
      primaryMetric: experiment.primaryMetric,
      status: experiment.status,
      minimumSampleSize: experiment.minimumSampleSize,
      ageDays: startedAt === null ? null : Math.round((daysSince(startedAt, now) ?? 0) * 10) / 10,
      variants: experiment.variants.map((variant) => {
        const exposures = counts.get(`${experiment.id}|${variant.key}|exposure`) ?? 0;
        const conversions =
          counts.get(`${experiment.id}|${variant.key}|${experiment.primaryMetric}`) ?? 0;
        return {
          key: variant.key,
          label: variant.label,
          exposures,
          conversions,
          conversionRate: exposures > 0 ? conversions / exposures : 0,
        };
      }),
    } satisfies ExperimentSnapshot;
  });
}

async function ledgerSnapshot(
  organizationId: number,
  reviewSlaHours: number,
  now: Date,
): Promise<DecisionLedgerSnapshot> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  const open = await db
    .select({
      id: controlPlaneDecisionsTable.id,
      agentKey: controlPlaneDecisionsTable.agentKey,
      title: controlPlaneDecisionsTable.title,
      riskLevel: controlPlaneDecisionsTable.riskLevel,
      createdAt: controlPlaneDecisionsTable.createdAt,
    })
    .from(controlPlaneDecisionsTable)
    .where(
      and(
        eq(controlPlaneDecisionsTable.organizationId, organizationId),
        inArray(controlPlaneDecisionsTable.status, ["proposed", "approved"]),
      ),
    )
    .orderBy(controlPlaneDecisionsTable.createdAt)
    .limit(300);

  const [executed] = await db
    .select({ total: sql<number>`count(*)` })
    .from(controlPlaneDecisionsTable)
    .where(
      and(
        eq(controlPlaneDecisionsTable.organizationId, organizationId),
        eq(controlPlaneDecisionsTable.status, "executed"),
        gte(controlPlaneDecisionsTable.executedAt, dayAgo),
      ),
    );

  const byStatus = await db
    .select({
      agentKey: controlPlaneDecisionsTable.agentKey,
      status: controlPlaneDecisionsTable.status,
      total: sql<number>`count(*)`,
    })
    .from(controlPlaneDecisionsTable)
    .where(
      and(
        eq(controlPlaneDecisionsTable.organizationId, organizationId),
        gte(controlPlaneDecisionsTable.createdAt, weekAgo),
      ),
    )
    .groupBy(controlPlaneDecisionsTable.agentKey, controlPlaneDecisionsTable.status);

  const perAgent = new Map<string, { open: number; executed7d: number; rejected7d: number }>();
  let approved7d = 0;
  let rejected7d = 0;
  for (const row of byStatus) {
    const entry = perAgent.get(row.agentKey) ?? { open: 0, executed7d: 0, rejected7d: 0 };
    const total = toNumber(row.total);
    if (row.status === "executed") {
      entry.executed7d += total;
      approved7d += total;
    } else if (row.status === "approved") {
      approved7d += total;
    } else if (row.status === "rejected") {
      entry.rejected7d += total;
      rejected7d += total;
    } else if (row.status === "proposed") {
      entry.open += total;
    }
    perAgent.set(row.agentKey, entry);
  }

  return {
    openCount: open.length,
    executed24h: toNumber(executed?.total),
    approved7d,
    rejected7d,
    stale: open
      .map((decision) => ({
        id: decision.id,
        agentKey: decision.agentKey,
        title: decision.title,
        ageHours: Math.round((hoursSince(decision.createdAt, now) ?? 0) * 10) / 10,
        riskLevel: decision.riskLevel as DecisionLedgerSnapshot["stale"][number]["riskLevel"],
      }))
      .filter((decision) => decision.ageHours >= reviewSlaHours)
      .sort((a, b) => b.ageHours - a.ageHours)
      .slice(0, 20),
    byAgent: [...perAgent.entries()].map(([agentKey, entry]) => ({ agentKey, ...entry })),
  };
}

async function metricHistory(organizationId: number): Promise<Record<string, MetricPoint[]>> {
  const rows = await db
    .select({
      metricKey: controlPlaneMetricsTable.metricKey,
      metricDate: controlPlaneMetricsTable.metricDate,
      value: controlPlaneMetricsTable.value,
    })
    .from(controlPlaneMetricsTable)
    .where(eq(controlPlaneMetricsTable.organizationId, organizationId))
    .orderBy(desc(controlPlaneMetricsTable.metricDate))
    .limit(1200);

  const history: Record<string, MetricPoint[]> = {};
  for (const row of rows) {
    (history[row.metricKey] ??= []).push({ date: row.metricDate, value: row.value });
  }
  for (const series of Object.values(history)) series.reverse();
  return history;
}

export interface SnapshotOptions {
  /** Governance's review target, which decides what counts as a stale decision. */
  reviewSlaHours: number;
  now?: Date;
}

/**
 * Assemble everything the fleet is allowed to see. This is the only place
 * that reads the business's own tables on the agents' behalf, so it is also
 * the boundary where an agent's reach is capped: no raw couple data, no
 * credentials, no object storage — aggregates and identifiers only.
 */
export async function buildBusinessSnapshot(
  organizationId: number,
  options: SnapshotOptions,
): Promise<BusinessSnapshot> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();

  const [organization] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId));
  if (!organization) throw new Error(`Organization ${organizationId} not found`);

  const [venues, last7d, prev7d, last24h, finance, experiments, ledger, metrics] = await Promise.all([
    venueSnapshots(organizationId, now),
    funnelWindow(organizationId, nowMs - 7 * DAY_MS, nowMs),
    funnelWindow(organizationId, nowMs - 14 * DAY_MS, nowMs - 7 * DAY_MS),
    funnelWindow(organizationId, nowMs - DAY_MS, nowMs),
    financeSnapshot(organizationId, organization.creditsBalance, organization.plan, now),
    experimentSnapshots(organizationId, now),
    ledgerSnapshot(organizationId, options.reviewSlaHours, now),
    metricHistory(organizationId),
  ]);

  const venueIds = venues.map((venue) => venue.id);
  const venueSlugById = new Map(venues.map((venue) => [venue.id, venue.slug]));

  const failureRows = venueIds.length
    ? await db
        .select({
          id: coupleSessionsTable.id,
          venueId: coupleSessionsTable.venueId,
          errorMessage: coupleSessionsTable.errorMessage,
          createdAt: coupleSessionsTable.createdAt,
          creditsCharged: coupleSessionsTable.creditsCharged,
        })
        .from(coupleSessionsTable)
        .where(
          and(
            inArray(coupleSessionsTable.venueId, venueIds),
            eq(coupleSessionsTable.status, "failed"),
            gte(coupleSessionsTable.createdAt, new Date(nowMs - 3 * DAY_MS)),
          ),
        )
        .orderBy(desc(coupleSessionsTable.createdAt))
        .limit(60)
    : [];

  const [tickets, leads, workItems, signals, agents, runs24h] = await Promise.all([
    db
      .select()
      .from(controlPlaneTicketsTable)
      .where(eq(controlPlaneTicketsTable.organizationId, organizationId))
      .orderBy(desc(controlPlaneTicketsTable.createdAt))
      .limit(200),
    db
      .select()
      .from(controlPlaneLeadsTable)
      .where(eq(controlPlaneLeadsTable.organizationId, organizationId))
      .orderBy(desc(controlPlaneLeadsTable.updatedAt))
      .limit(200),
    db
      .select()
      .from(controlPlaneWorkItemsTable)
      .where(eq(controlPlaneWorkItemsTable.organizationId, organizationId))
      .orderBy(desc(controlPlaneWorkItemsTable.updatedAt))
      .limit(200),
    db
      .select()
      .from(controlPlaneSignalsTable)
      .where(
        and(
          eq(controlPlaneSignalsTable.organizationId, organizationId),
          gte(controlPlaneSignalsTable.occurredAt, new Date(nowMs - 2 * DAY_MS)),
        ),
      )
      .orderBy(desc(controlPlaneSignalsTable.occurredAt))
      .limit(200),
    db
      .select()
      .from(controlPlaneAgentsTable)
      .where(eq(controlPlaneAgentsTable.organizationId, organizationId)),
    db
      .select({
        agentKey: controlPlaneRunsTable.agentKey,
        status: controlPlaneRunsTable.status,
        total: sql<number>`count(*)`,
      })
      .from(controlPlaneRunsTable)
      .where(
        and(
          eq(controlPlaneRunsTable.organizationId, organizationId),
          gte(controlPlaneRunsTable.startedAt, new Date(nowMs - DAY_MS)),
        ),
      )
      .groupBy(controlPlaneRunsTable.agentKey, controlPlaneRunsTable.status),
  ]);

  const runCounts = new Map<string, { failed: number; succeeded: number }>();
  for (const row of runs24h) {
    const entry = runCounts.get(row.agentKey) ?? { failed: 0, succeeded: 0 };
    if (row.status === "failed") entry.failed += toNumber(row.total);
    if (row.status === "succeeded") entry.succeeded += toNumber(row.total);
    runCounts.set(row.agentKey, entry);
  }

  return {
    now: now.toISOString(),
    organization: {
      id: organization.id,
      name: organization.name,
      plan: organization.plan,
      creditsBalance: organization.creditsBalance,
      hasSubscription: Boolean(organization.stripeSubscriptionId),
      billingPeriodEnd: organization.billingPeriodEnd?.toISOString() ?? null,
      createdAt: organization.createdAt.toISOString(),
      ageDays: Math.floor(daysSince(organization.createdAt, now) ?? 0),
    },
    venues,
    funnel: { last7d, prev7d, last24h },
    failures: failureRows.map((failure) => ({
      id: failure.id,
      venueId: failure.venueId,
      venueSlug: venueSlugById.get(failure.venueId) ?? String(failure.venueId),
      errorMessage: failure.errorMessage,
      createdAt: failure.createdAt.toISOString(),
      ageHours: Math.round((hoursSince(failure.createdAt, now) ?? 0) * 10) / 10,
      creditsCharged: failure.creditsCharged,
    })),
    finance,
    tickets: tickets.map((ticket) => {
      const age = hoursSince(ticket.createdAt, now) ?? 0;
      return {
        id: ticket.id,
        subject: ticket.subject,
        body: ticket.body,
        category: ticket.category,
        sentiment: ticket.sentiment,
        priority: ticket.priority,
        status: ticket.status,
        source: ticket.source,
        requesterEmail: ticket.requesterEmail,
        venueId: ticket.venueId,
        sessionId: ticket.sessionId,
        hasDraft: Boolean(ticket.aiDraft?.trim()),
        ageHours: Math.round(age * 10) / 10,
        hoursSinceFirstResponse:
          ticket.firstResponseAt === null
            ? null
            : Math.round((hoursSince(ticket.firstResponseAt, now) ?? 0) * 10) / 10,
      };
    }),
    leads: leads.map((lead) => ({
      id: lead.id,
      companyName: lead.companyName,
      contactName: lead.contactName,
      contactEmail: lead.contactEmail,
      source: lead.source,
      stage: lead.stage,
      score: lead.score,
      ageDays: Math.floor(daysSince(lead.createdAt, now) ?? 0),
      daysSinceLastTouch:
        lead.lastTouchAt === null ? null : Math.floor(daysSince(lead.lastTouchAt, now) ?? 0),
      nextActionOverdueDays:
        lead.nextActionAt === null || lead.nextActionAt.getTime() > nowMs
          ? null
          : Math.floor(daysSince(lead.nextActionAt, now) ?? 0),
    })),
    experiments,
    workItems: workItems.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      severity: item.severity,
      status: item.status,
      surface: item.surface,
      dedupeKey: item.dedupeKey,
      ageDays: Math.floor(daysSince(item.createdAt, now) ?? 0),
    })),
    signals: signals.map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      severity: signal.severity as Severity,
      source: signal.source,
      title: signal.title,
      venueId: signal.venueId,
      subjectType: signal.subjectType,
      subjectId: signal.subjectId,
      payload: signal.payload,
      ageHours: Math.round((hoursSince(signal.occurredAt, now) ?? 0) * 10) / 10,
    })),
    fleet: agents.map((agent) => {
      const counts = runCounts.get(agent.agentKey) ?? { failed: 0, succeeded: 0 };
      const minutesSinceLastRun =
        agent.lastRunAt === null ? null : ((hoursSince(agent.lastRunAt, now) ?? 0) * 60);
      return {
        agentKey: agent.agentKey,
        domain: agent.domain as AgentDomain,
        enabled: agent.enabled,
        autonomy: agent.autonomy as BusinessSnapshot["fleet"][number]["autonomy"],
        status: agent.status,
        healthScore: agent.healthScore,
        actionsToday: agent.actionsToday,
        dailyActionBudget: agent.dailyActionBudget,
        lastRunAt: agent.lastRunAt?.toISOString() ?? null,
        minutesSinceLastRun:
          minutesSinceLastRun === null ? null : Math.round(minutesSinceLastRun * 10) / 10,
        lastError: agent.lastError,
        failedRuns24h: counts.failed,
        succeededRuns24h: counts.succeeded,
      };
    }),
    ledger,
    metrics,
  };
}

/** Recent, non-superseded memory for one agent. */
export async function loadAgentMemory(
  organizationId: number,
  agentKey: string,
  now: Date,
  limit = 25,
): Promise<MemoryNote[]> {
  const rows = await db
    .select()
    .from(controlPlaneMemoryTable)
    .where(
      and(
        eq(controlPlaneMemoryTable.organizationId, organizationId),
        eq(controlPlaneMemoryTable.agentKey, agentKey),
        sql`${controlPlaneMemoryTable.supersededAt} is null`,
      ),
    )
    .orderBy(desc(controlPlaneMemoryTable.importance), desc(controlPlaneMemoryTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    agentKey: row.agentKey,
    kind: row.kind,
    content: row.content,
    importance: row.importance,
    tags: row.tags,
    ageDays: Math.floor(daysSince(row.createdAt, now) ?? 0),
  }));
}

/** Open decisions for one agent, so it does not re-propose what is pending. */
export async function loadOpenDecisions(
  organizationId: number,
  now: Date,
): Promise<OpenDecisionRef[]> {
  const rows = await db
    .select({
      id: controlPlaneDecisionsTable.id,
      agentKey: controlPlaneDecisionsTable.agentKey,
      dedupeKey: controlPlaneDecisionsTable.dedupeKey,
      kind: controlPlaneDecisionsTable.kind,
      status: controlPlaneDecisionsTable.status,
      createdAt: controlPlaneDecisionsTable.createdAt,
    })
    .from(controlPlaneDecisionsTable)
    .where(
      and(
        eq(controlPlaneDecisionsTable.organizationId, organizationId),
        inArray(controlPlaneDecisionsTable.status, ["proposed", "approved"]),
      ),
    )
    .limit(500);

  return rows.map((row) => ({
    id: row.id,
    agentKey: row.agentKey,
    dedupeKey: row.dedupeKey,
    kind: row.kind,
    status: row.status,
    ageHours: Math.round((hoursSince(row.createdAt, now) ?? 0) * 10) / 10,
  }));
}
