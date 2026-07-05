import {
  db,
  venuesTable,
  organizationsTable,
  creditTransactionsTable,
  coupleSessionsTable,
} from "@workspace/db";
import { eq, and, sql, gte } from "drizzle-orm";
import { logger } from "./logger.js";

export const CREDITS_STANDARD = 1;
export const VENUE_DAILY_SESSION_CAP = 50;
export const MIN_VENUE_PHOTOS = 1;

export function creditsForSession(): number {
  return CREDITS_STANDARD;
}

/** Couple-safe venue payload - no billing fields. */
export function toPublicVenue(
  venue: {
    id: number;
    name: string;
    slug: string;
    tagline: string | null;
    description: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    websiteUrl: string | null;
    bookingUrl: string | null;
    createdAt: Date;
    creditsBalance: number;
  },
  media: Array<{ coverage?: string | null }>,
) {
  return {
    id: venue.id,
    name: venue.name,
    slug: venue.slug,
    tagline: venue.tagline,
    description: venue.description,
    contactEmail: venue.contactEmail,
    contactPhone: venue.contactPhone,
    websiteUrl: venue.websiteUrl,
    bookingUrl: venue.bookingUrl,
    createdAt: venue.createdAt,
    media,
    isReady: media.length >= MIN_VENUE_PHOTOS,
  };
}

/**
 * Billing lives on the organization. A venue with an organizationId draws
 * from the org balance; a legacy venue (no org yet) still draws from its own
 * venue-level balance until an owner sign-in adopts it.
 */
async function resolveVenueOrgId(venueId: number): Promise<number | null> {
  const [row] = await db
    .select({ organizationId: venuesTable.organizationId })
    .from(venuesTable)
    .where(eq(venuesTable.id, venueId));
  return row?.organizationId ?? null;
}

export async function getOrgCreditsBalance(orgId: number): Promise<number> {
  const [row] = await db
    .select({ creditsBalance: organizationsTable.creditsBalance })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));
  return row?.creditsBalance ?? 0;
}

/** Effective spendable balance for a venue (org balance when adopted). */
export async function getVenueCreditsBalance(venueId: number): Promise<number> {
  const orgId = await resolveVenueOrgId(venueId);
  if (orgId != null) return getOrgCreditsBalance(orgId);
  const [row] = await db
    .select({ creditsBalance: venuesTable.creditsBalance })
    .from(venuesTable)
    .where(eq(venuesTable.id, venueId));
  return row?.creditsBalance ?? 0;
}

export async function grantCreditsToOrg(
  orgId: number,
  amount: number,
  reason: string,
  billingEventId?: string | null,
): Promise<number> {
  if (amount <= 0) return getOrgCreditsBalance(orgId);

  try {
    return await db.transaction(async (tx) => {
      await tx.insert(creditTransactionsTable).values({
        organizationId: orgId,
        delta: amount,
        reason,
        stripeEventId: billingEventId ?? null,
      });

      const [updated] = await tx
        .update(organizationsTable)
        .set({ creditsBalance: sql`${organizationsTable.creditsBalance} + ${amount}` })
        .where(eq(organizationsTable.id, orgId))
        .returning({ creditsBalance: organizationsTable.creditsBalance });

      return updated?.creditsBalance ?? 0;
    });
  } catch (error) {
    if (isBillingEventReplay(error)) {
      logger.info({ orgId, billingEventId }, "Ignored duplicate billing credit grant");
      return getOrgCreditsBalance(orgId);
    }
    throw error;
  }
}

export async function setOrgCreditsBalance(
  orgId: number,
  newBalance: number,
  reason: string,
  billingEventId?: string | null,
): Promise<number> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ creditsBalance: organizationsTable.creditsBalance })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, orgId));

      const prev = current?.creditsBalance ?? 0;
      const delta = newBalance - prev;

      if (billingEventId || delta !== 0) {
        await tx.insert(creditTransactionsTable).values({
          organizationId: orgId,
          delta,
          reason,
          stripeEventId: billingEventId ?? null,
        });
      }

      const [updated] = await tx
        .update(organizationsTable)
        .set({ creditsBalance: newBalance })
        .where(eq(organizationsTable.id, orgId))
        .returning({ creditsBalance: organizationsTable.creditsBalance });

      return updated?.creditsBalance ?? 0;
    });
  } catch (error) {
    if (isBillingEventReplay(error)) {
      logger.info({ orgId, billingEventId }, "Ignored duplicate billing balance grant");
      return getOrgCreditsBalance(orgId);
    }
    throw error;
  }
}

