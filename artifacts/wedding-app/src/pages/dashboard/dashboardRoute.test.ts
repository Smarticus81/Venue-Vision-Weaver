import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanedSearch, dashboardPathForVenue, parseDashboardLocation, tabFromHash } from "./dashboardRoute.ts";

test("tabFromHash accepts tab ids and the upgrade aliases", () => {
  assert.equal(tabFromHash("#billing"), "billing");
  assert.equal(tabFromHash("#pricing"), "billing");
  assert.equal(tabFromHash("#Photos"), "photos");
  assert.equal(tabFromHash("#nonsense"), null);
  assert.equal(tabFromHash(""), null);
});

test("parseDashboardLocation reads the signup and Stripe hand-offs", () => {
  const fresh = parseDashboardLocation("?welcome=1&import=1", "");
  assert.deepEqual(fresh, { tab: "photos", welcome: true, importRequested: true, billing: null, venue: null });
  const paid = parseDashboardLocation("?billing=success", "");
  assert.equal(paid.tab, "billing");
  assert.equal(paid.billing, "success");
  const cancelled = parseDashboardLocation("billing=cancel", "#galleries");
  assert.equal(cancelled.tab, "galleries");
  assert.equal(cancelled.billing, "cancel");
  assert.equal(parseDashboardLocation("?billing=other", "").billing, null);
  assert.equal(parseDashboardLocation("", "").tab, null);
});

test("cleanedSearch drops only the one-shot flags", () => {
  assert.equal(cleanedSearch("?billing=success&welcome=1&import=1"), "");
  assert.equal(cleanedSearch("?billing=success&venue=willow"), "", "the venue hand-off is one-shot too (the choice is stored)");
  assert.equal(cleanedSearch("?billing=success&ref=mail"), "?ref=mail");
  assert.equal(cleanedSearch(""), "");
});

test("owner email links to /dashboard/<slug> open that venue", () => {
  assert.equal(dashboardPathForVenue("willow-house"), "/dashboard?venue=willow-house");
  assert.equal(dashboardPathForVenue("../evil"), "/dashboard");
  assert.equal(dashboardPathForVenue(undefined), "/dashboard");
  assert.equal(parseDashboardLocation("?venue=Willow-House", "").venue, "willow-house");
  assert.equal(parseDashboardLocation("?venue=%3Cscript%3E", "").venue, null);
});
