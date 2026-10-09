import Stripe from "stripe";
import { STARTER_MONTHLY_CREDITS, GROWTH_MONTHLY_CREDITS, CREDIT_PACK_AMOUNT } from "@workspace/db";
import { logger } from "./logger.js";
import { getAppBaseUrl as resolveAppBaseUrl } from "./appUrl.js";

const secretKey = process.env.STRIPE_SECRET_KEY;

const stripe = secretKey ? new Stripe(secretKey) : null;

export const STRIPE_PRICES = {
  starter: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? "",
  growth: process.env.STRIPE_PRICE_GROWTH_MONTHLY ?? "",
  credit_pack: process.env.STRIPE_PRICE_CREDIT_PACK_10 ?? "",
} as const;

export type BillingProduct = keyof typeof STRIPE_PRICES;
export type SubscriptionProduct = Extract<BillingProduct, "starter" | "growth">;

export const BILLING_PRODUCTS = Object.keys(STRIPE_PRICES) as BillingProduct[];

export function isBillingProduct(value: unknown): value is BillingProduct {
  return typeof value === "string" && (BILLING_PRODUCTS as string[]).includes(value);
}

export function isSubscriptionProduct(value: unknown): value is SubscriptionProduct {
  return value === "starter" || value === "growth";
}

/** Monthly credit quota of a subscription tier. */
export function subscriptionQuota(product: SubscriptionProduct): number {
  return product === "growth" ? GROWTH_MONTHLY_CREDITS : STARTER_MONTHLY_CREDITS;
}

/** Credits a one-off pack carries. */
export function creditPackAmount(): number {
  return CREDIT_PACK_AMOUNT;
}

/**
 * Reverse lookup from a Stripe price id to the product it sells, using the
 * same env map Checkout uses (so a renewal invoice for an upgraded
 * subscription grants the quota of the tier Stripe actually billed).
 */
export function productForPriceId(
  priceId: string | null | undefined,
  prices: Record<BillingProduct, string> = STRIPE_PRICES,
): BillingProduct | null {
  if (!priceId) return null;
  for (const product of BILLING_PRODUCTS) {
    if (prices[product] && prices[product] === priceId) return product;
  }
  return null;
}

/**
 * PLAN_CREDIT_ROLLOVER_CAP (default 3): the plan portion of an organization's
 * balance never exceeds this many monthly quotas (step0-merge-decisions E2).
 */
export function planCreditRolloverCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PLAN_CREDIT_ROLLOVER_CAP?.trim();
  if (!raw) return 3;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? n : 3;
}

export function getAppBaseUrl(): string {
  return resolveAppBaseUrl();
}

export function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return stripe;
}

/** The Stripe client exists (secret key set); prices may still be missing. */
export function isStripeClientConfigured(): boolean {
  return !!stripe;
}

export function isStripeConfigured(): boolean {
  return !!stripe && !!STRIPE_PRICES.starter && !!STRIPE_PRICES.growth && !!STRIPE_PRICES.credit_pack;
}

export function logStripeMissing(): void {
  if (!isStripeConfigured()) {
    logger.warn("Stripe billing is not fully configured - checkout disabled");
  }
}

/* ————— Webhook payload shape helpers ————— */

/*
 * Stripe API versions before 2025-03-31 ("basil") put the subscription id on
 * `invoice.subscription` and the price on `line.price`; basil and later move
 * them to `invoice.parent.subscription_details.subscription` and
 * `line.pricing.price_details.price`. The webhook API version is pinned in the
 * Dashboard and cannot be read from the repo, so every reader below accepts
 * both shapes (step0-merge-decisions E3).
 */

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === "object" ? (value as LooseRecord) : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  const rec = asRecord(value);
  return typeof rec?.id === "string" ? rec.id : null;
}

/** `invoice.subscription` (classic) or `invoice.parent.subscription_details.subscription` (basil). */
export function invoiceSubscriptionId(invoice: unknown): string | null {
  const inv = asRecord(invoice);
  if (!inv) return null;
  const classic = idOf(inv.subscription);
  if (classic) return classic;
  const details = asRecord(asRecord(inv.parent)?.subscription_details);
  return idOf(details?.subscription);
}

