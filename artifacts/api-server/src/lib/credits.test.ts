import assert from "node:assert/strict";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const credits = await import("./credits.js");

/* Rollover rule (step0-merge-decisions E2):
 * newBalance = min(balance + quota, max(balance, quota * cap)) */

test("computePlanGrant adds the full quota while under the cap", () => {
  const grant = credits.computePlanGrant({ balance: 0, quota: 25, cap: 3 });
  assert.deepEqual(grant, { newBalance: 25, delta: 25, faceValue: 25, clipped: false });
  const second = credits.computePlanGrant({ balance: 25, quota: 25, cap: 3 });
  assert.deepEqual(second, { newBalance: 50, delta: 25, faceValue: 25, clipped: false });
});

test("computePlanGrant clips at quota * cap", () => {
  assert.deepEqual(credits.computePlanGrant({ balance: 60, quota: 25, cap: 3 }), {
    newBalance: 75,
    delta: 15,
    faceValue: 25,
    clipped: true,
  });
  assert.deepEqual(credits.computePlanGrant({ balance: 75, quota: 25, cap: 3 }), {
    newBalance: 75,
    delta: 0,
    faceValue: 25,
    clipped: true,
  });
});

test("computePlanGrant never lowers a balance that is already above the cap (packs survive)", () => {
  const grant = credits.computePlanGrant({ balance: 300, quota: 25, cap: 3 });
  assert.equal(grant.newBalance, 300);
  assert.equal(grant.delta, 0);
});

test("computePlanGrant treats a cap below 1 as 1 and ignores negative balances", () => {
  assert.equal(credits.computePlanGrant({ balance: 0, quota: 100, cap: 0 }).newBalance, 100);
  assert.equal(credits.computePlanGrant({ balance: -5, quota: 10, cap: 3 }).newBalance, 10);
  assert.equal(credits.computePlanGrant({ balance: 4, quota: 0, cap: 3 }).delta, 0);
});

test("growth quota with a default cap of 3 saturates at 300", () => {
  let balance = 0;
  for (let month = 0; month < 6; month += 1) {
    balance = credits.computePlanGrant({ balance, quota: 100, cap: 3 }).newBalance;
  }
  assert.equal(balance, 300);
});

test("low-credit threshold helper", () => {
  assert.equal(credits.LOW_CREDIT_THRESHOLD, 2);
  assert.equal(credits.isLowCredit(2), true);
  assert.equal(credits.isLowCredit(0), true);
  assert.equal(credits.isLowCredit(3), false);
  assert.equal(credits.isLowCredit(5, 5), true);
});

test("creditsForSession is one credit per gallery", () => {
  assert.equal(credits.creditsForSession(), 1);
});
