import type { PricingConfig } from "@workspace/api-client-react";

/*
 * Pure scenario math. Every figure uses editable visitor assumptions;
 * defaults are illustrative, not observed product performance.
 */

export interface RoiInput {
  toursPerMonth: number;
  tourToBookingPercent: number;
  averageBookingValue: number;
  /** Extra tour-to-booking percentage points attributed to the gallery. Default 3. */
  liftPoints?: number;
}

export interface RoiOutput {
  bookingsNowPerYear: number;
  bookingsAfterPerYear: number;
  extraBookingsPerYear: number;
  extraRevenuePerYear: number;
  galleriesPerYear: number;
  planSuggestion: "starter" | "growth";
  planCostPerYear: number;
  extraPacksPerMonth: number;
  /** Normalized inputs used by both the calculation and its explanation. */
  assumptions: Required<RoiInput>;
}

/** Editable illustrative uplift, not a measured conversion claim. */
export const LIFT_POINTS = 3;

/** Illustrative defaults, labelled in the UI. */
export const ROI_DEFAULTS: Required<RoiInput> = {
  toursPerMonth: 8,
  tourToBookingPercent: 35,
  averageBookingValue: 12_900,
  liftPoints: LIFT_POINTS,
};

export const ROI_LIMITS = {
  toursPerMonth: { min: 0, max: 500 },
  tourToBookingPercent: { min: 0, max: 100 },
  averageBookingValue: { min: 0, max: 1_000_000 },
  liftPoints: { min: 0, max: 100 },
} as const;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Parse a form field into a number; blank or junk becomes 0. */
export function parseRoiNumber(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const text = (raw ?? "").toString().replace(/[$,\s]/g, "");
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

export function computeRoi(input: RoiInput, pricing: PricingConfig): RoiOutput {
  const tours = clamp(input.toursPerMonth, ROI_LIMITS.toursPerMonth.min, ROI_LIMITS.toursPerMonth.max);
  const percent = clamp(
    input.tourToBookingPercent,
    ROI_LIMITS.tourToBookingPercent.min,
    ROI_LIMITS.tourToBookingPercent.max,
  );
  const value = clamp(
    input.averageBookingValue,
    ROI_LIMITS.averageBookingValue.min,
    ROI_LIMITS.averageBookingValue.max,
  );
  const lift = clamp(input.liftPoints ?? LIFT_POINTS, 0, 100 - percent);

  const galleriesPerYear = Math.round(tours * 12);
  const bookingsNowPerYear = round1((galleriesPerYear * percent) / 100);
  const extraBookingsPerYear = round1((galleriesPerYear * lift) / 100);
  const bookingsAfterPerYear = round1((galleriesPerYear * (percent + lift)) / 100);
  const extraRevenuePerYear = Math.round((galleriesPerYear * lift * value) / 100);

  // Model a full calendar without relying on previously accumulated credits.
  // Choose the less expensive subscription + monthly top-up combination.
  const candidates = (["starter", "growth"] as const).map((plan) => {
    const included = plan === "starter" ? pricing.starterCredits : pricing.growthCredits;
    const base = plan === "starter" ? pricing.starterMonthly : pricing.growthMonthly;
    const packs = Math.ceil(Math.max(0, tours - included) / pricing.creditPackCredits);
    return { plan, packs, monthly: base + packs * pricing.creditPack };
  }).sort((a, b) => a.monthly - b.monthly);
  const choice = candidates[0]!;
  const planSuggestion = choice.plan;
  const planCostPerYear = Math.round(choice.monthly * 12);

  return {
    bookingsNowPerYear,
    bookingsAfterPerYear,
    extraBookingsPerYear,
    extraRevenuePerYear,
    galleriesPerYear,
    planSuggestion,
    planCostPerYear,
    extraPacksPerMonth: choice.packs,
    assumptions: { toursPerMonth: tours, tourToBookingPercent: percent, averageBookingValue: value, liftPoints: lift },
  };
}
