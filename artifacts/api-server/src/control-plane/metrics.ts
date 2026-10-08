import {
  db,
  organizationsTable,
  venuesTable,
  venueMediaTable,
  coupleSessionsTable,
  creditTransactionsTable,
  billingEventsTable,
  generatedAssetsTable,
  controlMetricsSnapshotsTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { activationMinPhotos, guardMinSends, trialDays } from "./growth/config.js";
import { computeGrowthKpis, defaultGrowthLoaders } from "./growth/kpi.js";
import { countPaidOrgs } from "./growth/kpiMath.js";
import type { GrowthKpis } from "./growth/kpiTypes.js";

export interface BusinessMetrics {
  capturedAt: string;
  organizations: {
    total: number;
    byPlan: Record<string, number>;
    totalCreditsBalance: number;
    lowCreditCount: number;
    /** Paid = first_paid_at set or a paid plan (starter, growth, payg). A pack buyer counts. */
    paidCount: number;
    /** Subset on a subscription plan (starter + growth). Optional: historical snapshots lack it. */
    paidSubscriptionCount?: number;
  };
  venues: {
    total: number;
    new7d: number;
    new30d: number;
    withMedia: number;
    withSessions: number;
    unadoptedLegacy: number;
    activationRate: number;
  };
  sessions: {
    total: number;
    byStatus: Record<string, number>;
    created7d: number;
    created30d: number;
    ready7d: number;
    failed7d: number;
    failureRate7d: number;
    avgCompletionMinutes7d: number | null;
  };
  credits: {
    granted30d: number;
    consumed30d: number;
    refunded30d: number;
    /**
     * Face value of credits bought in 30 days (packs + subscription invoices)
     * from billing_events; falls back to positive ledger grants when no
     * billing event exists yet (legacy rows).
     */
    purchased30d: number;
    grantsByReason30d: Record<string, number>;
  };
  assets: {
    generated7d: number;
  };
  /** Outcome KPIs (growth-loop.md). Filled by snapshotMetrics(); omitted from live briefings to keep them cheap. */
  growth?: GrowthKpis;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const count = sql<number>`count(*)::int`;

const PURCHASE_BILLING_KINDS = new Set(["pack_purchased", "subscription_started", "subscription_renewed"]);

/** Pure: purchased credits from billing events when present, otherwise the legacy ledger view. */
export function purchasedCredits30d(
  billingRows: Array<{ kind: string; total: number }>,
  ledgerRows: Array<{ reason: string; total: number }>,
): number {
  if (billingRows.length > 0) {
    return billingRows
      .filter((row) => PURCHASE_BILLING_KINDS.has(row.kind))
      .reduce((acc, row) => acc + Math.max(0, row.total), 0);
  }
  return ledgerRows
    .filter((row) => row.reason === "pack_purchase" || row.reason === "subscription_grant")
    .reduce((acc, row) => acc + Math.max(0, row.total), 0);
}

/** Compute the live business KPI set straight from production tables. */
export async function computeBusinessMetrics(): Promise<BusinessMetrics> {
  const d7 = daysAgo(7);
  const d30 = daysAgo(30);

  const [
    orgTotals,
    orgPlans,
    lowCreditOrgs,
    venueTotals,
    venuesNew7d,
    venuesNew30d,
    venuesWithMedia,
    venuesWithSessions,
    legacyVenues,
    sessionTotals,
    sessionsByStatus,
    sessionsCreated7d,
    sessionsCreated30d,
    sessionsReady7d,
    sessionsFailed7d,
    completionMinutes,
    ledger30d,
    billing30d,
    assets7d,
  ] = await Promise.all([
    db
      .select({
        total: count,
        credits: sql<number>`coalesce(sum(${organizationsTable.creditsBalance}), 0)::int`,
      })
      .from(organizationsTable),
    db
      .select({ plan: organizationsTable.plan, firstPaidAt: organizationsTable.firstPaidAt })
      .from(organizationsTable),
    db
      .select({ total: count })
      .from(organizationsTable)
      .where(lte(organizationsTable.creditsBalance, 2)),
    db.select({ total: count }).from(venuesTable),
    db.select({ total: count }).from(venuesTable).where(gte(venuesTable.createdAt, d7)),
    db.select({ total: count }).from(venuesTable).where(gte(venuesTable.createdAt, d30)),
    db
      .select({ total: sql<number>`count(distinct ${venueMediaTable.venueId})::int` })
      .from(venueMediaTable),
    db
      .select({ total: sql<number>`count(distinct ${coupleSessionsTable.venueId})::int` })
      .from(coupleSessionsTable),
    db.select({ total: count }).from(venuesTable).where(isNull(venuesTable.organizationId)),
    db.select({ total: count }).from(coupleSessionsTable),
    db
      .select({ status: coupleSessionsTable.status, total: count })
      .from(coupleSessionsTable)
      .groupBy(coupleSessionsTable.status),
    db
      .select({ total: count })
      .from(coupleSessionsTable)
      .where(gte(coupleSessionsTable.createdAt, d7)),
    db
      .select({ total: count })
      .from(coupleSessionsTable)
      .where(gte(coupleSessionsTable.createdAt, d30)),
    db
      .select({ total: count })
      .from(coupleSessionsTable)
      .where(and(eq(coupleSessionsTable.status, "ready"), gte(coupleSessionsTable.createdAt, d7))),
    db
      .select({ total: count })
      .from(coupleSessionsTable)
      .where(and(eq(coupleSessionsTable.status, "failed"), gte(coupleSessionsTable.createdAt, d7))),
    db
      .select({
        avgMinutes: sql<number | null>`avg(extract(epoch from (${coupleSessionsTable.completedAt} - ${coupleSessionsTable.createdAt})) / 60)`,
      })
      .from(coupleSessionsTable)
      .where(
        and(
          eq(coupleSessionsTable.status, "ready"),
          gte(coupleSessionsTable.createdAt, d7),
          sql`${coupleSessionsTable.completedAt} IS NOT NULL`,
        ),
      ),
    db
      .select({ reason: creditTransactionsTable.reason, total: sql<number>`coalesce(sum(${creditTransactionsTable.delta}), 0)::int` })
      .from(creditTransactionsTable)
      .where(gte(creditTransactionsTable.createdAt, d30))
      .groupBy(creditTransactionsTable.reason),
    db
      .select({
        kind: billingEventsTable.kind,
        total: sql<number>`coalesce(sum(${billingEventsTable.faceValueCredits}), 0)::int`,
      })
      .from(billingEventsTable)
      .where(gte(billingEventsTable.createdAt, d30))
      .groupBy(billingEventsTable.kind),
    db
      .select({ total: count })
      .from(generatedAssetsTable)
      .where(gte(generatedAssetsTable.createdAt, d7)),
  ]);

  const byPlan: Record<string, number> = {};
  let paidSubscriptionCount = 0;
  for (const row of orgPlans) {
    byPlan[row.plan] = (byPlan[row.plan] ?? 0) + 1;
    if (row.plan === "starter" || row.plan === "growth") paidSubscriptionCount += 1;
  }
  const paidCount = countPaidOrgs(orgPlans);

  const byStatus: Record<string, number> = {};
  for (const row of sessionsByStatus) byStatus[row.status] = row.total;

  const grantsByReason: Record<string, number> = {};
  let granted30d = 0;
  let consumed30d = 0;
  let refunded30d = 0;
  for (const row of ledger30d) {
    grantsByReason[row.reason] = row.total;
    if (row.total > 0) granted30d += row.total;
    if (row.reason === "session_debit") consumed30d += Math.abs(row.total);
    if (row.reason === "session_refund") refunded30d += row.total;
  }
  const purchased30d = purchasedCredits30d(billing30d, ledger30d);

  const venueTotal = venueTotals[0]?.total ?? 0;
  const withSessions = venuesWithSessions[0]?.total ?? 0;
  const created7d = sessionsCreated7d[0]?.total ?? 0;
  const failed7d = sessionsFailed7d[0]?.total ?? 0;
  const avgRaw = completionMinutes[0]?.avgMinutes;
  const avgMinutes = avgRaw == null ? null : Math.round(Number(avgRaw) * 10) / 10;

  return {
    capturedAt: new Date().toISOString(),
    organizations: {
      total: orgTotals[0]?.total ?? 0,
      byPlan,
      totalCreditsBalance: orgTotals[0]?.credits ?? 0,
      lowCreditCount: lowCreditOrgs[0]?.total ?? 0,
      paidCount,
      paidSubscriptionCount,
    },
    venues: {
      total: venueTotal,
      new7d: venuesNew7d[0]?.total ?? 0,
      new30d: venuesNew30d[0]?.total ?? 0,
      withMedia: venuesWithMedia[0]?.total ?? 0,
      withSessions,
      unadoptedLegacy: legacyVenues[0]?.total ?? 0,
      activationRate: venueTotal > 0 ? Math.round((withSessions / venueTotal) * 1000) / 10 : 0,
    },
    sessions: {
      total: sessionTotals[0]?.total ?? 0,
      byStatus,
      created7d,
      created30d: sessionsCreated30d[0]?.total ?? 0,
      ready7d: sessionsReady7d[0]?.total ?? 0,
      failed7d,
      failureRate7d: created7d > 0 ? Math.round((failed7d / created7d) * 1000) / 10 : 0,
      avgCompletionMinutes7d: avgMinutes,
    },
    credits: {
      granted30d,
      consumed30d,
      refunded30d,
      purchased30d,
      grantsByReason30d: grantsByReason,
    },
    assets: {
      generated7d: assets7d[0]?.total ?? 0,
    },
  };
}

/** Outcome KPIs computed live (no snapshot write). Throws only when a loader fails. */
export async function computeGrowthKpisNow(now = new Date()): Promise<GrowthKpis> {
  const minPhotos = activationMinPhotos();
  return computeGrowthKpis(defaultGrowthLoaders(minPhotos), now, {
    minPhotos,
    trialDays: trialDays(),
    minSendsForGuard: guardMinSends(),
  });
}

export interface MetricsSnapshot {
  metrics: BusinessMetrics;
  snapshotId: number;
  createdAt: Date;
}

/**
 * Store one snapshot: live business metrics plus the growth KPI document.
 * A growth computation failure never blocks the snapshot (logged; stored
 * without `growth`), so the scheduler keeps a trend line even when a loader
 * is broken.
 */
export async function snapshotMetrics(): Promise<MetricsSnapshot> {
  const base = await computeBusinessMetrics();
  let growth: GrowthKpis | undefined;
  try {
    growth = await computeGrowthKpisNow();
  } catch (err) {
    logger.error({ err }, "Growth KPI computation failed; snapshot stored without growth");
  }
  const metrics: BusinessMetrics = growth ? { ...base, growth } : base;
  const [row] = await db
    .insert(controlMetricsSnapshotsTable)
    .values({ metrics: metrics as unknown as Record<string, unknown> })
    .returning({ id: controlMetricsSnapshotsTable.id, createdAt: controlMetricsSnapshotsTable.createdAt });
  if (!row) throw new Error("Failed to persist metrics snapshot.");
  return { metrics, snapshotId: row.id, createdAt: row.createdAt };
}

export async function latestSnapshotAgeMinutes(): Promise<number | null> {
  const [row] = await db
    .select({ createdAt: controlMetricsSnapshotsTable.createdAt })
    .from(controlMetricsSnapshotsTable)
    .orderBy(desc(controlMetricsSnapshotsTable.createdAt))
    .limit(1);
  if (!row) return null;
  return (Date.now() - row.createdAt.getTime()) / 60000;
}

export interface GrowthSnapshot {
  snapshotId: number;
  createdAt: Date;
  metrics: BusinessMetrics & { growth: GrowthKpis };
  growth: GrowthKpis;
}

function toGrowthSnapshot(row: { id: number; createdAt: Date; metrics: Record<string, unknown> }): GrowthSnapshot | null {
  const metrics = row.metrics as unknown as BusinessMetrics;
  if (!metrics || typeof metrics !== "object" || !metrics.growth || typeof metrics.growth !== "object") return null;
  return {
    snapshotId: row.id,
    createdAt: row.createdAt,
    metrics: metrics as BusinessMetrics & { growth: GrowthKpis },
    growth: metrics.growth,
  };
}

/** Newest snapshot whose metrics carry a growth document. */
export async function latestGrowthSnapshot(): Promise<GrowthSnapshot | null> {
  const rows = await db
    .select()
    .from(controlMetricsSnapshotsTable)
    .where(sql`${controlMetricsSnapshotsTable.metrics} ? 'growth'`)
    .orderBy(desc(controlMetricsSnapshotsTable.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? toGrowthSnapshot(row) : null;
}

/** The growth snapshot created closest to `target`, within +-`toleranceDays` (digest deltas). */
export async function growthSnapshotNearest(target: Date, toleranceDays = 2): Promise<GrowthSnapshot | null> {
  const toleranceMs = toleranceDays * 24 * 60 * 60 * 1000;
  const from = new Date(target.getTime() - toleranceMs);
  const to = new Date(target.getTime() + toleranceMs);
  const rows = await db
    .select()
    .from(controlMetricsSnapshotsTable)
    .where(
      and(
        sql`${controlMetricsSnapshotsTable.metrics} ? 'growth'`,
        gte(controlMetricsSnapshotsTable.createdAt, from),
        lte(controlMetricsSnapshotsTable.createdAt, to),
      ),
    )
    .orderBy(sql`abs(extract(epoch from (${controlMetricsSnapshotsTable.createdAt} - ${target}::timestamp)))`)
    .limit(1);
  const row = rows[0];
  return row ? toGrowthSnapshot(row) : null;
}

/** The growth snapshot taken before `snapshotId` (the previous point on the trend line). */
export async function previousGrowthSnapshot(snapshotId: number): Promise<GrowthSnapshot | null> {
  const rows = await db
    .select()
    .from(controlMetricsSnapshotsTable)
    .where(and(sql`${controlMetricsSnapshotsTable.metrics} ? 'growth'`, sql`${controlMetricsSnapshotsTable.id} < ${snapshotId}`))
    .orderBy(desc(controlMetricsSnapshotsTable.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? toGrowthSnapshot(row) : null;
}
