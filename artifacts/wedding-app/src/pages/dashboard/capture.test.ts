import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCouplePhotos,
  captureHint,
  captureIssues,
  createSessionErrorCopy,
  isValidEmail,
  isValidWeddingMonth,
} from "./capture.ts";

const ready = { ready: true };
const ok = { ok: true } as const;

test("captureIssues mirrors the session endpoint's rules", () => {
  assert.deepEqual(
    captureIssues({ photoCount: 2, email: "a@b.co", weddingMonth: "2027-06", consent: true, readiness: ready, spend: ok }),
    [],
  );
  assert.deepEqual(
    captureIssues({ photoCount: 1, email: "nope", weddingMonth: "2027-13", consent: false, readiness: ready, spend: ok }),
    ["photos", "email", "month", "consent"],
  );
  assert.deepEqual(
    captureIssues({
      photoCount: 3,
      email: "a@b.co",
      weddingMonth: null,
      consent: true,
      readiness: { ready: false },
      spend: { ok: false, reason: "insufficient_credits" },
    }),
    ["venue_not_ready", "spend_blocked"],
  );
  assert.deepEqual(
    captureIssues({ photoCount: 4, email: "a@b.co", weddingMonth: null, consent: true, readiness: ready, spend: ok }),
    ["photos"],
  );
});

test("captureHint names the first fix in plain words", () => {
  assert.equal(captureHint([], 2), null);
  assert.equal(captureHint(["photos", "email"], 1), "Add 1 more photo of the couple.");
  assert.equal(captureHint(["photos"], 0), "Add 2 more photos of the couple.");
  assert.equal(captureHint(["photos"], 4), "Use at most 3 photos.");
  assert.match(captureHint(["spend_blocked", "photos"], 0)!, /credits/);
  assert.match(captureHint(["consent"], 2)!, /both/);
});

test("addCouplePhotos keeps the cap and skips unsupported files", () => {
  const jpg = (n: string) => ({ name: n, type: "image/jpeg" });
  const heic = { name: "h", type: "image/heic" };
  const first = addCouplePhotos([], [jpg("a"), heic, jpg("b")]);
  assert.deepEqual(first.accepted.map((f) => f.name), ["a", "b"]);
  assert.equal(first.rejectedType, 1);
  const second = addCouplePhotos(first.accepted, [jpg("c"), jpg("d")]);
  assert.deepEqual(second.accepted.map((f) => f.name), ["a", "b", "c"]);
  assert.equal(second.overflow, 1);
});

test("email and month validation", () => {
  assert.equal(isValidEmail(" sam@example.com "), true);
  assert.equal(isValidEmail("sam@example"), false);
  assert.equal(isValidWeddingMonth(null), true);
  assert.equal(isValidWeddingMonth("2027-01"), true);
  assert.equal(isValidWeddingMonth("2027-1"), false);
});

test("createSessionErrorCopy turns server codes into owner copy", () => {
  assert.match(createSessionErrorCopy("venue_not_ready", "x"), /five photo views/);
  assert.match(createSessionErrorCopy("stale_upload", "x"), /again/);
  assert.equal(createSessionErrorCopy(undefined, "fallback"), "fallback");
  assert.equal(createSessionErrorCopy("brand_new_code", "fallback"), "fallback");
});
