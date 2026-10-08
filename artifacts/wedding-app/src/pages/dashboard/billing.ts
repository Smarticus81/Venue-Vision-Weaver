import type { PublicConfig } from "@workspace/api-client-react";
import { describeApiError } from "./errors";
import { formatMoney, isSubscriptionPlan, perGalleryCost } from "./publicConfig";
import type { BillingProductId } from "./types";

/**
 * Pure billing helpers for the dashboard: product cards built from the
 * published prices (never hardcoded), the guard that decides whether a
 * button is live, the 409 "subscription exists" handoff to the Stripe
 * portal, and the credit-history vocabulary. Unit-tested with node:test.
 */

export interface BillingCard {
  id: BillingProductId;
  title: string;
  description: string;
  /** "$129 / month" or "$59 one time" */
  price: string;
  /** "25 galleries a month" / "10 galleries, never expire" */
  credits: string;
  /** "$5.20 per gallery" */
  perGallery: string;
  recommended: boolean;
  kind: "subscription" | "pack";
}

export function buildBillingCards(config: PublicConfig): BillingCard[] {
  const { pricing } = config;
  const money = (n: number) => formatMoney(n, pricing.currency);
  const per = (monthly: number, credits: number) =>
    `${new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: pricing.currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(perGalleryCost(monthly, credits))} per gallery`;
  return [
    {
      id: "starter",
      title: "Starter",
      description: "One venue, every tour followed up the same day.",
      price: `${money(pricing.starterMonthly)} a month`,
      credits: `${pricing.starterCredits} galleries a month`,
      perGallery: per(pricing.starterMonthly, pricing.starterCredits),
      recommended: false,
      kind: "subscription",
    },
    {
      id: "growth",
      title: "Growth",
      description: "Several venues or a full tour calendar.",
      price: `${money(pricing.growthMonthly)} a month`,
      credits: `${pricing.growthCredits} galleries a month`,
      perGallery: per(pricing.growthMonthly, pricing.growthCredits),
      recommended: true,
      kind: "subscription",
    },
    {
      id: "credit_pack",
      title: "Credit pack",
      description: "A one-off top-up. Credits never expire.",
      price: `${money(pricing.creditPack)} one time`,
      credits: `${pricing.creditPackCredits} galleries`,
      perGallery: per(pricing.creditPack, pricing.creditPackCredits),
      recommended: false,
      kind: "pack",
    },
  ];
}

export interface BillingGuardInput {
  product: BillingProductId;
  plan: string | null | undefined;
  isAdmin: boolean;
  billingConfigured: boolean;
  cancelAtPeriodEnd?: boolean;
}

export interface BillingGuard {
  /** What the button says. */
  label: string;
  disabled: boolean;
  /** One line under a disabled button explaining why. Null when live. */
  reason: string | null;
  /** True when this card is the plan the organization is on. */
  current: boolean;
  /** True when the click should land in the Stripe portal (plan change). */
  viaPortal: boolean;
}

export function billingGuard(input: BillingGuardInput): BillingGuard {
  const current = isSubscriptionPlan(input.plan) && input.plan === input.product;
  const subscribed = isSubscriptionPlan(input.plan);
  const viaPortal = subscribed && input.product !== "credit_pack" && !current;
  let label: string;
  if (input.product === "credit_pack") label = "Add 10 credits";
  else if (current) label = input.cancelAtPeriodEnd ? "Resume plan" : "Current plan";
  else if (subscribed) label = "Switch plan";
  else label = input.product === "starter" ? "Start Starter" : "Start Growth";

  if (!input.billingConfigured) {
    return { label, disabled: true, reason: "Billing is not set up on this server yet.", current, viaPortal };
  }
  if (!input.isAdmin) {
    return { label, disabled: true, reason: "Only organization admins can change billing.", current, viaPortal };
  }
  if (current && !input.cancelAtPeriodEnd) {
    return { label, disabled: true, reason: null, current, viaPortal };
  }
  return { label, disabled: false, reason: null, current, viaPortal };
}

/**
 * POST /org/billing/checkout answers 409 { code: "subscription_exists", url }
 * when the organization already pays for a plan; the url is a Stripe portal
 * session that changes plans without starting a second subscription.
 */
export function checkoutConflictUrl(err: unknown): string | null {
  const failure = describeApiError(err);
  if (failure.status !== 409 || failure.code !== "subscription_exists") return null;
  const data = (err as { data?: { url?: unknown } } | null)?.data;
  const url = data && typeof data.url === "string" ? data.url : null;
  return url && /^https:\/\//.test(url) ? url : null;
}

/** Credit ledger reasons in the venue's words. */
export function creditReasonLabel(reason: string): string {
  switch (reason) {
    case "trial_grant":
      return "Free trial";
    case "subscription_grant":
      return "Plan renewal";
    case "pack_purchase":
      return "Credit pack";
    case "session_debit":
      return "Gallery";
    case "session_refund":
      return "Refund for a failed gallery";
    case "requeue_grant":
      return "Gallery retried";
    case "admin_adjust":
    case "prod_topup":
      return "Adjustment by Dreemer";
    default:
      return reason.replace(/_/g, " ");
  }
}

export interface BillingSnapshot {
  plan: string;
  creditsBalance: number;
  billingPeriodEnd: string | null | undefined;
}

/**
 * After ?billing=success the webhook may lag Stripe's redirect. The
 * dashboard polls GET /org until something billing-related changed, or
 * gives up after the deadline and says so honestly.
 */
export function billingChanged(before: BillingSnapshot, after: BillingSnapshot): boolean {
  return (
    before.plan !== after.plan ||
    before.creditsBalance !== after.creditsBalance ||
    (before.billingPeriodEnd ?? null) !== (after.billingPeriodEnd ?? null)
  );
}

export const BILLING_POLL_INTERVAL_MS = 3000;
export const BILLING_POLL_DEADLINE_MS = 30_000;

export function pollAttempts(
  intervalMs = BILLING_POLL_INTERVAL_MS,
  deadlineMs = BILLING_POLL_DEADLINE_MS,
): number {
  if (intervalMs <= 0) return 0;
  return Math.max(1, Math.floor(deadlineMs / intervalMs));
}
