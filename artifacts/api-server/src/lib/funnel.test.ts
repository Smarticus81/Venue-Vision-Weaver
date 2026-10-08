import assert from "node:assert/strict";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const {
  readPricingConfig,
  readTrialConfig,
  readFoundingOffer,
  readPublicContactEmail,
  readRetentionDays,
  publicConfigMetaTag,
} = await import("./publicConfig.js");
const { trialState, canSpendCredits } = await import("./trial.js");

const DAY_MS = 86_400_000;

test("readPricingConfig uses launch defaults and ignores invalid env values", () => {
  const defaults = readPricingConfig({});
  assert.equal(defaults.currency, "USD");
  assert.equal(defaults.label, "Launch prices");
  assert.deepEqual(
    [defaults.starterMonthly, defaults.growthMonthly, defaults.creditPack],
    [129, 279, 59],
  );
  assert.deepEqual(
    [defaults.starterCredits, defaults.growthCredits, defaults.creditPackCredits],
    [25, 100, 10],
  );

  const custom = readPricingConfig({
    PRICING_STARTER_MONTHLY: "99",
    PRICING_GROWTH_MONTHLY: "not-a-number",
    PRICING_CREDIT_PACK: "-5",
    PRICING_LABEL: "",
    PRICING_CURRENCY: "EUR",
  });
  assert.equal(custom.starterMonthly, 99);
  assert.equal(custom.growthMonthly, 279, "NaN falls back to the default");
  assert.equal(custom.creditPack, 59, "non-positive falls back to the default");
  assert.equal(custom.label, null, "an empty label hides the caption");
  assert.equal(custom.currency, "EUR");
});

test("readTrialConfig floors the window at one day", () => {
  assert.deepEqual(readTrialConfig({}), { credits: 5, days: 14 });
  assert.equal(readTrialConfig({ TRIAL_DAYS: "0.4" }).days, 1);
  assert.equal(readTrialConfig({ TRIAL_DAYS: "30" }).days, 30);
  assert.equal(readTrialConfig({ TRIAL_DAYS: "abc" }).days, 14);
});

test("readFoundingOffer is null once the slots run out and never exceeds the total", () => {
  assert.deepEqual(readFoundingOffer({}), { slotsLeft: 10, slotsTotal: 10 });
  assert.equal(readFoundingOffer({ PUBLIC_FOUNDING_SLOTS_LEFT: "0" }), null);
  assert.deepEqual(
    readFoundingOffer({ PUBLIC_FOUNDING_SLOTS_LEFT: "12", PUBLIC_FOUNDING_SLOTS_TOTAL: "8" }),
    { slotsLeft: 8, slotsTotal: 8 },
  );
});

test("readPublicContactEmail falls back through reply-to and the sender address", () => {
  assert.equal(readPublicContactEmail({}), null);
  assert.equal(readPublicContactEmail({ EMAIL_FROM: "Dreemer <hello@example.com>" }), "hello@example.com");
  assert.equal(
    readPublicContactEmail({ EMAIL_FROM: "Dreemer <hello@example.com>", OUTREACH_REPLY_TO: "sam@example.com" }),
    "sam@example.com",
  );
  assert.equal(
    readPublicContactEmail({ PUBLIC_CONTACT_EMAIL: "Team@Example.com", OUTREACH_REPLY_TO: "sam@example.com" }),
    "team@example.com",
  );
});

test("readRetentionDays defaults to 30 and floors at 1", () => {
  assert.equal(readRetentionDays({}), 30);
  assert.equal(readRetentionDays({ COUPLE_PHOTO_RETENTION_DAYS: "0" }), 30);
  assert.equal(readRetentionDays({ COUPLE_PHOTO_RETENTION_DAYS: "0.2" }), 1);
  assert.equal(readRetentionDays({ COUPLE_PHOTO_RETENTION_DAYS: "7" }), 7);
});

test("publicConfigMetaTag escapes the JSON for an HTML attribute", () => {
  const tag = publicConfigMetaTag({
    pricing: readPricingConfig({ PRICING_LABEL: `"<Launch> & 'go'` }),
    trial: readTrialConfig({}),
    founding: null,
    proof: { mode: "partner" },
    contactEmail: null,
    billingConfigured: false,
    retentionDays: 30,
  });
  assert.match(tag, /^<meta name="dreemer-public-config" content="/);
  assert.ok(!tag.includes("<Launch>"), "angle brackets are escaped");
  assert.ok(tag.includes("&quot;"), "double quotes are escaped");
  assert.ok(tag.includes("&#39;"), "single quotes are escaped");
});

test("trialState reads legacy rows as createdAt + TRIAL_DAYS and counts down", () => {
  const createdAt = new Date("2026-10-01T00:00:00Z");
  const org = { plan: "trial", creditsBalance: 5, trialEndsAt: null, createdAt };

  const early = trialState(org, new Date(createdAt.getTime() + 3 * DAY_MS), 14);
  assert.equal(early.onTrial, true);
  assert.equal(early.expired, false);
  assert.equal(early.daysLeft, 11);
  assert.equal(early.endsAt, new Date(createdAt.getTime() + 14 * DAY_MS).toISOString());
  assert.equal(early.creditsRemaining, 5);

  const late = trialState(org, new Date(createdAt.getTime() + 20 * DAY_MS), 14);
  assert.equal(late.expired, true);
  assert.equal(late.daysLeft, 0);

  const explicit = trialState(
    { ...org, trialEndsAt: new Date(createdAt.getTime() + 30 * DAY_MS) },
    new Date(createdAt.getTime() + 20 * DAY_MS),
    14,
  );
  assert.equal(explicit.expired, false, "an explicit trial_ends_at wins over the default window");

  const paid = trialState({ ...org, plan: "starter" }, new Date(), 14);
  assert.deepEqual(paid, { onTrial: false, endsAt: null, daysLeft: null, expired: false, creditsRemaining: 5 });
});

test("canSpendCredits blocks by time first, then by balance", () => {
  const createdAt = new Date("2026-10-01T00:00:00Z");
  const base = { plan: "trial", creditsBalance: 3, trialEndsAt: null, createdAt };

  assert.deepEqual(canSpendCredits(base, 1, new Date(createdAt.getTime() + DAY_MS)), { ok: true });
  assert.deepEqual(canSpendCredits(base, 1, new Date(createdAt.getTime() + 15 * DAY_MS)), {
    ok: false,
    reason: "trial_expired",
  });
  assert.deepEqual(
    canSpendCredits({ ...base, creditsBalance: 0 }, 1, new Date(createdAt.getTime() + DAY_MS)),
    { ok: false, reason: "insufficient_credits" },
  );
  assert.deepEqual(
    canSpendCredits({ ...base, plan: "payg", creditsBalance: 2 }, 1, new Date(createdAt.getTime() + 400 * DAY_MS)),
    { ok: true },
    "a purchase lifts the time block",
  );
});
