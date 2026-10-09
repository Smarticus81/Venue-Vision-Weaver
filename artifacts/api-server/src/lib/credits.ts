import {
  db,
  venuesTable,
  organizationsTable,
  creditTransactionsTable,
  billingEventsTable,
  coupleSessionsTable,
  type BillingEventKind,
} from "@workspace/db";
import { eq, and, sql, gte } from "drizzle-orm";
import { logger } from "./logger.js";
import { planCreditRolloverCap } from "./stripe.js";

const CREDITS_STANDARD = 1;
export const VENUE_DAILY_SESSION_CAP = 50;

/**
 * Balance at or below which the owner gets the low-credit nudge (one per dip,
 * tracked by organizations.low_credit_notified_at; the sessions route sends it).
 */
export const LOW_CREDIT_THRESHOLD = 2;

export function isLowCredit(balance: number, threshold = LOW_CREDIT_THRESHOLD): boolean {
  return balance <= threshold;
}

export function creditsForSession(): number {
  return CREDITS_STANDARD;
}

async function getOrgCreditsBalance(orgId: number): Promise<number> {
  const [row] = await db
    .select({ creditsBalance: organizationsTable.creditsBalance })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));
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

export interface PlanGrantInput {
  /** Current org balance (packs, trial leftovers and earlier plan credits). */
  balance: number;
  /** Monthly quota of the tier Stripe billed. */
  quota: number;
  /** PLAN_CREDIT_ROLLOVER_CAP: plan credits never pile above quota * cap. */
  cap: number;
}

export interface PlanGrant {
  newBalance: number;
  /** Credits actually added (0 when the rollover cap already holds the balance). */
  delta: number;
  /** Face value of the grant before clipping. */
  faceValue: number;
  clipped: boolean;
}

/**
 * Additive subscription grant with the rollover rule (step0-merge-decisions
 * E2): newBalance = min(balance + quota, max(balance, quota * cap)). The
 * balance is never lowered, so purchased packs survive every renewal, and an
 * organization that never spends stops accruing at `cap` months of quota.
 */
export function computePlanGrant(input: PlanGrantInput): PlanGrant {
  const quota = Math.max(0, Math.floor(input.quota));
  const cap = Number.isFinite(input.cap) && input.cap >= 1 ? input.cap : 1;
  const balance = Math.max(0, Math.floor(input.balance));
  const ceiling = Math.max(balance, Math.floor(quota * cap));
  const newBalance = Math.min(balance + quota, ceiling);
  const delta = newBalance - balance;
  return { newBalance, delta, faceValue: quota, clipped: delta < quota };
}

/**
 * Grant a subscription period's credits to an organization, additively and
 * capped (computePlanGrant). Writes one `subscription_grant` ledger row when
 * anything was added. The webhook records the Stripe event id in
 * stripe_events before calling this; the unique partial index on
 * credit_transactions.stripe_event_id is the second line of defence.
 */
export async function grantPlanCredits(
  orgId: number,
  quota: number,
  stripeEventId: string | null,
  options: { cap?: number } = {},
): Promise<PlanGrant> {
  const cap = options.cap ?? planCreditRolloverCap();
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ creditsBalance: organizationsTable.creditsBalance })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, orgId))
        .for("update");
      const balance = current?.creditsBalance ?? 0;
      const grant = computePlanGrant({ balance, quota, cap });

      if (grant.delta > 0) {
        await tx.insert(creditTransactionsTable).values({
          organizationId: orgId,
          delta: grant.delta,
          reason: "subscription_grant",
          stripeEventId: stripeEventId ?? null,
        });
        await tx
          .update(organizationsTable)
          .set({ creditsBalance: grant.newBalance })
          .where(eq(organizationsTable.id, orgId));
      }
      return grant;
    });
  } catch (error) {
    if (isBillingEventReplay(error)) {
      logger.info({ orgId, stripeEventId }, "Ignored duplicate subscription credit grant");
      const balance = await getOrgCreditsBalance(orgId);
      return { newBalance: balance, delta: 0, faceValue: quota, clipped: true };
    }
    throw error;
  }
}

/** Business-level billing history row (billing_events). Never throws: history must not fail a webhook. */
export async function recordBillingEvent(input: {
  organizationId: number;
  kind: BillingEventKind;
  plan?: string | null;
  faceValueCredits?: number | null;
  amountCents?: number | null;
  stripeEventId?: string | null;
}): Promise<void> {
  try {
    await db.insert(billingEventsTable).values({
      organizationId: input.organizationId,
      kind: input.kind,
      plan: input.plan ?? null,
      faceValueCredits: input.faceValueCredits ?? null,
      amountCents: input.amountCents ?? null,
      stripeEventId: input.stripeEventId ?? null,
    });
  } catch (err) {
    logger.warn({ err, organizationId: input.organizationId, kind: input.kind }, "billing event not recorded");
  }
}

/**
 * Overwrite an organization's balance. Operator/admin use only (support
 * corrections): webhooks never SET a balance, they grant additively
 * (grantCreditsToOrg / grantPlanCredits), so purchased packs are never erased.
 */
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


/**
 * Guard for clearing a session's charge: only a session that ended `failed`
 * is ever refunded (a gallery that turned ready was delivered and keeps its
 * charge, even if a deadline or the reaper calls failSession late), and the
 * charge must still be the amount we read, so a refund happens once.
 */
export function refundableSessionWhere(sessionId: number, creditsCharged: number) {
  return and(
    eq(coupleSessionsTable.id, sessionId),
    eq(coupleSessionsTable.status, "failed"),
    eq(coupleSessionsTable.creditsCharged, creditsCharged),
  );
}

export async function refundCreditsForSession(sessionId: number): Promise<boolean> {
  const refunded = await db.transaction(async (tx) => {
    const [session] = await tx
      .select({
        venueId: coupleSessionsTable.venueId,
        status: coupleSessionsTable.status,
        creditsCharged: coupleSessionsTable.creditsCharged,
      })
      .from(coupleSessionsTable)
      .where(eq(coupleSessionsTable.id, sessionId));

    if (!session || session.status !== "failed" || session.creditsCharged <= 0) return null;

    const [cleared] = await tx
      .update(coupleSessionsTable)
      .set({ creditsCharged: 0 })
      .where(refundableSessionWhere(sessionId, session.creditsCharged))
      .returning({ id: coupleSessionsTable.id });

    if (!cleared) return null;

    const [venueRow] = await tx
      .select({ organizationId: venuesTable.organizationId })
      .from(venuesTable)
      .where(eq(venuesTable.id, session.venueId));
    const orgId = venueRow?.organizationId ?? null;

    // Every venue belongs to an organization; without one there is no
    // balance to return the credit to, so the transaction rolls back.
    if (orgId == null) throw new Error(`Venue ${session.venueId} has no billing organization to refund.`);
    await tx
      .update(organizationsTable)
      .set({ creditsBalance: sql`${organizationsTable.creditsBalance} + ${session.creditsCharged}` })
      .where(eq(organizationsTable.id, orgId));

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
