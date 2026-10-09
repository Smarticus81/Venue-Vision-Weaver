import assert from "node:assert/strict";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; these tests never open
// a connection, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const sessions = await import("./sessions.js");
const { VENUE_MEDIA_COVERAGES } = await import("../lib/venueMediaCoverage.js");

type GuardDeps = import("./sessions.js").SessionCreateGuardDeps;
type GuardInput = import("./sessions.js").SessionCreateGuardInput;

const READY_MEDIA = [...VENUE_MEDIA_COVERAGES.map((coverage) => ({ coverage }))];
while (READY_MEDIA.length < 5) READY_MEDIA.push({ coverage: "detail" });

const INPUT: GuardInput = {
  venueId: 9,
  clientIp: "203.0.113.7",
  couplePhotoKeys: ["/objects/uploads/one", "/objects/uploads/two"],
  turnstileToken: null,
  neededCredits: 1,
};

/** Deps that pass every check, recording which expensive steps ran. */
function passingDeps(overrides: Partial<GuardDeps> = {}): GuardDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rateLimit: () => true,
    loadVenueMedia: async () => READY_MEDIA,
    countVenueSessionsToday: async () => 0,
    countVenueSessionsLastHour: async () => 0,
    assertCanSpend: async () => {
      calls.push("spend");
      return { ok: true };
    },
    verifyTurnstile: async () => {
      calls.push("turnstile");
      return { ok: true };
    },
    validatePhotos: async () => {
      calls.push("photos");
    },
    ...overrides,
  };
}

test("a ready venue with credits and valid photos passes every guard in cost order", async () => {
  const deps = passingDeps();
  assert.deepEqual(await sessions.runSessionCreateGuards(INPUT, deps), { ok: true });
  assert.deepEqual(deps.calls, ["spend", "turnstile", "photos"]);
});

test("rate limit refuses before anything else is loaded", async () => {
  const deps = passingDeps({
    rateLimit: () => false,
    loadVenueMedia: async () => {
      throw new Error("must not load media when rate limited");
    },
  });
  const result = await sessions.runSessionCreateGuards(INPUT, deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 429);
  assert.equal(!result.ok && result.body.code, "rate_limited");
});

test("a venue missing coverage roles answers 409 venue_not_ready before credits or photos are touched", async () => {
  const deps = passingDeps({ loadVenueMedia: async () => READY_MEDIA.slice(0, 2) });
  const result = await sessions.runSessionCreateGuards(INPUT, deps);
  assert.equal(!result.ok && result.status, 409);
  assert.equal(!result.ok && result.body.code, "venue_not_ready");
  assert.deepEqual(deps.calls, []);
});

test("daily and hourly venue caps answer 429 with distinct codes", async () => {
  const daily = await sessions.runSessionCreateGuards(
    INPUT,
    passingDeps({ countVenueSessionsToday: async () => 10_000 }),
  );
  assert.equal(!daily.ok && daily.body.code, "venue_daily_cap");
  const hourly = await sessions.runSessionCreateGuards(
    INPUT,
    passingDeps({ countVenueSessionsLastHour: async () => sessions.VENUE_HOURLY_SESSION_CAP }),
  );
  assert.equal(!hourly.ok && hourly.body.code, "venue_hourly_cap");
});

test("a lapsed trial answers 402 trial_expired and never downloads photos", async () => {
  const deps = passingDeps({
    assertCanSpend: async () => ({ ok: false, reason: "trial_expired" }),
  });
  const result = await sessions.runSessionCreateGuards(INPUT, deps);
  assert.equal(!result.ok && result.status, 402);
  assert.equal(!result.ok && result.body.code, "trial_expired");
  assert.equal(!result.ok && result.spendReason, "trial_expired");
  assert.deepEqual(deps.calls, []);
});

test("Turnstile failure is 400, an unreachable verifier is 503", async () => {
  const failed = await sessions.runSessionCreateGuards(
    INPUT,
    passingDeps({ verifyTurnstile: async () => ({ ok: false, reason: "invalid_token", errorCodes: ["invalid-input-response"] }) }),
  );
  assert.equal(!failed.ok && failed.status, 400);
  assert.equal(!failed.ok && failed.body.code, "turnstile_failed");
  const unavailable = await sessions.runSessionCreateGuards(
    INPUT,
    passingDeps({ verifyTurnstile: async () => ({ ok: false, reason: "verify_failed", errorCodes: [] }) }),
  );
  assert.equal(!unavailable.ok && unavailable.status, 503);
  assert.equal(!unavailable.ok && unavailable.body.code, "turnstile_unavailable");
});

test("photo validation errors surface the couple-facing message as 400 invalid_photos", async () => {
  const result = await sessions.runSessionCreateGuards(
    INPUT,
    passingDeps({
      validatePhotos: async () => {
        throw new Error("Photo 2 is too dark. Try one taken in daylight.");
      },
    }),
  );
  assert.equal(!result.ok && result.status, 400);
  assert.equal(!result.ok && result.body.code, "invalid_photos");
  assert.equal(!result.ok && result.body.error, "Photo 2 is too dark. Try one taken in daylight.");
});

test("low-credit email goes out once per dip, again only after a later grant", () => {
  const notified = new Date("2026-10-01T00:00:00Z");
  assert.equal(sessions.shouldSendLowCreditEmail({ balance: 5, lowCreditNotifiedAt: null, lastGrantAt: null }), false);
  assert.equal(sessions.shouldSendLowCreditEmail({ balance: 1, lowCreditNotifiedAt: null, lastGrantAt: null }), true);
  assert.equal(
    sessions.shouldSendLowCreditEmail({ balance: 1, lowCreditNotifiedAt: notified, lastGrantAt: null }),
    false,
  );
  assert.equal(
    sessions.shouldSendLowCreditEmail({
      balance: 1,
      lowCreditNotifiedAt: notified,
      lastGrantAt: new Date("2026-09-01T00:00:00Z"),
    }),
    false,
  );
  assert.equal(
    sessions.shouldSendLowCreditEmail({
      balance: 1,
      lowCreditNotifiedAt: notified,
      lastGrantAt: new Date("2026-10-05T00:00:00Z"),
    }),
    true,
  );
});

test("gallery recovery matches the address exactly (lower(email) = $1), never with LIKE", () => {
  const query = sessions.recoverableSessionsQuery("a_b%c@example.com").toSQL();
  assert.match(query.sql, /lower\("couple_sessions"\."couple_email"\) = \$\d/);
  assert.doesNotMatch(query.sql, /\blike\b/i);
  assert.ok(query.params.includes("a_b%c@example.com"));
  assert.ok(query.params.includes("couple"), "only couple sessions are recoverable, never samples");
});
