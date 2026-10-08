import { db, organizationsTable, venuesTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

/**
 * Read queries for the list_organizations / list_venues tools.
 *
 * The correlated subqueries are written as raw SQL with explicit table
 * aliases (v, cs, vm). Interpolating Drizzle columns of the inner tables used
 * to render unqualified identifiers ("id" = "venue_id"), which Postgres
 * rejects as ambiguous once the outer table shares a column name — the
 * production error the finance agent hit. Only outer-table columns are
 * interpolated here, so the fragments stay unambiguous.
 */
export function listOrganizationsQuery(limit: number) {
  const venueCount = sql<number>`(select count(*)::int from venues v where v.organization_id = ${organizationsTable.id})`;
  const lastSession = sql<string | null>`(select max(cs.created_at)::text from couple_sessions cs join venues v on v.id = cs.venue_id where v.organization_id = ${organizationsTable.id})`;
  return db
    .select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      plan: organizationsTable.plan,
      creditsBalance: organizationsTable.creditsBalance,
      billingPeriodEnd: organizationsTable.billingPeriodEnd,
      firstPaidAt: organizationsTable.firstPaidAt,
      trialEndsAt: organizationsTable.trialEndsAt,
      trialExpiredAt: organizationsTable.trialExpiredAt,
      createdAt: organizationsTable.createdAt,
      venueCount,
      lastSessionAt: lastSession,
    })
    .from(organizationsTable)
    .orderBy(desc(organizationsTable.createdAt))
    .limit(limit);
}

export type VenueListSort = "newest" | "least_active";

export function listVenuesQuery(limit: number, sort: VenueListSort) {
  const mediaCount = sql<number>`(select count(*)::int from venue_media vm where vm.venue_id = ${venuesTable.id})`;
  const sessionCount = sql<number>`(select count(*)::int from couple_sessions cs where cs.venue_id = ${venuesTable.id})`;
  return db
    .select({
      id: venuesTable.id,
      name: venuesTable.name,
      slug: venuesTable.slug,
      organizationId: venuesTable.organizationId,
      createdAt: venuesTable.createdAt,
      mediaCount,
      sessionCount,
      orgName: organizationsTable.name,
      orgPlan: organizationsTable.plan,
      orgCredits: organizationsTable.creditsBalance,
    })
    .from(venuesTable)
    .leftJoin(organizationsTable, eq(venuesTable.organizationId, organizationsTable.id))
    .orderBy(
      sort === "least_active"
        ? sql`(select count(*) from couple_sessions cs2 where cs2.venue_id = ${venuesTable.id}) asc, ${venuesTable.createdAt} desc`
        : desc(venuesTable.createdAt),
    )
    .limit(limit);
}