export async function debitCredits(
  venueId: number,
  sessionId: number,
  amount: number,
): Promise<boolean> {
  const orgId = await resolveVenueOrgId(venueId);

  return db.transaction(async (tx) => {
    if (orgId != null) {
      const [updated] = await tx
        .update(organizationsTable)
        .set({ creditsBalance: sql`${organizationsTable.creditsBalance} - ${amount}` })
        .where(
          and(eq(organizationsTable.id, orgId), gte(organizationsTable.creditsBalance, amount)),
        )
        .returning({ creditsBalance: organizationsTable.creditsBalance });
      if (!updated) return false;
    } else {
      const [updated] = await tx
        .update(venuesTable)
        .set({ creditsBalance: sql`${venuesTable.creditsBalance} - ${amount}` })
        .where(and(eq(venuesTable.id, venueId), gte(venuesTable.creditsBalance, amount)))
        .returning({ creditsBalance: venuesTable.creditsBalance });
      if (!updated) return false;
    }

    await tx.insert(creditTransactionsTable).values({
      organizationId: orgId,
      venueId,
      delta: -amount,
      reason: "session_debit",
      sessionId,
    });

    await tx
      .update(coupleSessionsTable)
      .set({ creditsCharged: amount })
      .where(eq(coupleSessionsTable.id, sessionId));

    return true;
  });
}

export async function refundCreditsForSession(sessionId: number): Promise<boolean> {
  const refunded = await db.transaction(async (tx) => {
    const [session] = await tx
      .select({
        venueId: coupleSessionsTable.venueId,
        creditsCharged: coupleSessionsTable.creditsCharged,
      })
      .from(coupleSessionsTable)
      .where(eq(coupleSessionsTable.id, sessionId));

    if (!session || session.creditsCharged <= 0) return null;

    const [cleared] = await tx
      .update(coupleSessionsTable)
      .set({ creditsCharged: 0 })
      .where(
        and(
          eq(coupleSessionsTable.id, sessionId),
          eq(coupleSessionsTable.creditsCharged, session.creditsCharged),
        ),
      )
      .returning({ id: coupleSessionsTable.id });

    if (!cleared) return null;

    const [venueRow] = await tx
      .select({ organizationId: venuesTable.organizationId })
      .from(venuesTable)
      .where(eq(venuesTable.id, session.venueId));
    const orgId = venueRow?.organizationId ?? null;

    if (orgId != null) {
      await tx
        .update(organizationsTable)
        .set({ creditsBalance: sql`${organizationsTable.creditsBalance} + ${session.creditsCharged}` })
        .where(eq(organizationsTable.id, orgId));
    } else {
      await tx
        .update(venuesTable)
        .set({ creditsBalance: sql`${venuesTable.creditsBalance} + ${session.creditsCharged}` })
        .where(eq(venuesTable.id, session.venueId));
    }

    await tx.insert(creditTransactionsTable).values({
      organizationId: orgId,
      venueId: session.venueId,
      delta: session.creditsCharged,
      reason: "session_refund",
      sessionId,
    });

    return { amount: session.creditsCharged };
  });

  if (!refunded) {
    return false;
  }

  logger.info({ sessionId, amount: refunded.amount }, "Refunded session credits");
  return true;
}

function isBillingEventReplay(error: unknown): boolean {
  const candidate = error as {
    code?: string;
    constraint?: string;
    message?: string;
    cause?: { code?: string; constraint?: string; message?: string };
  };
  return (
    candidate.code === "23505" ||
    candidate.constraint === "credit_transactions_stripe_event_id_unique" ||
    candidate.cause?.code === "23505" ||
    candidate.cause?.constraint === "credit_transactions_stripe_event_id_unique" ||
    /credit_transactions_stripe_event_id_unique|duplicate key/i.test(candidate.message ?? "") ||
    /credit_transactions_stripe_event_id_unique|duplicate key/i.test(candidate.cause?.message ?? "")
  );
}

export async function countVenueSessionsToday(venueId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coupleSessionsTable)
    .where(
      and(
        eq(coupleSessionsTable.venueId, venueId),
        gte(coupleSessionsTable.createdAt, sql`date_trunc('day', now())`),
      ),
    );
  return row?.count ?? 0;
}

export async function hasSufficientCredits(
  venueId: number,
  amount: number,
): Promise<boolean> {
  const balance = await getVenueCreditsBalance(venueId);
  return balance >= amount;
}