/** Subscription metadata echoed onto the invoice (classic `subscription_details.metadata`, basil `parent.subscription_details.metadata`). */
export function invoiceSubscriptionMetadata(invoice: unknown): Record<string, string> {
  const inv = asRecord(invoice);
  if (!inv) return {};
  const classic = asRecord(asRecord(inv.subscription_details)?.metadata);
  const basil = asRecord(asRecord(asRecord(inv.parent)?.subscription_details)?.metadata);
  const source = classic ?? basil;
  if (!source) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function invoiceCustomerId(invoice: unknown): string | null {
  return idOf(asRecord(invoice)?.customer);
}

export function invoiceBillingReason(invoice: unknown): string | null {
  const reason = asRecord(invoice)?.billing_reason;
  return typeof reason === "string" ? reason : null;
}

function invoiceLines(invoice: unknown): LooseRecord[] {
  const lines = asRecord(asRecord(invoice)?.lines);
  const data = Array.isArray(lines?.data) ? lines.data : [];
  return data.map(asRecord).filter((line): line is LooseRecord => line != null);
}

function linePriceId(line: LooseRecord): string | null {
  return idOf(line.price) ?? idOf(asRecord(asRecord(line.pricing)?.price_details)?.price);
}

/** Classic `line.proration`, or basil `line.parent.{subscription,invoice}_item_details.proration`. */
function isProrationLine(line: LooseRecord): boolean {
  if (line.proration === true) return true;
  const parent = asRecord(line.parent);
  return (
    asRecord(parent?.subscription_item_details)?.proration === true ||
    asRecord(parent?.invoice_item_details)?.proration === true
  );
}

/** Price ids on the invoice lines, classic `line.price.id` or basil `line.pricing.price_details.price`. */
export function invoiceLinePriceIds(invoice: unknown): string[] {
  const ids: string[] = [];
  for (const line of invoiceLines(invoice)) {
    const id = linePriceId(line);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Price ids of what the invoice actually bills, best evidence first: the
 * regular (non-proration) period lines, then positive proration lines
 * ("Remaining time on Growth"). Credit lines for unused time on the old price
 * ("Unused time on Starter", negative) are never used, so an upgrade or a
 * downgrade is read as the new tier, not the one being left.
 */
export function invoiceBilledPriceIds(invoice: unknown): string[] {
  const regular: string[] = [];
  const prorated: string[] = [];
  for (const line of invoiceLines(invoice)) {
    const id = linePriceId(line);
    if (!id) continue;
    if (!isProrationLine(line)) {
      regular.push(id);
      continue;
    }
    const amount = line.amount;
    if (typeof amount === "number" && amount > 0) prorated.push(id);
  }
  return [...regular, ...prorated];
}

/** Latest line period end (unix seconds) on the invoice, or null. */
export function invoicePeriodEnd(invoice: unknown): number | null {
  let latest: number | null = null;
  for (const line of invoiceLines(invoice)) {
    const end = asRecord(line.period)?.end;
    if (typeof end === "number" && Number.isFinite(end)) {
      latest = latest == null ? end : Math.max(latest, end);
    }
  }
  if (latest != null) return latest;
  const periodEnd = asRecord(invoice)?.period_end;
  return typeof periodEnd === "number" ? periodEnd : null;
}

export function invoiceAmountPaid(invoice: unknown): number | null {
  const amount = asRecord(invoice)?.amount_paid;
  return typeof amount === "number" ? amount : null;
}

export function invoiceAmountDue(invoice: unknown): number | null {
  const amount = asRecord(invoice)?.amount_due;
  return typeof amount === "number" ? amount : null;
}

/** First price id on a subscription object (items.data[0].price.id). */
export function subscriptionPriceIds(subscription: unknown): string[] {
  const items = asRecord(asRecord(subscription)?.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  const ids: string[] = [];
  for (const item of data) {
    const id = idOf(asRecord(item)?.price);
    if (id) ids.push(id);
  }
  return ids;
}

export function subscriptionMetadata(subscription: unknown): Record<string, string> {
  const meta = asRecord(asRecord(subscription)?.metadata);
  if (!meta) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function subscriptionCustomerId(subscription: unknown): string | null {
  return idOf(asRecord(subscription)?.customer);
}

/** `current_period_end` (classic) or the latest `items.data[].current_period_end` (basil), unix seconds. */
export function subscriptionPeriodEnd(subscription: unknown): number | null {
  const sub = asRecord(subscription);
  if (!sub) return null;
  if (typeof sub.current_period_end === "number") return sub.current_period_end;
  const items = asRecord(sub.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  let latest: number | null = null;
  for (const item of data) {
    const end = asRecord(item)?.current_period_end;
    if (typeof end === "number") latest = latest == null ? end : Math.max(latest, end);
  }
  return latest;
}

/** Organization id from Stripe metadata (string "12" -> 12), or null. */
export function organizationIdFromMetadata(metadata: Record<string, unknown> | null | undefined): number | null {
  const raw = metadata?.organizationId;
  const n = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
