import type { PublicConfig } from "@workspace/api-client-react";

/**
 * Pure helpers for the published prices and trial terms (no React, no
 * network) so they can be unit-tested with node:test. The hook that reads
 * the meta tag and falls back to GET /public/config lives in
 * usePublicConfig.ts.
 *
 * Defaults mirror the server's launch values (step0-merge-decisions E1). They
 * are only used when neither the HTML meta tag nor the API answered, e.g. on
 * the Vite dev server without the API.
 */
export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  pricing: {
    currency: "USD",
    label: "Launch prices",
    starterMonthly: 129,
    growthMonthly: 279,
    creditPack: 59,
    starterCredits: 25,
    growthCredits: 100,
    creditPackCredits: 10,
  },
  trial: { credits: 5, days: 14 },
  founding: null,
  proof: { mode: "partner" },
  contactEmail: null,
  billingConfigured: false,
  retentionDays: 30,
};

export const PUBLIC_CONFIG_META_NAME = "dreemer-public-config";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Accepts whatever JSON the shell injected and returns a complete config,
 * filling gaps from the defaults. Never throws.
 */
export function parsePublicConfig(raw: unknown): PublicConfig | null {
  if (!isRecord(raw)) return null;
  const d = DEFAULT_PUBLIC_CONFIG;
  const pricing = isRecord(raw.pricing) ? raw.pricing : {};
  const trial = isRecord(raw.trial) ? raw.trial : {};
  const founding = isRecord(raw.founding) ? raw.founding : null;
  const proof = isRecord(raw.proof) ? raw.proof : {};
  const aggregates = isRecord(proof.aggregates) ? proof.aggregates : null;
  return {
    pricing: {
      currency:
        typeof pricing.currency === "string" && pricing.currency.trim()
          ? pricing.currency.trim().toUpperCase()
          : d.pricing.currency,
      label:
        pricing.label === null
          ? null
          : typeof pricing.label === "string"
            ? pricing.label.trim() || null
            : d.pricing.label,
      starterMonthly: positiveNumber(pricing.starterMonthly, d.pricing.starterMonthly),
      growthMonthly: positiveNumber(pricing.growthMonthly, d.pricing.growthMonthly),
      creditPack: positiveNumber(pricing.creditPack, d.pricing.creditPack),
      starterCredits: positiveNumber(pricing.starterCredits, d.pricing.starterCredits),
      growthCredits: positiveNumber(pricing.growthCredits, d.pricing.growthCredits),
      creditPackCredits: positiveNumber(pricing.creditPackCredits, d.pricing.creditPackCredits),
    },
    trial: {
      credits: positiveNumber(trial.credits, d.trial.credits),
      days: positiveNumber(trial.days, d.trial.days),
    },
    founding:
      founding && positiveNumber(founding.slotsLeft, 0) > 0
        ? {
            slotsLeft: positiveNumber(founding.slotsLeft, 0),
            slotsTotal: positiveNumber(founding.slotsTotal, positiveNumber(founding.slotsLeft, 0)),
          }
        : null,
    proof:
      proof.mode === "aggregate" && aggregates
        ? {
            mode: "aggregate",
            aggregates: {
              venues: positiveNumber(aggregates.venues, 0),
              galleries: positiveNumber(aggregates.galleries, 0),
              openedRate: positiveNumber(aggregates.openedRate, 0),
              ctaClickRate: positiveNumber(aggregates.ctaClickRate, 0),
              bookedCount: positiveNumber(aggregates.bookedCount, 0),
              since: typeof aggregates.since === "string" ? aggregates.since : "",
            },
          }
        : { mode: "partner" },
    contactEmail:
      typeof raw.contactEmail === "string" && raw.contactEmail.includes("@")
        ? raw.contactEmail.trim()
        : null,
    billingConfigured: raw.billingConfigured === true,
    retentionDays: positiveNumber(raw.retentionDays, d.retentionDays),
  };
}

/** Parses the <meta name="dreemer-public-config"> the server injects. */
export function readPublicConfigFromDocument(
  doc: Document | undefined = globalThis.document,
): PublicConfig | null {
  if (!doc) return null;
  const content = doc
    .querySelector(`meta[name="${PUBLIC_CONFIG_META_NAME}"]`)
    ?.getAttribute("content");
  if (!content) return null;
  try {
    return parsePublicConfig(JSON.parse(content));
  } catch {
    return null;
  }
}

/** Whole-unit money, e.g. "$129". Falls back to "USD 129" for unknown codes. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

/** Plan vocabulary for venue-facing surfaces (payg reads "Pay as you go"). */
export function planLabel(plan: string | null | undefined): string {
  switch (plan) {
    case "starter":
      return "Starter";
    case "growth":
      return "Growth";
    case "payg":
      return "Pay as you go";
    case "trial":
      return "Free trial";
    case "none":
      return "No plan";
    default:
      return "Free trial";
  }
}

export function isSubscriptionPlan(
  plan: string | null | undefined,
): plan is "starter" | "growth" {
  return plan === "starter" || plan === "growth";
}

/** Cost of one gallery on a plan, in whole currency units, one decimal. */
export function perGalleryCost(monthly: number, credits: number): number {
  if (credits <= 0) return 0;
  return Math.round((monthly / credits) * 10) / 10;
}
