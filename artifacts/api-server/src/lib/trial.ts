import { db, organizationsTable, venuesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { readTrialConfig } from "./publicConfig.js";

/*
 * Trial clock (funnel-ux.md 2.5, shared-contract 4.2). Frozen after step 0.
 * Spending is blocked by time while plan is "trial" and by balance always;
 * credits are never zeroed at expiry and any purchase lifts the block.
 */

export interface TrialState {
  onTrial: boolean;
  endsAt: string | null;
  daysLeft: number | null;
  expired: boolean;
  creditsRemaining: number;
}

export type SpendCheck = { ok: true } | { ok: false; reason: "trial_expired" | "insufficient_credits" };

export const SPEND_ERRORS = {
  trial_expired: "This venue's free trial has ended. Ask the venue to pick a plan.",
  insufficient_credits: "No credits remaining. Ask the venue to add credits.",
} as const;

type TrialOrg = { plan: string; creditsBalance: number; trialEndsAt: Date | null; createdAt: Date };

const DAY_MS = 86_400_000;

/** Legacy rows (null trialEndsAt) are read as createdAt + TRIAL_DAYS. */
export function trialEndsAt(
  org: Pick<TrialOrg, "trialEndsAt" | "createdAt">,
  days = readTrialConfig().days,
): Date {
  return org.trialEndsAt ?? new Date(org.createdAt.getTime() + days * DAY_MS);
}

export function trialState(org: TrialOrg, now = new Date(), days = readTrialConfig().days): TrialState {
  const onTrial = org.plan === "trial";
  if (!onTrial) {
    return { onTrial, endsAt: null, daysLeft: null, expired: false, creditsRemaining: org.creditsBalance };
  }
  const endsAt = trialEndsAt(org, days);
  const expired = now.getTime() >= endsAt.getTime();
  const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS));
  return { onTrial, endsAt: endsAt.toISOString(), daysLeft, expired, creditsRemaining: org.creditsBalance };
}

export function canSpendCredits(org: TrialOrg, amount: number, now = new Date()): SpendCheck {
  if (trialState(org, now).expired) return { ok: false, reason: "trial_expired" };
  if (org.creditsBalance < amount) return { ok: false, reason: "insufficient_credits" };
  return { ok: true };
}

/** Org-backed venue: time + balance check. Legacy venue (no org): venue balance only. */
export async function assertCanSpend(venueId: number, amount: number): Promise<SpendCheck> {
  const [venue] = await db
    .select({ organizationId: venuesTable.organizationId, creditsBalance: venuesTable.creditsBalance })
    .from(venuesTable)
    .where(eq(venuesTable.id, venueId));
  if (!venue) return { ok: false, reason: "insufficient_credits" };

  if (venue.organizationId == null) {
    return venue.creditsBalance >= amount ? { ok: true } : { ok: false, reason: "insufficient_credits" };
  }

  const [org] = await db
    .select({
      plan: organizationsTable.plan,
      creditsBalance: organizationsTable.creditsBalance,
      trialEndsAt: organizationsTable.trialEndsAt,
      createdAt: organizationsTable.createdAt,
    })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, venue.organizationId));
  if (!org) return { ok: false, reason: "insufficient_credits" };

  return canSpendCredits(org, amount);
}
