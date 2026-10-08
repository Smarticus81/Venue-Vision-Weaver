import type { PricingConfig } from "@workspace/api-client-react";

/*
 * ROI math for the landing page calculator (funnel-ux.md 3.6). Pure, so the
 * default worked example is computed at module load and rendered into the
 * static markup; JavaScript only makes it live.
 *
 * Every figure here is an estimate from the visitor's own inputs plus one
 * clearly labelled assumption (LIFT_POINTS). No invented statistics.
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
  /** Bookings needed to cover a year of the suggested plan; null when the booking value is zero. */
  paybackBookings: number | null;
}

/** The assumption printed beside the result: +3 points of tour-to-booking. */
export const LIFT_POINTS = 3;

/** Defaults from the research worked example, labelled as defaults in the UI. */
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
  const text = (raw ?? "").toString().replace(/[^0-9.]/g, "");
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
  const lift = clamp(input.liftPoints ?? LIFT_POINTS, 0, 100);

  const galleriesPerYear = Math.round(tours * 12);
  const bookingsNowPerYear = round1((galleriesPerYear * percent) / 100);
  const extraBookingsPerYear = round1((galleriesPerYear * lift) / 100);
  const bookingsAfterPerYear = round1(bookingsNowPerYear + extraBookingsPerYear);
  const extraRevenuePerYear = Math.round(extraBookingsPerYear * value);

  const planSuggestion: RoiOutput["planSuggestion"] =
    tours <= pricing.starterCredits ? "starter" : "growth";
  const monthly = planSuggestion === "starter" ? pricing.starterMonthly : pricing.growthMonthly;
  const planCostPerYear = Math.round(monthly * 12);
  const paybackBookings = value > 0 ? Math.max(1, Math.ceil(planCostPerYear / value)) : null;

  return {
    bookingsNowPerYear,
    bookingsAfterPerYear,
    extraBookingsPerYear,
    extraRevenuePerYear,
    galleriesPerYear,
    planSuggestion,
    planCostPerYear,
    paybackBookings,
  };
}
