import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activationMilestones,
  computeActivation,
  localSpendCheck,
  nextCoverageFor,
  trialDaysLeft,
  venueReadiness,
} from "./activation.ts";

test("localSpendCheck mirrors the server's trial-then-balance order", () => {
  assert.deepEqual(localSpendCheck({ creditsBalance: 3, trial: { onTrial: true, expired: true } }), { ok: false, reason: "trial_expired" });
  assert.deepEqual(localSpendCheck({ creditsBalance: 0, trial: { onTrial: true, expired: false } }), { ok: false, reason: "insufficient_credits" });
  assert.deepEqual(localSpendCheck({ creditsBalance: 0, trial: null }), { ok: false, reason: "insufficient_credits" });
  assert.deepEqual(localSpendCheck({ creditsBalance: 1, trial: { onTrial: false, expired: false } }), { ok: true });
});

const five = ["exterior", "ceremony", "reception", "detail", "natural_light"].map(
  (coverage) => ({ coverage }),
);

test("venueReadiness needs five photos and every view", () => {
  assert.equal(venueReadiness([]).ready, false);
  assert.deepEqual(venueReadiness([]).missing.length, 5);
  assert.equal(venueReadiness(five).ready, true);
  const fourViewsFivePhotos = [...five.slice(0, 4), { coverage: "exterior" }];
  const r = venueReadiness(fourViewsFivePhotos);
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ["natural_light"]);
  assert.equal(r.needed, 1);
  const unknownTag = venueReadiness([...five, { coverage: "wide" }]);
  assert.equal(unknownTag.ready, true, "unknown legacy tags do not break readiness");
});

test("nextCoverageFor picks the least-covered view and cycles through a batch", () => {
  assert.equal(nextCoverageFor([]), "exterior");
  assert.equal(nextCoverageFor([{ coverage: "exterior" }]), "ceremony");
  assert.equal(nextCoverageFor([{ coverage: "exterior" }], ["ceremony", "reception"]), "detail");
  assert.equal(nextCoverageFor(five), "exterior", "a full set starts again at the first view");
});

test("computeActivation orders the five steps and names the next one", () => {
  const empty = computeActivation({
    readiness: venueReadiness([]),
    bookingUrl: null,
    tourCardDownloadedAt: null,
    coupleGalleries: 0,
    plan: "trial",
    firstPaidAt: null,
  });
  assert.equal(empty.doneCount, 0);
  assert.equal(empty.next, "photos");
  assert.equal(empty.complete, false);

  const partial = computeActivation({
    readiness: venueReadiness(five.slice(0, 3)),
    bookingUrl: "https://example.test/tours",
    tourCardDownloadedAt: null,
    coupleGalleries: 2,
    plan: "trial",
    firstPaidAt: null,
  });
  assert.equal(partial.steps[0].detail, "3 of 5 views");
  assert.equal(partial.next, "photos");
  assert.equal(partial.doneCount, 2);

  const paygIsPaid = computeActivation({
    readiness: venueReadiness(five),
    bookingUrl: "https://example.test/tours",
    tourCardDownloadedAt: "2026-10-01T00:00:00Z",
    coupleGalleries: 1,
    plan: "payg",
    firstPaidAt: null,
  });
  assert.equal(paygIsPaid.complete, true);
  assert.equal(paygIsPaid.next, null);
});

test("trialDaysLeft rounds up and floors at zero", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  assert.equal(trialDaysLeft("2026-10-10T00:00:00Z", now), 2);
  assert.equal(trialDaysLeft("2026-10-01T00:00:00Z", now), 0);
  assert.equal(trialDaysLeft(null, now), null);
  assert.equal(trialDaysLeft("not a date", now), null);
});

test("activationMilestones fires only on transitions seen in this session", () => {
  assert.deepEqual(activationMilestones(null, { count: 5, ready: true }), []);
  assert.deepEqual(activationMilestones({ count: 0, ready: false }, { count: 2, ready: false }), ["first_photo"]);
  assert.deepEqual(activationMilestones({ count: 4, ready: false }, { count: 5, ready: true }), ["venue_ready"]);
  assert.deepEqual(activationMilestones({ count: 0, ready: false }, { count: 5, ready: true }), ["first_photo", "venue_ready"]);
  assert.deepEqual(activationMilestones({ count: 5, ready: true }, { count: 4, ready: false }), []);
});
