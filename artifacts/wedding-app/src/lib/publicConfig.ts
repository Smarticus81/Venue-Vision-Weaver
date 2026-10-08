import { useMemo } from "react";
import { useGetPublicConfig, type PublicConfig } from "@workspace/api-client-react";

/*
 * Published prices, trial terms, founding offer, proof mode and contact
 * address for the public site (funnel-ux.md 2.3).
 *
 * Order of truth: the <meta name="dreemer-public-config"> tag the API server
 * injects into every shell response (zero fetches, real values on first
 * paint) → GET /api/public/config (Vite dev server has no meta injection) →
 * DEFAULT_PUBLIC_CONFIG (the same defaults the server uses when no env is set).
 */

export const PUBLIC_CONFIG_META_NAME = "dreemer-public-config";

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
  founding: { slotsLeft: 10, slotsTotal: 10 },
  proof: { mode: "partner" },
  contactEmail: null,
  billingConfigured: false,
  retentionDays: 30,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Validate an unknown JSON value into a PublicConfig. Missing or malformed
 * fields fall back to the defaults; a value that is not an object at all
 * returns null so callers can tell "nothing there" from "something there".
 */
export function parsePublicConfig(raw: unknown): PublicConfig | null {
  if (!isRecord(raw)) return null;
  const d = DEFAULT_PUBLIC_CONFIG;
  const pricingRaw = isRecord(raw.pricing) ? raw.pricing : {};
  const trialRaw = isRecord(raw.trial) ? raw.trial : {};
  const foundingRaw = isRecord(raw.founding) ? raw.founding : null;
  const proofRaw = isRecord(raw.proof) ? raw.proof : {};
  const aggregatesRaw = isRecord(proofRaw.aggregates) ? proofRaw.aggregates : null;

  const founding =
    foundingRaw && positiveNumber(foundingRaw.slotsLeft, 0) > 0
      ? {
          slotsLeft: Math.floor(positiveNumber(foundingRaw.slotsLeft, 0)),
          slotsTotal: Math.floor(positiveNumber(foundingRaw.slotsTotal, d.founding!.slotsTotal)),
        }
      : null;

  const proof: PublicConfig["proof"] =
    proofRaw.mode === "aggregate" && aggregatesRaw
      ? {
          mode: "aggregate",
          aggregates: {
            venues: nonNegativeNumber(aggregatesRaw.venues, 0),
            galleries: nonNegativeNumber(aggregatesRaw.galleries, 0),
            openedRate: nonNegativeNumber(aggregatesRaw.openedRate, 0),
            ctaClickRate: nonNegativeNumber(aggregatesRaw.ctaClickRate, 0),
            bookedCount: nonNegativeNumber(aggregatesRaw.bookedCount, 0),
            since: optionalString(aggregatesRaw.since) ?? "",
          },
        }
      : { mode: "partner" };

  return {
    pricing: {
      currency: optionalString(pricingRaw.currency) ?? d.pricing.currency,
      label: pricingRaw.label === null ? null : optionalString(pricingRaw.label) ?? d.pricing.label,
      starterMonthly: positiveNumber(pricingRaw.starterMonthly, d.pricing.starterMonthly),
      growthMonthly: positiveNumber(pricingRaw.growthMonthly, d.pricing.growthMonthly),
      creditPack: positiveNumber(pricingRaw.creditPack, d.pricing.creditPack),
      starterCredits: positiveNumber(pricingRaw.starterCredits, d.pricing.starterCredits),
      growthCredits: positiveNumber(pricingRaw.growthCredits, d.pricing.growthCredits),
      creditPackCredits: positiveNumber(pricingRaw.creditPackCredits, d.pricing.creditPackCredits),
    },
    trial: {
      credits: positiveNumber(trialRaw.credits, d.trial.credits),
      days: positiveNumber(trialRaw.days, d.trial.days),
    },
    founding,
    proof,
    contactEmail: optionalString(raw.contactEmail),
    billingConfigured: raw.billingConfigured === true,
    retentionDays: positiveNumber(raw.retentionDays, d.retentionDays),
  };
}

/** The subset of Document we read, so tests can pass a stub. */
export interface MetaReader {
  querySelector(selector: string): { getAttribute(name: string): string | null } | null;
}

/** Parse `<meta name="dreemer-public-config">`; null when absent or unreadable. */
export function readPublicConfigFromDocument(
  root: MetaReader | undefined = typeof document !== "undefined" ? document : undefined,
): PublicConfig | null {
  if (!root) return null;
  try {
    const content = root.querySelector(`meta[name="${PUBLIC_CONFIG_META_NAME}"]`)?.getAttribute("content");
    if (!content) return null;
    return parsePublicConfig(JSON.parse(content));
  } catch {
    return null;
  }
}

/** Meta tag → GET /api/public/config → defaults. Never suspends, never throws. */
export function usePublicConfig(): PublicConfig {
  const fromMeta = useMemo(() => readPublicConfigFromDocument(), []);
  const query = useGetPublicConfig({
    query: {
      enabled: fromMeta === null,
      staleTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  });
  return useMemo(
    () => fromMeta ?? parsePublicConfig(query.data) ?? DEFAULT_PUBLIC_CONFIG,
    [fromMeta, query.data],
  );
}

/** Whole currency units, no decimals: 129 → "$129". Unknown currency codes fall back to "USD 129". */
export function formatMoney(amount: number, currency: string): string {
  const whole = Math.round(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(whole);
  } catch {
    return `${currency} ${whole.toLocaleString("en-US")}`;
  }
}

/** Price of one gallery on a monthly plan, rounded to whole units (129/25 → 5). */
export function perGalleryPrice(monthly: number, credits: number): number {
  if (credits <= 0) return monthly;
  return Math.max(1, Math.round(monthly / credits));
}
