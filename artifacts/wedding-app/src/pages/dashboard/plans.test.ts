import { test } from "node:test";
import assert from "node:assert/strict";
import { isSubscriptionPlan, perGalleryCost, planLabel } from "./plans.ts";

test("planLabel uses plain words and never leaks internal plan ids", () => {
  assert.equal(planLabel("payg"), "Pay as you go");
  assert.equal(planLabel("trial"), "Free trial");
  assert.equal(planLabel("none"), "No plan");
  assert.equal(planLabel("starter"), "Starter");
  assert.equal(planLabel(undefined), "Free trial");
  assert.equal(isSubscriptionPlan("growth"), true);
  assert.equal(isSubscriptionPlan("payg"), false);
  assert.equal(isSubscriptionPlan(null), false);
});

test("perGalleryCost divides monthly price by included galleries", () => {
  assert.equal(perGalleryCost(129, 25), 5.2);
  assert.equal(perGalleryCost(279, 100), 2.8);
  assert.equal(perGalleryCost(59, 0), 0);
});
