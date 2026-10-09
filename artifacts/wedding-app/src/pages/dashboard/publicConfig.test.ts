import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PUBLIC_CONFIG,
  formatMoney,
  isSubscriptionPlan,
  parsePublicConfig,
  perGalleryCost,
  planLabel,
} from "./publicConfig.ts";

test("parsePublicConfig fills gaps from the defaults and ignores junk", () => {
  const parsed = parsePublicConfig({
    pricing: { starterMonthly: "149", growthMonthly: -4, label: "" },
    trial: { days: 0 },
    founding: { slotsLeft: 3 },
    contactEmail: "hello@example.test",
    billingConfigured: "yes",
  });
  assert.ok(parsed);
  assert.equal(parsed.pricing.starterMonthly, 149);
  assert.equal(parsed.pricing.growthMonthly, DEFAULT_PUBLIC_CONFIG.pricing.growthMonthly);
  assert.equal(parsed.pricing.label, null, "an empty label hides the label");
  assert.equal(parsed.trial.days, DEFAULT_PUBLIC_CONFIG.trial.days);
  assert.deepEqual(parsed.founding, { slotsLeft: 3, slotsTotal: 3 });
  assert.equal(parsed.contactEmail, "hello@example.test");
  assert.equal(parsed.billingConfigured, false, "only boolean true counts");
  assert.deepEqual(parsed.proof, { mode: "partner" });
});

test("parsePublicConfig returns null for non-objects and hides a sold-out founding offer", () => {
  assert.equal(parsePublicConfig(null), null);
  assert.equal(parsePublicConfig("nope"), null);
  const parsed = parsePublicConfig({ founding: { slotsLeft: 0, slotsTotal: 10 } });
  assert.equal(parsed?.founding, null);
});

test("parsePublicConfig keeps aggregate proof only when aggregates are present", () => {
  const parsed = parsePublicConfig({
    proof: {
      mode: "aggregate",
      aggregates: {
        venues: 6,
        galleries: 80,
        openedRate: 61.2,
        ctaClickRate: 12.5,
        bookedCount: 9,
        since: "2026-05-01",
      },
    },
  });
  assert.equal(parsed?.proof.mode, "aggregate");
  assert.equal(parsed?.proof.aggregates?.galleries, 80);
  const partner = parsePublicConfig({ proof: { mode: "aggregate" } });
  assert.equal(partner?.proof.mode, "partner");
});

test("formatMoney prints whole units and survives unknown currencies", () => {
  assert.equal(formatMoney(129, "USD"), "$129");
  assert.equal(formatMoney(279.4, "USD"), "$279");
  assert.equal(formatMoney(59, "NOPE"), "NOPE 59");
});

test("planLabel uses plain words and never leaks internal plan ids", () => {
  assert.equal(planLabel("payg"), "Pay as you go");
  assert.equal(planLabel("trial"), "Free trial");
  assert.equal(planLabel("none"), "No plan");
  assert.equal(planLabel(undefined), "Free trial");
  assert.equal(isSubscriptionPlan("growth"), true);
  assert.equal(isSubscriptionPlan("payg"), false);
});

test("perGalleryCost divides monthly price by included galleries", () => {
  assert.equal(perGalleryCost(129, 25), 5.2);
  assert.equal(perGalleryCost(279, 100), 2.8);
  assert.equal(perGalleryCost(59, 0), 0);
});
