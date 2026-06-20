import { db, venuesTable, creditTransactionsTable, coupleSessionsTable } from "@workspace/db";
import { eq, and, sql, gte } from "drizzle-orm";
import { logger } from "./logger.js";
import { venueMediaCoverageStatus } from "./venueMediaCoverage.js";

export const CREDITS_STANDARD = 1;
export const VENUE_DAILY_SESSION_CAP = 50;
export const MIN_VENUE_PHOTOS = 5;

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
  const coverage = venueMediaCoverageStatus(media);
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
    isReady: media.length >= MIN_VENUE_PHOTOS && coverage.ready,
  };
}

export async function getVenueCreditsBalance(venueId: number): Promise<number> {
  const [row] = await db
    .select({ creditsBalance: venuesTable.creditsBalance })
    .from(venuesTable)
    .where(eq(venuesTable.id, venueId));
  return row?.creditsBalance ?? 0;
}

export async function grantCredits(
  venueId: number,
  amount: number,
  reason: string,
  stripeEventId?: string | null,
): Promise<number> {
  if (amount <= 0) return getVenueCreditsBalance(venueId);

  try {
    return await db.transaction(async (tx) => {
      if (stripeEventId) {
        await tx.insert(creditTransactionsTable).values({
          venueId,
          delta: amount,
          reason,
          stripeEventId,
        });
      }

      const [updated] = await tx
        .update(venuesTable)
        .set({ creditsBalance: sql`${venuesTable.creditsBalance} + ${amount}` })
        .where(eq(venuesTable.id, venueId))
        .returning({ creditsBalance: venuesTable.creditsBalance });

      if (!stripeEventId) {
        await tx.insert(creditTransactionsTable).values({
          venueId,
          delta: amount,
          reason,
          stripeEventId: null,
        });
      }

      return updated?.creditsBalance ?? 0;
    });
  } catch (error) {
    if (isStripeEventReplay(error)) {
      logger.info({ venueId, stripeEventId }, "Ignored duplicate Stripe credit grant");
      return getVenueCreditsBalance(venueId);
    }
    throw error;
  }
}

export async function setCreditsBalance(
  venueId: number,
  newBalance: number,
  reason: string,
  stripeEventId?: string | null,
): Promise<number> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ creditsBalance: venuesTable.creditsBalance })
        .from(venuesTable)
        .where(eq(venuesTable.id, venueId));

      const prev = current?.creditsBalance ?? 0;
      const delta = newBalance - prev;

      if (stripeEventId) {
        await tx.insert(creditTransactionsTable).values({
          venueId,
          delta,
          reason,
          stripeEventId,
        });
      }

      const [updated] = await tx
        .update(venuesTable)
        .set({ creditsBalance: newBalance })
        .where(eq(venuesTable.id, venueId))
        .returning({ creditsBalance: venuesTable.creditsBalance });

      if (!stripeEventId && delta !== 0) {
        await tx.insert(creditTransactionsTable).values({
          venueId,
          delta,
          reason,
          stripeEventId: null,
        });
      }

      return updated?.creditsBalance ?? 0;
    });
  } catch (error) {
    if (isStripeEventReplay(error)) {
      logger.info({ venueId, stripeEventId }, "Ignored duplicate Stripe balance grant");
      return getVenueCreditsBalance(venueId);
    }
    throw error;
  }
}

export async function debitCredits(
  venueId: number,
  sessionId: number,
  amount: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(venuesTable)
      .set({ creditsBalance: sql`${venuesTable.creditsBalance} - ${amount}` })
      .where(
        and(eq(venuesTable.id, venueId), gte(venuesTable.creditsBalance, amount)),
      )
      .returning({ creditsBalance: venuesTable.creditsBalance });

    if (!updated) return false;

    await tx.insert(creditTransactionsTable).values({
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

    await tx
      .update(venuesTable)
      .set({ creditsBalance: sql`${venuesTable.creditsBalance} + ${session.creditsCharged}` })
      .where(eq(venuesTable.id, session.venueId));

    await tx.insert(creditTransactionsTable).values({
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

function isStripeEventReplay(error: unknown): boolean {
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
