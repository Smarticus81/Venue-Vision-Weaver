import type { PublicConfig } from "@workspace/api-client-react";
import { describeApiError } from "./errors";
import { formatMoney } from "../../lib/publicConfig";
import { formatUnitPrice, isSubscriptionPlan, perGalleryCost } from "./plans";
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
    `${formatUnitPrice(perGalleryCost(monthly, credits), pricing.currency)} per gallery`;
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
  /** Credits in one pack, from the public config; the pack button names it. */
  packCredits?: number;
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
  if (input.product === "credit_pack") label = `Add ${input.packCredits ?? 10} credits`;
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

/**
 * What the organization looked like just before the owner left for Stripe.
 * Kept in sessionStorage so the return trip can tell "the webhook already
 * landed" (confirm at once) from "still waiting" (poll), instead of
 * comparing against a page load that may already be fresh.
 */
export interface CheckoutSnapshot extends BillingSnapshot {
  product: BillingProductId;
  /** Epoch ms the checkout started. */
  at: number;
}

export const CHECKOUT_SNAPSHOT_KEY = "dreemer:checkout-snapshot";
/** A snapshot older than this belongs to an abandoned checkout. */
export const CHECKOUT_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface SnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveCheckoutSnapshot(storage: SnapshotStorage | null | undefined, snapshot: CheckoutSnapshot): void {
  if (!storage) return;
  try {
    storage.setItem(CHECKOUT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode: the return trip falls back to polling */
  }
}

/** Reads and clears the snapshot; null when absent, malformed or stale. */
export function takeCheckoutSnapshot(
  storage: SnapshotStorage | null | undefined,
  now: number = Date.now(),
): CheckoutSnapshot | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(CHECKOUT_SNAPSHOT_KEY);
    storage.removeItem(CHECKOUT_SNAPSHOT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CheckoutSnapshot>;
    if (
      typeof parsed.plan !== "string" ||
      typeof parsed.creditsBalance !== "number" ||
      typeof parsed.at !== "number" ||
      (parsed.product !== "starter" && parsed.product !== "growth" && parsed.product !== "credit_pack")
    ) {
      return null;
    }
    if (now - parsed.at > CHECKOUT_SNAPSHOT_MAX_AGE_MS || parsed.at > now + 60_000) return null;
    return {
      plan: parsed.plan,
      creditsBalance: parsed.creditsBalance,
      billingPeriodEnd: typeof parsed.billingPeriodEnd === "string" ? parsed.billingPeriodEnd : null,
      product: parsed.product,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

/**
 * Mirrors requireOrgAdmin on the server (orgRole === "org:admin"). A
 * response without the field at all (an older API) shows the controls and
 * lets the server's 403 org_admin_required decide.
 */
export function isOrgAdmin(role: string | null | undefined): boolean {
  return role === undefined || role === "org:admin";
}

export type BillingReturnState ="confirming" | "confirmed" | "timeout" | "cancelled";

/** Owner-facing line for each stage of the return from Stripe. */
export function billingReturnMessage(state: BillingReturnState, creditsBalance: number, planName: string): string {
  switch (state) {
    case "confirming":
      return "Confirming your payment with Stripe. This usually takes a few seconds.";
    case "confirmed":
      return `Payment confirmed. You are on ${planName} with ${creditsBalance} ${creditsBalance === 1 ? "credit" : "credits"}.`;
    case "timeout":
      return "Stripe has not confirmed the payment yet. Your credits appear here as soon as it does; nothing to redo.";
    case "cancelled":
      return "Checkout was cancelled. Nothing was charged.";
  }
}
