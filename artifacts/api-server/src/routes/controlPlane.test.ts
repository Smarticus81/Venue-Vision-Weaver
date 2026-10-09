import assert from "node:assert/strict";
import test from "node:test";

/*
 * WS-H operator-console route helpers: campaign transitions, the
 * review-in-studio gate for prospect emails, linked daily-cap policy writes,
 * and the trend builder behind the Overview sparklines. Pure functions only;
 * no database or network (the db client is created lazily and never queried).
 */
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const {
  CAMPAIGN_TRANSITIONS,
  checkCampaignTransition,
  checkDecisionGate,
  linkedPolicyWrites,
  buildTrends,
} = await import("./controlPlane.js");
const { validatePolicyUpdate } = await import("../control-plane/policies.js");

test("campaign transitions: completed is terminal and launching needs valid steps", () => {
  assert.deepEqual(CAMPAIGN_TRANSITIONS.completed, []);
  assert.equal(checkCampaignTransition({ from: "draft", to: "active", stepCount: 2, maxSteps: 3 }).ok, true);
  assert.equal(checkCampaignTransition({ from: "paused", to: "active", stepCount: 1, maxSteps: 3 }).ok, true);
  assert.equal(checkCampaignTransition({ from: "active", to: "paused", stepCount: 0, maxSteps: 3 }).ok, true);
  assert.equal(checkCampaignTransition({ from: "draft", to: "paused", stepCount: 2, maxSteps: 3 }).ok, false);
  assert.equal(checkCampaignTransition({ from: "completed", to: "active", stepCount: 2, maxSteps: 3 }).ok, false);
  assert.equal(checkCampaignTransition({ from: "active", to: "active", stepCount: 2, maxSteps: 3 }).ok, false);
  const noSteps = checkCampaignTransition({ from: "draft", to: "active", stepCount: 0, maxSteps: 3 });
  assert.equal(noSteps.ok, false);
  const tooMany = checkCampaignTransition({ from: "draft", to: "active", stepCount: 5, maxSteps: 3 });
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.match(tooMany.error, /max_campaign_steps/);
  assert.equal(checkCampaignTransition({ from: "weird", to: "active", stepCount: 1, maxSteps: 3 }).ok, false);
});

test("prospect emails can only be approved after studio review", () => {
  assert.equal(checkDecisionGate({ actionType: "send_outreach_email", decision: "approve", reviewed: false }).ok, false);
  assert.equal(checkDecisionGate({ actionType: "send_outreach_email", decision: "approve", reviewed: true }).ok, true);
  assert.equal(checkDecisionGate({ actionType: "send_outreach_email", decision: "reject", reviewed: false }).ok, true);
  assert.equal(checkDecisionGate({ actionType: "grant_promo_credits", decision: "approve", reviewed: false }).ok, true);
});

test("policy edits: bounds come from validatePolicyUpdate", () => {
  assert.equal(validatePolicyUpdate("max_prospect_emails_per_day", { emails: 100000 }).ok, false);
  assert.deepEqual(validatePolicyUpdate("max_prospect_emails_per_day", { emails: 10 }), { ok: true, value: { emails: 10 } });
  assert.equal(validatePolicyUpdate("agents_enabled", { enabled: false }).ok, true);
  assert.equal(validatePolicyUpdate("deliverability_guard", { status: "ok" }).ok, false);
});

test("daily cap edits keep base and effective caps coherent", () => {
  assert.deepEqual(
    linkedPolicyWrites({ key: "max_prospect_emails_per_day", value: { emails: 10 }, guardStatus: "ok", currentEffective: 15 }),
    [{ key: "max_prospect_emails_per_day_base", value: { emails: 10 } }],
  );
  // While the guard throttles, editing the effective cap leaves the base alone.
  assert.deepEqual(
    linkedPolicyWrites({ key: "max_prospect_emails_per_day", value: { emails: 5 }, guardStatus: "throttled", currentEffective: 7 }),
    [],
  );
  assert.deepEqual(
    linkedPolicyWrites({ key: "max_prospect_emails_per_day_base", value: { emails: 20 }, guardStatus: "ok", currentEffective: 15 }),
    [{ key: "max_prospect_emails_per_day", value: { emails: 20 } }],
  );
  assert.deepEqual(
    linkedPolicyWrites({ key: "max_prospect_emails_per_day_base", value: { emails: 20 }, guardStatus: "throttled", currentEffective: 7 }),
    [{ key: "max_prospect_emails_per_day", value: { emails: 7 } }],
  );
  assert.deepEqual(linkedPolicyWrites({ key: "agents_enabled", value: { enabled: false }, guardStatus: "ok", currentEffective: 15 }), []);
});

test("trends: one point per day, live point last, 7-day delta from history", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const snap = (iso: string, orgs: number, mrr?: number) => ({
    createdAt: new Date(iso),
    metrics: {
      organizations: { total: orgs, paidCount: 1 },
      venues: { activationRate: 20 },
      sessions: { created7d: 3 },
      ...(mrr !== undefined ? { growth: { revenue: { mrrCents: mrr }, deliverability: { window14d: { bounceRate: null } } } } : {}),
    },
  });
  const trends = buildTrends(
    [
      snap("2026-08-01T00:00:00Z", 1), // outside the 30-day window
      snap("2026-09-28T06:00:00Z", 4, 12900),
      snap("2026-09-28T18:00:00Z", 5, 12900), // later the same day wins
      snap("2026-10-05T06:00:00Z", 6, 25800),
    ],
    { now, live: { organizations: { total: 7, paidCount: 2 } } },
  );
  const orgs = trends.series.find((s) => s.key === "organizations")!;
  assert.deepEqual(orgs.points.map((p) => p.value), [5, 6, 7]);
  assert.equal(orgs.current, 7);
  assert.equal(orgs.previous7d, 5);
  assert.equal(orgs.delta7d, 2);
  const mrr = trends.series.find((s) => s.key === "mrr")!;
  // Live metrics have no growth block, so MRR ends at the latest snapshot.
  assert.deepEqual(mrr.points.map((p) => p.value), [12900, 25800]);
  assert.equal(mrr.delta7d, 12900);
  const bounce = trends.series.find((s) => s.key === "bounceRate")!;
  assert.equal(bounce.points.length, 0, "null rates are skipped, never drawn as zero");
  assert.equal(bounce.current, null);
  assert.equal(bounce.delta7d, null);
  assert.equal(bounce.betterWhen, "lower");
});

test("trends: no history means no delta", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const trends = buildTrends([], { now, live: { organizations: { total: 3 } } });
  const orgs = trends.series.find((s) => s.key === "organizations")!;
  assert.equal(orgs.current, 3);
  assert.equal(orgs.delta7d, null);
});
