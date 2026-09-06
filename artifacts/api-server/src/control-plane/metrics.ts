import {
  db,
  organizationsTable,
  venuesTable,
  venueMediaTable,
  coupleSessionsTable,
  creditTransactionsTable,
  generatedAssetsTable,
  controlMetricsSnapshotsTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";

export interface BusinessMetrics {
  capturedAt: string;
  organizations: {
    total: number;
    byPlan: Record<string, number>;
    totalCreditsBalance: number;
    lowCreditCount: number;
    paidCount: number;
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
    purchased30d: number;
    grantsByReason30d: Record<string, number>;
  };
  assets: {
    generated7d: number;
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const count = sql<number>`count(*)::int`;

/** Compute the live business KPI set straight from production tables. */
export async function computeBusinessMetrics(): Promise<BusinessMetrics> {
  const d7 = daysAgo(7);
  const d30 = daysAgo(30);

  const [
    orgTotals,
    orgsByPlan,
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
    assets7d,
  ] = await Promise.all([
    db
      .select({
        total: count,
        credits: sql<number>`coalesce(sum(${organizationsTable.creditsBalance}), 0)::int`,
      })
      .from(organizationsTable),
    db
      .select({ plan: organizationsTable.plan, total: count })
      .from(organizationsTable)
      .groupBy(organizationsTable.plan),
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
      .select({ total: count })
      .from(generatedAssetsTable)
      .where(gte(generatedAssetsTable.createdAt, d7)),
  ]);

  const byPlan: Record<string, number> = {};
  let paidCount = 0;
  for (const row of orgsByPlan) {
    byPlan[row.plan] = row.total;
    if (row.plan === "starter" || row.plan === "growth") paidCount += row.total;
  }

  const byStatus: Record<string, number> = {};
  for (const row of sessionsByStatus) byStatus[row.status] = row.total;

  const grantsByReason: Record<string, number> = {};
  let granted30d = 0;
  let consumed30d = 0;
  let refunded30d = 0;
  let purchased30d = 0;
  for (const row of ledger30d) {
    grantsByReason[row.reason] = row.total;
    if (row.total > 0) granted30d += row.total;
    if (row.reason === "session_debit") consumed30d += Math.abs(row.total);
    if (row.reason === "session_refund") refunded30d += row.total;
    if (row.reason === "pack_purchase" || row.reason === "subscription_grant") {
      purchased30d += Math.max(0, row.total);
    }
  }

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

export async function snapshotMetrics(): Promise<BusinessMetrics> {
  const metrics = await computeBusinessMetrics();
  await db
    .insert(controlMetricsSnapshotsTable)
    .values({ metrics: metrics as unknown as Record<string, unknown> });
  return metrics;
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
