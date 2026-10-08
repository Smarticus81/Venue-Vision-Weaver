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
  it("reproduces the research worked example with the defaults", () => {
    const out = computeRoi(ROI_DEFAULTS, pricing);
    assert.equal(out.galleriesPerYear, 96);
    assert.equal(out.bookingsNowPerYear, 33.6);
    assert.equal(out.extraBookingsPerYear, 2.9);
    assert.equal(out.bookingsAfterPerYear, 36.5);
    assert.equal(out.extraRevenuePerYear, 37_410);
    assert.equal(out.planSuggestion, "starter");
    assert.equal(out.planCostPerYear, 1548);
    assert.equal(out.paybackBookings, 1);
  });

  it("suggests Growth above the Starter monthly quota", () => {
    const out = computeRoi({ ...ROI_DEFAULTS, toursPerMonth: 26 }, pricing);
    assert.equal(out.planSuggestion, "growth");
    assert.equal(out.planCostPerYear, 279 * 12);
  });

  it("clamps inputs to the documented ranges", () => {
    const out = computeRoi(
      { toursPerMonth: 9_999, tourToBookingPercent: 250, averageBookingValue: -5 },
      pricing,
    );
    assert.equal(out.galleriesPerYear, 6000);
    assert.equal(out.bookingsNowPerYear, 6000);
    assert.equal(out.extraRevenuePerYear, 0);
    assert.equal(out.paybackBookings, null);
  });

  it("treats NaN as the minimum", () => {
    const out = computeRoi(
      { toursPerMonth: Number.NaN, tourToBookingPercent: 35, averageBookingValue: 12_900 },
      pricing,
    );
    assert.equal(out.galleriesPerYear, 0);
    assert.equal(out.extraBookingsPerYear, 0);
  });

  it("needs at least one booking to pay back a plan", () => {
    const out = computeRoi(
      { toursPerMonth: 8, tourToBookingPercent: 35, averageBookingValue: 1_000_000 },
      pricing,
    );
    assert.equal(out.paybackBookings, 1);
    const cheap = computeRoi(
      { toursPerMonth: 8, tourToBookingPercent: 35, averageBookingValue: 500 },
      pricing,
    );
    assert.equal(cheap.paybackBookings, 4);
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
  });
  it("clamps and survives non-finite values", () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(clamp(-1, 0, 3), 0);
    assert.equal(clamp(Number.POSITIVE_INFINITY, 0, 3), 3);
    assert.equal(clamp(Number.NaN, 2, 3), 2);
  });
});
