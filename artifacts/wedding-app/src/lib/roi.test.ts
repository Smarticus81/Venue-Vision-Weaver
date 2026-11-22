import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeRoi, parseRoiNumber, ROI_DEFAULTS, clamp } from "./roi.ts";

const pricing = {
  currency: "USD",
  label: "Launch prices",
  starterMonthly: 129,
  growthMonthly: 279,
  creditPack: 59,
  starterCredits: 25,
  growthCredits: 100,
  creditPackCredits: 10,
};

describe("computeRoi", () => {
  it("computes the illustrative defaults without rounding revenue inputs", () => {
    const out = computeRoi(ROI_DEFAULTS, pricing);
    assert.equal(out.galleriesPerYear, 96);
    assert.equal(out.bookingsNowPerYear, 33.6);
    assert.equal(out.extraBookingsPerYear, 2.9);
    assert.equal(out.bookingsAfterPerYear, 36.5);
    assert.equal(out.extraRevenuePerYear, 37_152);
    assert.equal(out.planSuggestion, "starter");
    assert.equal(out.planCostPerYear, 1548);
    assert.deepEqual(out.assumptions, ROI_DEFAULTS);
  });

  it("chooses the cheaper plan plus top-ups instead of forcing a more expensive tier", () => {
    const out = computeRoi({ ...ROI_DEFAULTS, toursPerMonth: 26 }, pricing);
    assert.equal(out.planSuggestion, "starter");
    assert.equal(out.extraPacksPerMonth, 1);
    assert.equal(out.planCostPerYear, (129 + 59) * 12);
  });

  it("includes top-ups above Growth and chooses Growth when it costs less", () => {
    const out = computeRoi({ ...ROI_DEFAULTS, toursPerMonth: 101 }, pricing);
    assert.equal(out.planSuggestion, "growth");
    assert.equal(out.extraPacksPerMonth, 1);
    assert.equal(out.planCostPerYear, (279 + 59) * 12);
  });

  it("never projects more bookings than tours and accepts zero uplift", () => {
    const out = computeRoi({ ...ROI_DEFAULTS, tourToBookingPercent: 99, liftPoints: 25 }, pricing);
    assert.equal(out.bookingsAfterPerYear, out.galleriesPerYear);
    const zero = computeRoi({ ...ROI_DEFAULTS, liftPoints: 0 }, pricing);
    assert.equal(zero.extraRevenuePerYear, 0);
    assert.equal(zero.extraBookingsPerYear, 0);
  });

  it("clamps inputs to the documented ranges", () => {
    const out = computeRoi(
      { toursPerMonth: 9_999, tourToBookingPercent: 250, averageBookingValue: -5 },
      pricing,
    );
    assert.equal(out.galleriesPerYear, 6000);
    assert.equal(out.bookingsNowPerYear, 6000);
    assert.equal(out.extraRevenuePerYear, 0);
    assert.equal(out.assumptions.toursPerMonth, 500);
    assert.equal(out.assumptions.tourToBookingPercent, 100);
    assert.equal(out.assumptions.averageBookingValue, 0);
    assert.equal(out.assumptions.liftPoints, 0);
  });

  it("treats NaN as the minimum", () => {
    const out = computeRoi(
      { toursPerMonth: Number.NaN, tourToBookingPercent: 35, averageBookingValue: 12_900 },
      pricing,
    );
    assert.equal(out.galleriesPerYear, 0);
    assert.equal(out.extraBookingsPerYear, 0);
  });

  it("rounds projected bookings only once", () => {
    const out = computeRoi({ ...ROI_DEFAULTS, toursPerMonth: 1, tourToBookingPercent: 0.4, liftPoints: 0.4 }, pricing);
    assert.equal(out.bookingsAfterPerYear, 0.1);
  });
});

describe("parseRoiNumber / clamp", () => {
  it("accepts formatted input and rejects junk", () => {
    assert.equal(parseRoiNumber("12,900"), 12_900);
    assert.equal(parseRoiNumber("$1,500"), 1500);
    assert.equal(parseRoiNumber(""), 0);
    assert.equal(parseRoiNumber("abc"), 0);
    assert.equal(parseRoiNumber(null), 0);
    assert.equal(parseRoiNumber(7), 7);
    assert.equal(parseRoiNumber("-15"), -15);
    assert.equal(parseRoiNumber("1e2"), 100);
    assert.equal(parseRoiNumber("abc123"), 0);
    assert.equal(parseRoiNumber("Infinity"), 0);
  });
  it("clamps and survives non-finite values", () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(clamp(-1, 0, 3), 0);
    assert.equal(clamp(Number.POSITIVE_INFINITY, 0, 3), 3);
    assert.equal(clamp(Number.NaN, 2, 3), 2);
  });
});
