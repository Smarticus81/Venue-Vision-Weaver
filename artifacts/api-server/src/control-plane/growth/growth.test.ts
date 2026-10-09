import assert from "node:assert/strict";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.APP_BASE_URL ??= "https://growth.test";
delete process.env.XAI_API_KEY;

const kpiMath = await import("./kpiMath.js");
const { planPrices } = await import("./config.js");
const { METRIC_KEYS, parseSegment, describeMetricKeys } = await import("./metricKeys.js");
const experiments = await import("./experiments.js");
const adaptation = await import("./adaptation.js");
const { normalizeSegmentGuidance, EMPTY_SEGMENT_GUIDANCE } = await import("./adaptationTypes.js");
const variants = await import("./variants.js");
const { classifyVenueType, normalizeRegion } = await import("./segments.js");
const attribution = await import("./attribution.js");
const trialClock = await import("./trialClock.js");
const lifecycle = await import("./lifecycleEmails.js");
const trial = await import("../../lib/trial.js");
const digest = await import("./digest.js");
const { listOrganizationsQuery, listVenuesQuery } = await import("./queries.js");
const growthActions = await import("./actions.js");
const { ACTION_CATALOG, computeRequiresApproval } = await import("../actions.js");
const { AGENT_DEFINITIONS, AGENT_KEYS } = await import("../agents.js");
const { TOOL_NAMES } = await import("../tools.js");
const { growthTools } = await import("./tools.js");
const governance = await import("./governance.js");
const guidance = await import("./guidance.js");
const runner = await import("../runner.js");
const { stepExceedsCap, CampaignStepCapError } = await import("./studioHooks.js");
const { BANNED_PHRASES } = await import("../outreach/copywriter.js");
const fx = await import("./testFixtures.js");

const { NOW, daysAgo, hoursAfter, makeOrg, makeProspect, makeEmail, makeLedger, makeVariant, makeSegment, makeVariantStat, fixtureKpis, OK_GUARD, DEFAULT_PRICES } = fx;

type GrowthKpis = import("./kpiTypes.js").GrowthKpis;
type AdaptationInput = import("./adaptation.js").AdaptationInput;
type ControlExperimentRow = import("@workspace/db").ControlExperiment;
type ControlAdaptationRow = import("@workspace/db").ControlAdaptation;

const WEEKS = kpiMath.weekStarts(NOW, 12);

/* ————— 1. calendar helpers ————— */

test("kpiMath: mondayOf and weekStarts", () => {
  assert.equal(kpiMath.mondayOf(NOW).toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(kpiMath.mondayOf(new Date("2026-10-04T23:59:00Z")).toISOString(), "2026-09-28T00:00:00.000Z", "Sunday belongs to the previous Monday");
  assert.equal(WEEKS.length, 12);
  assert.equal(WEEKS[11]!.toISOString(), "2026-10-05T00:00:00.000Z");
  for (let i = 1; i < WEEKS.length; i += 1) {
    assert.equal(WEEKS[i]!.getTime() - WEEKS[i - 1]!.getTime(), 7 * kpiMath.DAY_MS);
  }
  assert.equal(kpiMath.rate(1, 0), null);
  assert.equal(kpiMath.rate(2, 9), 0.2222);
  assert.equal(kpiMath.percentile([], 0.5), null);
  assert.equal(kpiMath.percentile([10, 30], 0.5), 20);
});

/* ————— 2. signups ————— */

test("kpiMath: signups by week count orgs, venues and attributed conversions", () => {
  const thisWeek = new Date("2026-10-06T10:00:00Z");
  const lastWeek = new Date("2026-09-30T10:00:00Z");
  const orgs = [makeOrg({ id: 1, createdAt: thisWeek }), makeOrg({ id: 2, createdAt: thisWeek }), makeOrg({ id: 3, createdAt: lastWeek })];
  const prospects = [
    makeProspect({ id: 1, status: "converted", convertedAt: thisWeek, convertedOrganizationId: 1, contactCount: 0 }),
    makeProspect({ id: 2, status: "converted", convertedAt: thisWeek, convertedOrganizationId: 2, contactCount: 1 }),
  ];
  const signups = kpiMath.buildSignups(orgs, prospects, [thisWeek, lastWeek, daysAgo(40)], NOW, WEEKS);
  assert.equal(signups.orgs7d, 2);
  assert.equal(signups.orgs30d, 3);
  assert.equal(signups.venues7d, 1);
  assert.equal(signups.venues30d, 2);
  assert.equal(signups.attributedToOutbound30d, 1, "contactCount 0 is never attributed to outbound");
  const current = signups.byWeek[signups.byWeek.length - 1]!;
  const previous = signups.byWeek[signups.byWeek.length - 2]!;
  assert.deepEqual([current.orgs, current.venues, current.attributed], [2, 1, 1]);
  assert.deepEqual([previous.orgs, previous.venues, previous.attributed], [1, 1, 0]);
});

/* ————— 3. activation ————— */

test("kpiMath: activation funnel, stage rates and time to first gallery", () => {
  const created = daysAgo(20);
  const a = makeOrg({
    id: 1,
    createdAt: created,
    firstVenueAt: hoursAfter(created, 1),
    photosReadyAt: hoursAfter(created, 2),
    firstGalleryAt: hoursAfter(created, 10),
    firstGalleryViewedAt: hoursAfter(created, 12),
    secondGalleryAt: hoursAfter(created, 10 + 24 * 10),
  });
  const b = makeOrg({ id: 2, createdAt: created, firstVenueAt: hoursAfter(created, 1), photosReadyAt: null });
  const c = makeOrg({ id: 3, createdAt: created });
  const d = makeOrg({
    id: 4,
    createdAt: created,
    firstVenueAt: hoursAfter(created, 3),
    photosReadyAt: hoursAfter(created, 4),
    firstGalleryAt: hoursAfter(created, 30),
    secondGalleryAt: hoursAfter(created, 30 + 24 * 20),
  });
  const activation = kpiMath.buildActivation([a, b, c, d], NOW, WEEKS, 3, 14);
  assert.deepEqual(activation.funnel, { orgs: 4, withVenue: 3, photosReady: 2, firstGallery: 2, galleryViewed: 1, secondGallery14d: 1 });
  assert.equal(activation.rates.firstGallery, 1);
  assert.equal(activation.rates.withVenue, 0.75);
  assert.equal(activation.timeToFirstGalleryHours.median, 20, "median of two values is their mean (10h and 30h)");
  assert.equal(activation.timeToFirstGalleryHours.n, 2);
  assert.equal(activation.firstGalleryWithin7d, 0.5, "2 of 4 matured orgs made a gallery within 7 days");
  assert.equal(activation.minPhotos, 3);
});

/* ————— 4. trial -> paid ————— */

test("kpiMath: trial->paid uses matured cohorts only and counts pack buyers as paid", () => {
  const matured = daysAgo(37); // Monday of that week + 21d is well before NOW
  const immature = daysAgo(7);
  const orgs = [
    makeOrg({ id: 1, createdAt: matured, plan: "trial", firstPaidAt: hoursAfter(matured, 48), firstGalleryAt: hoursAfter(matured, 5) }),
    makeOrg({ id: 2, createdAt: matured, plan: "trial", firstGalleryAt: null }),
    makeOrg({ id: 3, createdAt: immature, plan: "trial", firstPaidAt: hoursAfter(immature, 2) }),
  ];
  const result = kpiMath.buildTrialToPaid(orgs, NOW, WEEKS, 14);
  assert.deepEqual(result.overall, { orgs: 2, paid: 1, rate: 0.5 });
  assert.equal(result.byActivation.activated.rate, 1);
  assert.equal(result.byActivation.notActivated.rate, 0);
  assert.ok(result.byActivation.activated.rate! > result.byActivation.notActivated.rate!);
  const immatureCohort = result.byCohortWeek.find((w) => w.weekStart === kpiMath.mondayOf(immature).toISOString())!;
  assert.equal(immatureCohort.matured, false);
  assert.equal(immatureCohort.rate, null);
  assert.equal(immatureCohort.paid, 1);
  assert.equal(result.medianDaysToPaid, 1.04, "median of 2 days and 2 hours in days, rounded");
});

/* ————— 5. countPaidOrgs ————— */

test("countPaidOrgs: first_paid_at or a paid plan", () => {
  assert.equal(
    kpiMath.countPaidOrgs([
      { plan: "trial", firstPaidAt: daysAgo(2) },
      { plan: "payg", firstPaidAt: null },
      { plan: "trial", firstPaidAt: null },
    ]),
    2,
  );
});

/* ————— 6. revenue ————— */

test("kpiMath: MRR from plan mix and display prices; pack revenue from the ledger", (t) => {
  const orgs = [
    makeOrg({ id: 1, plan: "starter", firstPaidAt: daysAgo(10) }),
    makeOrg({ id: 2, plan: "starter", firstPaidAt: daysAgo(10) }),
    makeOrg({ id: 3, plan: "growth", firstPaidAt: daysAgo(10) }),
    makeOrg({ id: 4, plan: "trial" }),
    makeOrg({ id: 5, plan: "weird" }),
  ];
  const ledger = [makeLedger("pack_purchase", 10), makeLedger("pack_purchase", 10), makeLedger("pack_purchase", 10), makeLedger("pack_purchase", 10, daysAgo(45))];
  const revenue = kpiMath.buildRevenue(orgs, ledger, DEFAULT_PRICES, daysAgo(30));
  assert.equal(revenue.mrrCents, 53700);
  assert.equal(revenue.subscriptionOrgs, 3);
  assert.equal(revenue.arpaCents, 17900);
  assert.equal(revenue.packPurchases30d, 3);
  assert.equal(revenue.packRevenueCents30d, 17700);
  assert.equal(revenue.planMix.none, 1, "unknown plan strings land in none");
  assert.equal(revenue.prices.source, "env");

  const previous = process.env.PRICING_STARTER_MONTHLY;
  t.after(() => {
    if (previous === undefined) delete process.env.PRICING_STARTER_MONTHLY;
    else process.env.PRICING_STARTER_MONTHLY = previous;
  });
  process.env.PRICING_STARTER_MONTHLY = "99";
  assert.equal(planPrices().starterCents, 9900);
  process.env.PRICING_STARTER_MONTHLY = "abc";
  assert.equal(planPrices().starterCents, 12900);
  assert.equal(planPrices().growthCents, 27900);
  assert.equal(planPrices().creditPackCents, 5900);
});

/* ————— 7. credits ————— */

test("kpiMath: credit totals by ledger reason and float", () => {
  const orgs = [makeOrg({ id: 1, creditsBalance: 4, firstPaidAt: daysAgo(3) }), makeOrg({ id: 2, creditsBalance: 11 })];
  const ledger = [
    makeLedger("session_debit", -1),
    makeLedger("session_debit", -1),
    makeLedger("session_debit", -1),
    makeLedger("session_refund", 1),
    makeLedger("pack_purchase", 10),
    makeLedger("admin_adjust", 5),
    makeLedger("trial_grant", 5),
    makeLedger("subscription_grant", 25),
    makeLedger("session_debit", -1, daysAgo(40)),
  ];
  const credits = kpiMath.buildCredits(orgs, ledger, daysAgo(30));
  assert.equal(credits.consumed30d, 3);
  assert.equal(credits.refunded30d, 1);
  assert.equal(credits.purchased30d, 10);
  assert.equal(credits.promo30d, 5);
  assert.equal(credits.trialGranted30d, 5);
  assert.equal(credits.subscriptionGranted30d, 25);
  assert.equal(credits.consumedPerPaidOrg30d, 3);
  assert.equal(credits.float, 15);
});

/* ————— 8. churn ————— */

test("kpiMath: churn counts deletions, expired trials and trials expiring next week", () => {
  const orgs = [
    makeOrg({ id: 1, plan: "none", firstPaidAt: daysAgo(90), churnedAt: daysAgo(5) }),
    makeOrg({ id: 2, plan: "trial", trialExpiredAt: daysAgo(4), firstPaidAt: null }),
    makeOrg({ id: 3, plan: "trial", trialExpiredAt: daysAgo(2), firstPaidAt: daysAgo(1) }),
    makeOrg({ id: 4, plan: "trial", trialEndsAt: hoursAfter(NOW, 24 * 3), firstGalleryAt: daysAgo(1) }),
    makeOrg({ id: 5, plan: "trial", trialEndsAt: hoursAfter(NOW, 24 * 5) }),
    makeOrg({ id: 6, plan: "trial", trialEndsAt: hoursAfter(NOW, 24 * 9) }),
    makeOrg({ id: 7, plan: "starter", firstPaidAt: daysAgo(60) }),
  ];
  const churn = kpiMath.buildChurn(orgs, NOW, daysAgo(30));
  assert.equal(churn.subscriptionsDeleted30d, 1);
  assert.equal(churn.trialsExpired30d, 2);
  assert.equal(churn.trialsExpiredWithoutPurchase30d, 1);
  assert.equal(churn.paidOrgsAtWindowStart, 2, "org 1 paid before the window and churned inside it; org 7 still paying");
  assert.equal(churn.logoChurnRate30d, 0.5);
  assert.equal(churn.trialsExpiringNext7d, 2);
  assert.equal(churn.trialsExpiringNext7dWithoutGallery, 1);
});

/* ————— 9. reply attribution ————— */

test("kpiMath: replies credit the last email sent before the reply, once per prospect", () => {
  const replied = makeProspect({ id: 1, status: "replied", repliedAt: daysAgo(7), replySentiment: "positive", contactCount: 2 });
  const converted = makeProspect({ id: 2, status: "converted", convertedAt: daysAgo(2), convertedOrganizationId: 9, contactCount: 2 });
  const silent = makeProspect({ id: 3 });
  const emails = [
    makeEmail({ id: 10, prospectId: 1, sentAt: daysAgo(9) }),
    makeEmail({ id: 11, prospectId: 1, sentAt: daysAgo(5) }),
    makeEmail({ id: 20, prospectId: 2, sentAt: daysAgo(6) }),
    makeEmail({ id: 21, prospectId: 2, sentAt: daysAgo(1) }),
  ];
  const map = kpiMath.attributeRepliesToEmails(emails, [replied, converted, silent], NOW);
  assert.deepEqual(map.get(10), { replied: true, positive: true, converted: false }, "day-9 email precedes the day-7 reply");
  assert.equal(map.get(11), undefined);
  assert.deepEqual(
    map.get(20),
    { replied: false, positive: false, converted: true },
    "a conversion without a recorded reply (auto-attributed signup) is not a reply",
  );
  assert.equal(map.get(21), undefined);
  assert.equal([...map.keys()].length, 2, "no sent email -> no attribution");
});

/* ————— 10. outbound ————— */

test("kpiMath: outbound funnel, rates, segments, variants and steps", () => {
  const prospects = [
    ...Array.from({ length: 10 }, (_, i) =>
      makeProspect({ id: i + 1, region: i % 2 === 0 ? "austin,  tx" : null, venueType: i < 5 ? "barn_farm" : null }),
    ),
  ];
  prospects[0] = { ...prospects[0]!, status: "replied", repliedAt: daysAgo(2), replySentiment: "positive" };
  // A converted prospect counts as replied (once), so the signup is the neutral replier.
  prospects[1] = { ...prospects[1]!, status: "converted", repliedAt: daysAgo(2), replySentiment: "neutral", convertedAt: daysAgo(1), convertedOrganizationId: 1, contactCount: 1 };
  const emails = prospects.map((p, i) =>
    makeEmail({
      id: 100 + i,
      prospectId: p.id,
      sentAt: daysAgo(4),
      deliveredAt: i === 9 ? null : daysAgo(4),
      bouncedAt: i === 9 ? daysAgo(4) : null,
      variantKey: i < 6 ? "tours_to_bookings" : i < 8 ? "open_dates" : null,
      step: i < 7 ? 1 : 2,
    }),
  );
  const orgs = [makeOrg({ id: 1, firstGalleryAt: daysAgo(1), firstPaidAt: null })];
  const outbound = kpiMath.buildOutbound(emails, prospects, orgs, [{ id: 7, name: "Hill Country", status: "active" }], fx.defaultVariants(), 0, { ...EMPTY_SEGMENT_GUIDANCE }, daysAgo(30), NOW);

  assert.equal(outbound.funnel.sent, 10);
  assert.equal(outbound.funnel.delivered, 9);
  assert.equal(outbound.funnel.bounced, 1);
  assert.equal(outbound.funnel.replied, 2);
  assert.equal(outbound.funnel.positiveReplied, 1);
  assert.equal(outbound.funnel.signups, 1);
  assert.equal(outbound.funnel.activated, 1);
  assert.equal(outbound.funnel.paid, 0);
  assert.equal(outbound.rates.replyRate, kpiMath.rate(2, 9));
  assert.equal(outbound.rates.signupRate, 0.1);
  assert.equal(outbound.rates.bounceRate, 0.1);

  const regions = outbound.bySegment.filter((s) => s.segmentType === "region");
  assert.deepEqual(regions.map((s) => s.segment).sort(), ["Austin, TX", "Unknown"]);
  const venueTypes = outbound.bySegment.filter((s) => s.segmentType === "venue_type");
  assert.deepEqual(venueTypes.map((s) => s.segment).sort(), ["barn_farm", "other"]);

  const unassigned = outbound.byVariant.find((v) => v.variantKey === "unassigned")!;
  assert.equal(unassigned.sent, 2);
  const control = outbound.byVariant.find((v) => v.variantKey === "tours_to_bookings")!;
  assert.equal(control.sent, 6);
  assert.equal(control.smoothedPositiveReplyRate, Math.round(((control.positiveReplied + 1) / (control.delivered + 2)) * 10_000) / 10_000);
  assert.deepEqual(
    outbound.byStep.map((s) => [s.step, s.sent]),
    [
      [1, 7],
      [2, 3],
    ],
  );
  assert.equal(outbound.byCampaign[0]!.sent, 0);

  // Top-20 cap per segment type.
  const manyProspects = Array.from({ length: 25 }, (_, i) => makeProspect({ id: 500 + i, region: `Region ${i}` }));
  const manyEmails = manyProspects.map((p, i) => makeEmail({ id: 600 + i, prospectId: p.id, sentAt: daysAgo(3) }));
  const capped = kpiMath.buildOutbound(manyEmails, manyProspects, [], [], [], 0, { ...EMPTY_SEGMENT_GUIDANCE }, daysAgo(30), NOW);
  assert.equal(capped.bySegment.filter((s) => s.segmentType === "region").length, 20);
});

/* ————— 11. deliverability ————— */

test("kpiMath: deliverability status thresholds and policy guard precedence", () => {
  const since14 = daysAgo(14);
  const batch = (sent: number, bounced: number, complained: number) =>
    Array.from({ length: sent }, (_, i) =>
      makeEmail({
        id: i + 1,
        prospectId: i + 1,
        sentAt: daysAgo(3),
        bouncedAt: i < bounced ? daysAgo(3) : null,
        complainedAt: i >= bounced && i < bounced + complained ? daysAgo(3) : null,
      }),
    );
  const status = (sent: number, bounced: number, complained: number) =>
    kpiMath.buildDeliverability(batch(sent, bounced, complained), since14, 50, OK_GUARD, 15, 15).status;
  assert.equal(status(40, 0, 0), "insufficient_data");
  assert.equal(status(100, 4, 0), "paused");
  assert.equal(status(100, 3, 0), "throttled");
  assert.equal(status(100, 2, 0), "warn");
  assert.equal(status(100, 0, 1), "paused", "1 complaint in 100 is 1%, far above the 0.08% hard limit");
  assert.equal(status(2500, 0, 1), "warn", "any complaint below the throttle rate still warns");
  assert.equal(status(2000, 0, 1), "throttled", "0.05% complaints throttle");
  assert.equal(status(100, 0, 0), "ok");
  const paused = kpiMath.buildDeliverability(batch(100, 0, 0), since14, 50, { status: "paused", since: NOW.toISOString(), reason: "operator", okDays: 0 }, 15, 0);
  assert.equal(paused.status, "ok", "computed status reflects the window");
  assert.equal(paused.guard.status, "paused", "the policy guard wins in guard.status");
  assert.equal(paused.guard.effectiveCap, 0);
});

/* ————— computeGrowthKpis on an empty database ————— */

test("computeGrowthKpis: empty tables yield zeros, nulls and data-quality notes, never an exception", async () => {
  const kpis = await fixtureKpis({});
  assert.equal(kpis.version, 1);
  assert.equal(kpis.outbound.funnel.sent, 0);
  assert.equal(kpis.deliverability.status, "insufficient_data");
  assert.equal(kpis.trialToPaid.overall.rate, null);
  assert.equal(kpis.revenue.mrrCents, 0);
  assert.ok(kpis.dataQuality.some((d) => /PRICING_\*/.test(d)));
  assert.ok(kpis.dataQuality.some((d) => /No studio outreach/.test(d)));
  assert.equal(kpis.activation.byCohortWeek.length, 12);
  assert.equal(kpis.outbound.byVariant.length, 4, "registry rows are always listed");
});

/* ————— 12. metric registry ————— */

test("metric registry reads scopes", async () => {
  const kpis = await fixtureKpis({});
  kpis.outbound.bySegment = [makeSegment({ segment: "Austin, TX", sent: 40, delivered: 36, positiveReplied: 4, replied: 6 })];
  kpis.outbound.byVariant = [makeVariantStat({ variantKey: "open_dates", sent: 30, delivered: 28, positiveReplied: 2 })];
  const source = { growth: kpis };
  const positive = METRIC_KEYS["outbound.positive_reply_rate"]!;
  assert.deepEqual(positive.read(source, { segment: "region:austin, tx", variantKey: null }), { value: 0.1111, n: 36 });
  assert.deepEqual(positive.read(source, { segment: null, variantKey: "open_dates" }), { value: 0.0714, n: 28 });
  assert.equal(positive.read(source, { segment: "region:Austin, TX", variantKey: "open_dates" }), null, "segment and variant together are not supported");
  assert.equal(positive.read(source, { segment: "region:Nowhere", variantKey: null }), null);
  assert.equal(METRIC_KEYS["activation.time_to_first_gallery_hours_median"]!.direction, "lower");
  assert.equal(METRIC_KEYS["outbound.bounce_rate"]!.supportsSegment, false);
  assert.equal(METRIC_KEYS["nope.unknown"], undefined);
  assert.deepEqual(parseSegment("venue_type:Barn_Farm"), { type: "venue_type", value: "barn_farm" });
  assert.equal(parseSegment("campaign:3"), null);
  assert.equal(
    METRIC_KEYS["sessions.failure_rate_7d"]!.read({ growth: kpis, sessions: { total: 10, byStatus: {}, created7d: 8, created30d: 10, ready7d: 7, failed7d: 1, failureRate7d: 12.5, avgCompletionMinutes7d: 4 } }, { segment: null, variantKey: null })?.value,
    0.125,
  );
});

/* ————— 13-17. evaluator ————— */

function card(overrides: Partial<import("./experiments.js").ExperimentCard> = {}): import("./experiments.js").ExperimentCard {
  return {
    id: 1,
    status: "running",
    primaryMetricKey: "outbound.positive_reply_rate",
    baseline: 0.05,
    minDetectableLift: 0.5,
    killThreshold: null,
    decisionDate: hoursAfter(NOW, 24 * 10),
    segment: null,
    variantKey: null,
    startedAt: daysAgo(10),
    ...overrides,
  };
}

async function kpisWithPositiveRate(positiveReplied: number, delivered: number, bounced = 0): Promise<GrowthKpis> {
  const kpis = await fixtureKpis({});
  kpis.outbound.rates.positiveReplyRate = kpiMath.rate(positiveReplied, delivered);
  kpis.outbound.rates.bounceRate = kpiMath.rate(bounced, delivered);
  kpis.outbound.funnel.delivered = delivered;
  kpis.outbound.funnel.sent = delivered;
  kpis.outbound.funnel.positiveReplied = positiveReplied;
  return kpis;
}

test("evaluator: continue before the decision date, with target = baseline * (1 + lift)", async () => {
  const snapshot = { growth: await kpisWithPositiveRate(4, 60) };
  const evaluation = experiments.evaluateExperiment(card(), snapshot, NOW, 30);
  assert.equal(evaluation.decision, "continue");
  assert.equal(evaluation.target, 0.075);
  assert.equal(evaluation.observedValue, 0.0667);
  assert.equal(evaluation.n, 60);
  assert.match(evaluation.reason, /decision date 2026-10-18 not reached/);
});

test("evaluator: win / kill / inconclusive at the decision date", async () => {
  const due = card({ decisionDate: daysAgo(1) });
  const win = experiments.evaluateExperiment(due, { growth: await kpisWithPositiveRate(8, 60) }, NOW, 30);
  assert.equal(win.decision, "win");
  assert.match(win.reason, /value 0.1333, n 60, baseline 0.05, target 0.075/);
  const kill = experiments.evaluateExperiment(due, { growth: await kpisWithPositiveRate(1, 60) }, NOW, 30);
  assert.equal(kill.decision, "kill");
  const between = experiments.evaluateExperiment(due, { growth: await kpisWithPositiveRate(4, 60) }, NOW, 30);
  assert.equal(between.decision, "inconclusive");
  const small = experiments.evaluateExperiment(due, { growth: await kpisWithPositiveRate(5, 20) }, NOW, 30);
  assert.equal(small.decision, "inconclusive");
  assert.match(small.reason, /GROWTH_EXPERIMENT_MIN_N/);
});

test("evaluator: early kill honours lower-is-better direction", async () => {
  const bounce = card({ primaryMetricKey: "outbound.bounce_rate", baseline: 0.02, minDetectableLift: 0.25, killThreshold: 0.04 });
  const bad = experiments.evaluateExperiment(bounce, { growth: await kpisWithPositiveRate(0, 60, 3) }, NOW, 30);
  assert.equal(bad.decision, "kill", "0.05 >= kill threshold 0.04 with n 60 before the decision date");
  assert.equal(bad.target, 0.015);
  const fine = experiments.evaluateExperiment(bounce, { growth: await kpisWithPositiveRate(0, 100, 1) }, NOW, 30);
  assert.equal(fine.decision, "continue");
});

test("evaluator: not measurable without a key or without data for the scope", async () => {
  const snapshot = { growth: await fixtureKpis({}) };
  assert.equal(experiments.evaluateExperiment(card({ primaryMetricKey: null }), snapshot, NOW, 30).decision, "not_measurable");
  assert.equal(experiments.evaluateExperiment(card({ primaryMetricKey: "made.up" }), snapshot, NOW, 30).decision, "not_measurable");
  const scoped = experiments.evaluateExperiment(card({ segment: "region:Austin, TX" }), snapshot, NOW, 30);
  assert.equal(scoped.decision, "not_measurable");
  assert.match(scoped.reason, /no data for scope segment region:Austin, TX/);
});

test("evaluator: required sample size follows the two-proportion approximation", async () => {
  const expected = (15.7 * 0.034 * 0.966) / (0.034 * 0.2) ** 2;
  const requiredN = experiments.requiredSampleSize(0.034, 0.2)!;
  assert.ok(Math.abs(requiredN - expected) / expected < 0.05, `requiredN ${requiredN} vs ${expected}`);
  const snapshot = { growth: await kpisWithPositiveRate(17, 500) };
  const evaluation = experiments.evaluateExperiment(card({ baseline: 0.034, minDetectableLift: 0.2 }), snapshot, NOW, 30);
  assert.equal(evaluation.underpowered, true);
  assert.equal(evaluation.requiredN, requiredN);
  assert.equal(experiments.requiredSampleSize(0, 0.2), null);
  assert.equal(experiments.requiredSampleSize(null, 0.2), null);
});

/* ————— 18-21. adaptation rules ————— */

function adaptationInput(kpis: GrowthKpis, overrides: Partial<AdaptationInput> = {}): AdaptationInput {
  return {
    kpis,
    guard: OK_GUARD,
    baseCap: 15,
    effectiveCap: 15,
    stepCap: 3,
    variants: fx.defaultVariants(),
    guidance: { ...EMPTY_SEGMENT_GUIDANCE },
    now: NOW,
    cfg: { minSendsForGuard: 50, segmentMinSent: 20, variantMinSent: 30, hoursSinceLastRun: 6 },
    ...overrides,
  };
}

function withWindow(kpis: GrowthKpis, sent: number, bounced: number, complained = 0): GrowthKpis {
  kpis.deliverability.window14d = {
    sent,
    delivered: sent - bounced,
    bounced,
    complained,
    bounceRate: kpiMath.rate(bounced, sent),
    complaintRate: kpiMath.rate(complained, sent),
  };
  return kpis;
}

test("adaptation R1: pause, throttle, warn and restore within the base-cap bound", async () => {
  const pause = adaptation.deriveGuardChange(adaptationInput(withWindow(await fixtureKpis({}), 100, 5)))!;
  assert.equal(pause.action, "pause");
  assert.equal(pause.after.cap, 0);
  assert.equal(pause.after.status, "paused");

  const throttle = adaptation.deriveGuardChange(adaptationInput(withWindow(await fixtureKpis({}), 100, 3)))!;
  assert.equal(throttle.action, "throttle");
  assert.equal(throttle.after.cap, 7, "max(5, floor(15/2))");
  assert.equal(throttle.after.status, "throttled");

  const warn = adaptation.deriveGuardChange(adaptationInput(withWindow(await fixtureKpis({}), 100, 2)))!;
  assert.equal(warn.action, "warn");
  assert.equal(warn.after.cap, 15, "a warning never changes the cap");

  const complaint = adaptation.deriveGuardChange(adaptationInput(withWindow(await fixtureKpis({}), 2500, 0, 1)))!;
  assert.equal(complaint.action, "warn", "a single complaint under the throttle rate warns");
  const complaintPause = adaptation.deriveGuardChange(adaptationInput(withWindow(await fixtureKpis({}), 100, 0, 1)))!;
  assert.equal(complaintPause.action, "pause", "1 complaint in 100 sends crosses the 0.08% limit");

  const restore = adaptation.deriveGuardChange(
    adaptationInput(withWindow(await fixtureKpis({}), 100, 0), {
      guard: { status: "throttled", since: daysAgo(7).toISOString(), reason: "r", okDays: 6.5 },
      effectiveCap: 7,
      cfg: { minSendsForGuard: 50, segmentMinSent: 20, variantMinSent: 30, hoursSinceLastRun: 24 },
    }),
  )!;
  assert.equal(restore.action, "restore");
  assert.equal(restore.after.cap, 15);
  assert.equal(restore.after.status, "ok");

  const progress = adaptation.deriveGuardChange(
    adaptationInput(withWindow(await fixtureKpis({}), 100, 0), {
      guard: { status: "throttled", since: daysAgo(2).toISOString(), reason: "r", okDays: 1 },
      effectiveCap: 7,
    }),
  )!;
  assert.equal(progress.action, "clear");
  assert.equal(progress.after.cap, 7, "the cap never rises above the base and never before 7 clean days");
  assert.equal(progress.after.okDays, 1.25);

  assert.equal(adaptation.deriveGuardChange(adaptationInput(withWindow(await fixtureKpis({}), 30, 5))), null, "below GROWTH_GUARD_MIN_SENDS nothing fires");
  assert.equal(
    adaptation.deriveGuardChange(adaptationInput(withWindow(await fixtureKpis({}), 100, 0), { guard: { status: "paused", since: null, reason: "op", okDays: 0 }, effectiveCap: 0 })),
    null,
    "a paused guard is operator-only",
  );
});

test("adaptation R2: segment guidance prioritizes the best three and pauses dead segments, bounded", async () => {
  const kpis = await fixtureKpis({});
  kpis.outbound.bySegment = [
    makeSegment({ segment: "Austin, TX", sent: 40, positiveReplied: 6, signups: 1 }),
    makeSegment({ segment: "Hill Country", sent: 30, positiveReplied: 3 }),
    makeSegment({ segment: "Dallas, TX", sent: 20, positiveReplied: 1 }),
    makeSegment({ segment: "Houston, TX", sent: 22, positiveReplied: 1 }),
    makeSegment({ segment: "Waco, TX", sent: 35, positiveReplied: 0, signups: 0 }),
    makeSegment({ segment: "Tiny", sent: 5, positiveReplied: 1 }),
  ];
  const input = adaptationInput(kpis);
  const derived = adaptation.deriveSegmentGuidance(input);
  assert.deepEqual(
    derived.prioritize.map((e) => e.segment),
    ["Austin, TX", "Hill Country", "Dallas, TX"],
  );
  assert.deepEqual(derived.pause.map((e) => e.segment), ["Waco, TX"]);
  assert.equal(derived.pause[0]!.until, hoursAfter(NOW, 24 * 60).toISOString());
  assert.ok(derived.pause.length <= Math.floor(5 / 2));

  const changes = adaptation.deriveAdaptations(input);
  const update = changes.find((c) => c.ruleKey === "segment_guidance");
  assert.ok(update, "a differing guidance yields one update change");
  const again = adaptation.deriveAdaptations({ ...input, guidance: derived });
  assert.equal(again.find((c) => c.ruleKey === "segment_guidance"), undefined, "unchanged guidance yields no change entry");

  const normalized = normalizeSegmentGuidance({ prioritize: [{ segmentType: "region", segment: "X", sent: "9" }], pause: "nope", updatedAt: 3 });
  assert.deepEqual(normalized, { prioritize: [{ segmentType: "region", segment: "X", sent: 9, positiveReplyRate: null, signupRate: null }], pause: [], updatedAt: null });
});

test("adaptation R3: variant reweight and pause keep the control safe and at least two active", async () => {
  const kpis = await fixtureKpis({});
  kpis.outbound.byVariant = [
    makeVariantStat({ variantKey: "tours_to_bookings", isControl: true, sent: 40, delivered: 35, positiveReplied: 7 }),
    makeVariantStat({ variantKey: "see_it_in_24h", sent: 40, delivered: 30, positiveReplied: 1 }),
    makeVariantStat({ variantKey: "couple_in_the_room", sent: 40, delivered: 30, positiveReplied: 5 }),
    makeVariantStat({ variantKey: "open_dates", sent: 10, delivered: 9, positiveReplied: 0 }),
  ];
  const changes = adaptation.deriveVariantChanges(adaptationInput(kpis));
  const paused = changes.find((c) => c.subjectId === "see_it_in_24h")!;
  assert.equal(paused.action, "pause");
  assert.equal(paused.after.active, false);
  assert.match(paused.reason, /paused by rule R3/);
  assert.equal(changes.find((c) => c.subjectId === "tours_to_bookings" && c.action === "pause"), undefined, "control is never paused");
  assert.equal(changes.find((c) => c.subjectId === "open_dates"), undefined, "below variantMinSent keeps its weight");
  const reweighted = changes.find((c) => c.subjectId === "couple_in_the_room")!;
  assert.equal(reweighted.action, "reweight");
  const controlWeight = changes.find((c) => c.subjectId === "tours_to_bookings")?.after.weight ?? 0.4;
  const activeWeights = [controlWeight, reweighted.after.weight];
  assert.ok(controlWeight / activeWeights.reduce((a, b) => a + b, 0) >= 0.2 - 1e-6, "control keeps >= 20% of the active weight");

  // Only two active rows: pausing would leave one, so the pause is skipped.
  const twoActive = [makeVariant({ key: "tours_to_bookings" }), makeVariant({ key: "see_it_in_24h" }), makeVariant({ key: "couple_in_the_room", active: false }), makeVariant({ key: "open_dates", active: false })];
  const kept = adaptation.deriveVariantChanges(adaptationInput(kpis, { variants: twoActive }));
  assert.equal(kept.find((c) => c.action === "pause"), undefined);

  const normalized = variants.normalizeControlShare([
    { key: "c", isControl: true, active: true, weight: 0.1 },
    { key: "a", isControl: false, active: true, weight: 0.5 },
    { key: "b", isControl: false, active: true, weight: 0.5 },
  ]);
  const total = normalized.reduce((acc, v) => acc + v.weight, 0);
  assert.ok(0.1 / total >= 0.2 - 1e-6);
});

test("adaptation R4: step cap drops to 2 when step-3 complaints run hot", async () => {
  const kpis = await fixtureKpis({});
  kpis.outbound.byStep = [
    { step: 1, sent: 30, delivered: 29, replied: 2, complained: 1, complaintRate: kpiMath.rate(1, 30) },
    { step: 3, sent: 25, delivered: 24, replied: 0, complained: 3, complaintRate: kpiMath.rate(3, 25) },
  ];
  const reduce = adaptation.deriveStepCapChange(adaptationInput(kpis))!;
  assert.equal(reduce.action, "reduce");
  assert.deepEqual([reduce.before.steps, reduce.after.steps], [3, 2]);
  assert.equal(adaptation.deriveStepCapChange(adaptationInput(kpis, { stepCap: 2 })), null);
  kpis.outbound.byStep[1] = { step: 3, sent: 10, delivered: 10, replied: 0, complained: 3, complaintRate: 0.3 };
  assert.equal(adaptation.deriveStepCapChange(adaptationInput(kpis)), null, "needs 20 sends on both steps");
});

/* ————— 22. variant choice ————— */

test("chooseVariant is weighted and deterministic with an injected random", () => {
  const rows = [makeVariant({ key: "tours_to_bookings", weight: 0.5 }), makeVariant({ key: "open_dates", weight: 0.5 }), makeVariant({ key: "see_it_in_24h", weight: 0.9, active: false })];
  assert.equal(variants.chooseVariant(rows, () => 0.74)!.key, "open_dates");
  assert.equal(variants.chooseVariant(rows, () => 0.1)!.key, "tours_to_bookings");
  for (let i = 0; i < 20; i += 1) {
    assert.notEqual(variants.chooseVariant(rows, () => i / 20)!.key, "see_it_in_24h", "inactive rows are never chosen");
  }
  assert.equal(variants.chooseVariant([]), null);
  assert.equal(variants.VARIANT_DEFAULTS.filter((v) => v.isControl).length, 1);
});

/* ————— 23. classifier ————— */

test("classifyVenueType and normalizeRegion", () => {
  assert.equal(classifyVenueType({ name: "Oak Hollow Barn" }), "barn_farm");
  assert.equal(classifyVenueType({ name: "The Grand Hotel" }), "hotel_resort");
  assert.equal(classifyVenueType({ name: "Studio 12", facts: { style: "industrial loft" } }), "urban_loft");
  assert.equal(classifyVenueType({ name: "Smith Events" }), "other");
  assert.equal(classifyVenueType({ name: "Barnaby Hall" }), "historic", "whole-word match: 'barnaby' is not a barn");
  assert.equal(normalizeRegion(" hill   country "), "Hill Country");
  assert.equal(normalizeRegion(null), "Unknown");
});

/* ————— 24. attribution matcher ————— */

test("attribution matchProspect: email, website host, corporate domain, never free mail", () => {
  const signup = {
    organizationId: 1,
    venueId: 2,
    ownerEmail: "Events@OakHollow.com",
    contactEmail: null,
    websiteUrl: "https://www.oakhollow.com/weddings",
    orgContactEmail: "owner@gmail.com",
  };
  assert.equal(attribution.matchProspect({ email: "events@oakhollow.com", website: null }, signup), "email");
  assert.equal(attribution.matchProspect({ email: "hello@other.com", website: "oakhollow.com" }, signup), "website_domain");
  assert.equal(attribution.matchProspect({ email: "sales@oakhollow.com", website: null }, signup), "email_domain");
  assert.equal(attribution.matchProspect({ email: "someone@gmail.com", website: null }, { ...signup, ownerEmail: "owner@gmail.com" }), null, "free-mail domains never match");
  assert.equal(attribution.matchProspect({ email: "x@y.com", website: "https://z.com" }, signup), null);
  assert.equal(attribution.normalizeHost("HTTP://WWW.Example.com/path?q=1"), "example.com");
  assert.equal(attribution.normalizeHost("not a url"), null);
  assert.equal(attribution.emailDomain("a@b"), null);
});

/* ————— 25. trial transitions ————— */

test("trialTransitions: expiry first, one nudge per sweep, no repeats, trial plan only", () => {
  const cfg = { nudgeGalleryCount: 3, nudgeDaysBeforeEnd: 4, trialDays: 14 };
  const base: import("./trialClock.js").TrialOrgState = {
    id: 1,
    plan: "trial",
    createdAt: daysAgo(5),
    trialEndsAt: hoursAfter(NOW, 24 * 9),
    trialExpiredAt: null,
    creditsBalance: 2,
    readySessions: 0,
    firstGalleryAt: null,
    sentTemplates: [],
  };
  assert.deepEqual(
    trialClock.trialTransitions({ ...base, trialEndsAt: daysAgo(1) }, NOW, cfg).map((t) => [t.kind, t.template]),
    [
      ["expire", undefined],
      ["nudge", "trial_expired"],
    ],
  );
  assert.deepEqual(trialClock.trialTransitions({ ...base, readySessions: 3 }, NOW, cfg).map((t) => t.template), ["trial_gallery_3"]);
  assert.deepEqual(
    trialClock.trialTransitions({ ...base, creditsBalance: 0, readySessions: 5, trialEndsAt: hoursAfter(NOW, 24 * 2) }, NOW, cfg).map((t) => t.template),
    ["trial_credits_out"],
    "credits-out wins and no day-10 nudge in the same sweep",
  );
  assert.deepEqual(trialClock.trialTransitions({ ...base, trialEndsAt: hoursAfter(NOW, 24 * 2) }, NOW, cfg).map((t) => t.template), ["trial_day_10"]);
  assert.deepEqual(trialClock.trialTransitions({ ...base, readySessions: 3, sentTemplates: ["trial_gallery_3"] }, NOW, cfg), []);
  assert.deepEqual(trialClock.trialTransitions({ ...base, plan: "payg", trialEndsAt: daysAgo(1) }, NOW, cfg), []);
  assert.deepEqual(
    trialClock.trialTransitions({ ...base, trialEndsAt: null, createdAt: daysAgo(15) }, NOW, cfg).map((t) => t.kind),
    ["expire", "nudge"],
    "null trial_ends_at falls back to createdAt + trialDays",
  );
});

/* ————— 26. lifecycle templates ————— */

test("renderLifecycleEmail: plain words, computed numbers, no hype", () => {
  const ctx = { orgName: "Oak Hollow LLC", venueName: "Oak Hollow", creditsBalance: 2, trialEndsAt: "2026-10-22T00:00:00Z", galleriesReady: 3, firstGalleryShareUrl: null };
  for (const template of lifecycle.LIFECYCLE_TEMPLATES) {
    const rendered = lifecycle.renderLifecycleEmail(template, ctx);
    assert.ok(rendered.subject.length > 0 && rendered.subject.length <= 78, `${template} subject length`);
    assert.ok(rendered.paragraphs.length >= 2 && rendered.paragraphs.length <= 3, `${template} paragraph count`);
    assert.match(rendered.cta.href, /^https:\/\//);
    const text = `${rendered.subject} ${rendered.paragraphs.join(" ")}`;
    assert.ok(!text.includes("!"), `${template} has no exclamation marks`);
    for (const banned of BANNED_PHRASES) assert.ok(!text.toLowerCase().includes(banned), `${template} avoids "${banned}"`);
    assert.ok(!/seen/.test(text), `${template} never says "seen"`);
    const message = lifecycle.renderLifecycleMessage(template, ctx);
    assert.ok(message.html.includes(rendered.cta.href) && message.text.includes(rendered.cta.href));
  }
  const gallery3 = lifecycle.renderLifecycleEmail("trial_gallery_3", ctx);
  assert.match(gallery3.subject, /3 galleries made at Oak Hollow/);
  assert.match(gallery3.paragraphs[2]!, /25 galleries a month/);
  const noGallery = lifecycle.renderLifecycleEmail("trial_day_10", { ...ctx, galleriesReady: 0 });
  assert.match(noGallery.subject, /first gallery/);
  assert.match(lifecycle.renderLifecycleEmail("trial_day_10", ctx).subject, /ends Oct 22/);
  assert.match(lifecycle.renderLifecycleEmail("trial_credits_out", ctx).subject, /all 5 trial galleries/);
  assert.equal(lifecycle.renderLifecycleEmail("trial_expired", { ...ctx, venueName: null }).paragraphs[0], "Hi there — the free trial for your venue ended on Oct 22.");
});

/* ————— 27. trial state ————— */

test("trialState / canSpendCredits", () => {
  const expired = { plan: "trial", creditsBalance: 3, trialEndsAt: daysAgo(1), createdAt: daysAgo(20) };
  assert.equal(trial.trialState(expired, NOW).expired, true);
  assert.deepEqual(trial.canSpendCredits(expired, 1, NOW), { ok: false, reason: "trial_expired" });
  const broke = { plan: "trial", creditsBalance: 0, trialEndsAt: hoursAfter(NOW, 48), createdAt: daysAgo(2) };
  assert.deepEqual(trial.canSpendCredits(broke, 1, NOW), { ok: false, reason: "insufficient_credits" });
  const payg = { plan: "payg", creditsBalance: 4, trialEndsAt: daysAgo(10), createdAt: daysAgo(40) };
  assert.equal(trial.trialState(payg, NOW).expired, false);
  assert.deepEqual(trial.canSpendCredits(payg, 1, NOW), { ok: true });
  const legacy = { plan: "trial", creditsBalance: 2, trialEndsAt: null, createdAt: daysAgo(10) };
  assert.equal(trial.trialState(legacy, NOW, 14).endsAt, hoursAfter(daysAgo(10), 24 * 14).toISOString());
  assert.equal(trial.trialState(legacy, NOW, 14).daysLeft, 4);
});

/* ————— 28-30. digest ————— */

function experimentRow(overrides: Partial<ControlExperimentRow> & { id: number; name: string }): ControlExperimentRow {
  return {
    hypothesis: "h",
    metric: "m",
    variants: null,
    status: "running",
    result: null,
    createdByAgent: "growth",
    startedAt: daysAgo(5),
    endedAt: null,
    primaryMetricKey: "outbound.positive_reply_rate",
    baseline: 0.05,
    minDetectableLift: 0.5,
    killThreshold: null,
    decisionDate: hoursAfter(NOW, 24 * 3),
    segment: null,
    variantKey: null,
    assignments: null,
    decision: null,
    decidedBy: null,
    decidedAt: null,
    observedValue: null,
    observedN: null,
    evaluation: null,
    createdAt: daysAgo(6),
    updatedAt: daysAgo(1),
    ...overrides,
  };
}

async function digestFixture(): Promise<ReturnType<typeof digest.buildDigest>> {
  const previous = await fixtureKpis({
    orgs: [makeOrg({ id: 1, firstVenueAt: daysAgo(20), photosReadyAt: daysAgo(19) }), makeOrg({ id: 2, firstVenueAt: daysAgo(20) })],
  });
  const current = await fixtureKpis({
    orgs: [
      makeOrg({ id: 1, firstVenueAt: daysAgo(20), photosReadyAt: daysAgo(19), firstGalleryAt: daysAgo(18) }),
      makeOrg({ id: 2, firstVenueAt: daysAgo(20) }),
      makeOrg({ id: 3, createdAt: daysAgo(2) }),
    ],
  });
  current.outbound.bySegment = [makeSegment({ segment: "Austin, TX", sent: 40, positiveReplied: 4, guidance: "prioritize" }), makeSegment({ segment: "<script>alert(1)</script>", sent: 35, positiveReplied: 0, guidance: "pause" })];
  current.deliverability.status = "throttled";
  current.deliverability.window14d = { sent: 100, delivered: 97, bounced: 3, complained: 0, bounceRate: 0.03, complaintRate: 0 };
  current.deliverability.guard = { status: "throttled", since: NOW.toISOString(), reason: "r1", baseCap: 15, effectiveCap: 7 };
  previous.deliverability.window14d = { sent: 80, delivered: 79, bounced: 1, complained: 0, bounceRate: 0.0125, complaintRate: 0 };
  const adaptations: ControlAdaptationRow[] = [
    { id: 1, ruleKey: "variant_weights", subjectType: "variant", subjectId: "open_dates", action: "pause", before: null, after: null, reason: "paused by rule R3", snapshotId: 4, createdAt: daysAgo(2) },
  ];
  return digest.buildDigest({
    current,
    previous,
    base: { capturedAt: NOW.toISOString(), organizations: { total: 3, byPlan: {}, totalCreditsBalance: 0, lowCreditCount: 0, paidCount: 0 }, venues: { total: 2, new7d: 0, new30d: 0, withMedia: 1, withSessions: 1, unadoptedLegacy: 0, activationRate: 50 }, sessions: { total: 1, byStatus: {}, created7d: 0, created30d: 1, ready7d: 0, failed7d: 0, failureRate7d: 0, avgCompletionMinutes7d: null }, credits: { granted30d: 0, consumed30d: 1, refunded30d: 0, purchased30d: 0, grantsByReason30d: {} }, assets: { generated7d: 0 } },
    experiments: [experimentRow({ id: 7, name: "Austin first touch" })],
    adaptations,
    pendingApprovals: 7,
    agingApprovals: 2,
    weekStart: kpiMath.mondayOf(NOW),
    now: NOW,
  });
}

test("buildDigest: deltas, tones and deterministic recommendations", async () => {
  const doc = await digestFixture();
  const firstGallery = doc.kpis.find((k) => k.key === "activation.first_gallery_rate")!;
  assert.equal(firstGallery.tone, "good");
  assert.equal(firstGallery.value, "50%");
  assert.equal(firstGallery.previous, "0%");
  assert.equal(firstGallery.delta, "+50.0 pts");
  const bounce = doc.kpis.find((k) => k.key === "outbound.bounce_rate_14d")!;
  assert.equal(bounce.tone, "bad");
  const signups = doc.kpis.find((k) => k.key === "signups.orgs7d")!;
  assert.equal(signups.value, "1");
  assert.equal(signups.delta, "+1");

  const kinds = doc.recommendations.map((r) => r.kind);
  assert.ok(doc.recommendations.some((r) => r.kind === "scale" && /Austin, TX/.test(r.text)));
  assert.ok(doc.recommendations.some((r) => r.kind === "kill" && /open_dates/.test(r.text)));
  assert.ok(doc.recommendations.some((r) => r.kind === "fix" && /Deliverability is throttled/.test(r.text)));
  assert.ok(doc.recommendations.some((r) => r.kind === "fix" && /7 items, 2 older than 3 days/.test(r.text)));
  assert.ok(doc.recommendations.some((r) => r.kind === "watch" && /Experiment #7/.test(r.text)));
  assert.ok(kinds.indexOf("scale") < kinds.indexOf("watch"));
  assert.equal(doc.experiments.due[0]!.id, 7);
  assert.equal(doc.pendingApprovals, 7);
  assert.equal(doc.adaptations.length, 1);
});

test("renderDigestHtml escapes markup and renderDigestText lists every KPI row", async () => {
  const doc = await digestFixture();
  const html = digest.renderDigestHtml(doc);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Open the Growth tab"));
  const text = digest.renderDigestText(doc);
  for (const row of doc.kpis) assert.ok(text.includes(row.label), `text digest includes ${row.label}`);
  assert.ok(text.includes("/control#growth"));
});

test("digest headline is deterministic and the narrative stays null", async () => {
  const doc = await digestFixture();
  assert.match(doc.headline, /^Week of \w{3} \d{1,2}: \d+ signups, (\d+(\.\d+)?%|—) reach a first gallery, \d+ paid$/);
  assert.equal(doc.headline, "Week of Oct 5: 1 signups, 50% reach a first gallery, 0 paid");
  assert.equal(doc.narrative, null);
  assert.equal(digest.formatPercent(null), "—");
  assert.equal(digest.formatMoney(53700), "$537");
  assert.equal(digest.formatHours(60), "2.5 d");
  assert.equal(digest.formatDelta("rate", 0), "±0");
});

/* ————— 31. alias-qualified SQL ————— */

test("list_organizations and list_venues SQL is alias-qualified (production ambiguous-column fix)", () => {
  const orgSql = listOrganizationsQuery(10).toSQL().sql;
  assert.match(orgSql, /v\.id = cs\.venue_id/);
  assert.match(orgSql, /v\.organization_id = "organizations"\."id"/);
  assert.doesNotMatch(orgSql, /"id" = "venue_id"|"venue_id" = "id"/);
  for (const sort of ["newest", "least_active"] as const) {
    const venueSql = listVenuesQuery(10, sort).toSQL().sql;
    assert.match(venueSql, /vm\.venue_id = "venues"\."id"/);
    assert.match(venueSql, /cs\.venue_id = "venues"\."id"/);
    assert.doesNotMatch(venueSql, /"id" = "venue_id"|"venue_id" = "id"/);
  }
  assert.match(listVenuesQuery(10, "least_active").toSQL().sql, /cs2\.venue_id = "venues"\."id"\) asc/);
});

/* ————— 32. governed actions ————— */

test("actions: lifecycle, digest and nudge emails are governed low-risk actions with strict schemas", async () => {
  for (const type of ["send_lifecycle_email", "send_operator_digest", "send_operator_nudge"]) {
    const action = ACTION_CATALOG[type]!;
    assert.ok(action, `${type} exists`);
    assert.equal(action.riskLevel, "low");
    assert.equal(typeof action.requiresApproval, "function");
  }
  const schema = growthActions.sendLifecycleEmailSchema;
  const context = { orgName: "Oak", venueName: null, creditsBalance: 1, trialEndsAt: null, galleriesReady: 0, firstGalleryShareUrl: null };
  assert.equal(schema.safeParse({ organizationId: 1, template: "trial_day_10", context }).success, true);
  assert.equal(schema.safeParse({ organizationId: 1, template: "made_up", context }).success, false);
  assert.equal(schema.safeParse({ organizationId: 1, template: "trial_day_10", context, extra: true }).success, false);
  assert.equal(schema.safeParse({ organizationId: 1, template: "trial_day_10", context: { ...context, firstGalleryShareUrl: "not a url" } }).success, false);
  assert.equal(growthActions.sendOperatorDigestSchema.safeParse({ digestId: 0 }).success, false);
  assert.equal(computeRequiresApproval({ riskLevel: "low" }, true, true), true, "a policy override keeps a low-risk action in the queue");
  assert.equal(computeRequiresApproval({ riskLevel: "low" }, true, false), false);
  assert.equal(computeRequiresApproval({ riskLevel: "high" }, true, false), true);
  const nudge = growthActions.renderOperatorNudge({
    kind: "aging_approvals",
    pendingCount: 3,
    oldestHours: 72,
    failedRuns24h: 1,
    items: [{ id: 9, actionType: "send_outreach_email", title: "<b>Draft</b>", agentKey: "outreach", ageHours: 72 }],
  });
  assert.match(nudge.subject, /3 approvals waiting in \/control \(oldest 3 days\)/);
  assert.ok(nudge.html.includes("&lt;b&gt;Draft&lt;/b&gt;"));
  assert.ok(nudge.text.includes("/control#approvals"));
});

/* ————— 33. agents ————— */

test("agents: growth agent registered, experiments retired, growth tools granted", () => {
  assert.ok(AGENT_KEYS.includes("growth"));
  assert.ok(!AGENT_KEYS.includes("experiments"));
  for (const agent of AGENT_DEFINITIONS) {
    for (const tool of agent.tools) assert.ok(TOOL_NAMES.includes(tool), `${agent.key} grants "${tool}"`);
  }
  const byKey = new Map(AGENT_DEFINITIONS.map((a) => [a.key, a]));
  for (const key of ["prospecting", "outreach", "campaigns"]) {
    assert.ok(byKey.get(key)!.tools.includes("get_growth_guidance"), `${key} reads growth guidance`);
  }
  assert.ok(byKey.get("finance")!.tools.includes("get_growth_kpis"));
  assert.ok(byKey.get("growth")!.tools.includes("evaluate_experiment"));
  assert.deepEqual(byKey.get("growth")!.actions, [], "the growth agent proposes nothing; code adapts");
  assert.equal(byKey.get("growth")!.domain, "growth");
});

/* ————— 34. metric keys listed for agents ————— */

test("create_experiment declaration lists every metric key with unit and direction", () => {
  const description = growthTools.create_experiment!.declaration.description;
  for (const key of Object.keys(METRIC_KEYS)) assert.ok(description.includes(key), `description names ${key}`);
  assert.ok(description.includes(describeMetricKeys()));
  const params = growthTools.create_experiment!.declaration.parameters as { properties: Record<string, { enum?: string[] }>; required: string[] };
  assert.deepEqual(params.properties.primaryMetricKey!.enum, Object.keys(METRIC_KEYS));
  assert.deepEqual(params.required, ["name", "hypothesis", "metric", "primaryMetricKey", "minDetectableLift", "decisionDate"]);
  for (const name of ["get_growth_kpis", "get_growth_guidance", "evaluate_experiment", "list_experiments", "update_experiment"]) {
    assert.ok(growthTools[name], `growth tool ${name}`);
    assert.ok(TOOL_NAMES.includes(name));
  }
});

/* ————— experiment card validation (shared by tool and route) ————— */

test("experiment scope validation refuses unknown keys, bad segments and double scopes", () => {
  assert.doesNotThrow(() => experiments.validateScope("outbound.positive_reply_rate", "region:Austin", null));
  assert.throws(() => experiments.validateScope("made.up", null, null), /Unknown primaryMetricKey/);
  assert.throws(() => experiments.validateScope("outbound.positive_reply_rate", "campaign:3", null), /segment must look like/);
  assert.throws(() => experiments.validateScope("activation.first_gallery_rate", "region:Austin", null), /cannot be scoped to a segment/);
  assert.throws(() => experiments.validateScope("outbound.paid_rate", null, "open_dates"), /cannot be scoped to a copy variant/);
  assert.throws(() => experiments.validateScope("outbound.reply_rate", "region:Austin", "open_dates"), /not both/);
  assert.equal(experiments.targetFor(0.05, 0.5, "higher"), 0.075);
  assert.equal(experiments.targetFor(0.04, 0.25, "lower"), 0.03);
  assert.equal(experiments.targetFor(null, 0.25, "lower"), null);
});

/* ————— governance helpers (scheduler / runner) ————— */

test("governance: drain delay, retired-action cleanup set, kill switches, backoff, retention window", () => {
  assert.equal(governance.drainCutoff(NOW).toISOString(), "2026-10-08T11:58:00.000Z");
  assert.deepEqual(governance.retiredActionTypes({ a: { type: "a", retired: true }, b: { type: "b" }, c: { type: "c", retired: false } }), ["a"]);
  assert.equal(governance.RETIREMENT_NOTE, "superseded by outreach studio");
  assert.equal(governance.RETIREMENT_ACTOR, "system:retirement");

  assert.deepEqual(governance.shouldStartAgentRuns({ agentsEnabled: false, spentTodayUsd: 0, capUsd: 25 }), { ok: false, reason: "agents_disabled" });
  assert.deepEqual(governance.shouldStartAgentRuns({ agentsEnabled: true, spentTodayUsd: 25, capUsd: 25 }), { ok: false, reason: "ai_budget_exhausted" });
  assert.deepEqual(governance.shouldStartAgentRuns({ agentsEnabled: true, spentTodayUsd: 24.99, capUsd: 25 }), { ok: true });
  assert.deepEqual(governance.shouldStartAgentRuns({ agentsEnabled: true, spentTodayUsd: 999, capUsd: 0 }), { ok: true }, "cap 0 disables the budget check");
  assert.equal(governance.estimateRunCostUsd(1_000_000, 100_000, { inputPerMillion: 3, outputPerMillion: 15 }), 4.5);

  assert.equal(governance.isRetryableProviderError("Grok request failed (429): slow down"), true);
  assert.equal(governance.isRetryableProviderError("Grok request failed (503): upstream"), true);
  assert.equal(governance.isRetryableProviderError("Grok request failed (400): bad schema"), false);
  assert.equal(governance.isRetryableProviderError("fetch failed"), true);
  assert.equal(governance.isRetryableProviderError("Tool \"x\" is not granted"), false);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(governance.backoffMs), [0, 300_000, 600_000, 1_200_000, 2_400_000, 3_600_000, 3_600_000]);

  assert.equal(governance.retentionDue(new Date("2026-10-08T02:59:00Z"), null), false, "before the nightly hour");
  assert.equal(governance.retentionDue(new Date("2026-10-08T03:00:00Z"), null), true);
  assert.equal(governance.retentionDue(new Date("2026-10-08T15:00:00Z"), "2026-10-08"), false, "already ran today");
  assert.equal(governance.retentionDue(new Date("2026-10-09T03:30:00Z"), "2026-10-08"), true);
});

/* ————— guidance block and briefing ————— */

test("renderGuidanceBlock and composeBriefing inject deterministic guidance into revenue briefings", () => {
  const block = guidance.renderGuidanceBlock({
    guard: { status: "throttled", since: NOW.toISOString(), reason: "bounce 3.0%", okDays: 0 },
    baseCap: 15,
    effectiveCap: 7,
    campaignSteps: 3,
    guidance: {
      prioritize: Array.from({ length: 8 }, (_, i) => ({ segmentType: "region" as const, segment: `Region ${i}`, sent: 40, positiveReplyRate: 0.1 - i * 0.01, signupRate: null })),
      pause: [{ segmentType: "venue_type", segment: "restaurant_club", sent: 35, positiveReplyRate: 0, signupRate: 0, until: "2026-12-07T12:00:00.000Z" }],
      updatedAt: NOW.toISOString(),
    },
  });
  assert.ok(block.startsWith("GROWTH GUIDANCE"));
  assert.match(block, /Deliverability guard: throttled — bounce 3.0%\. Prospect emails allowed today: 7 of base 15\. Campaign step cap: 3\./);
  assert.match(block, /region=Region 0 \(10.0% positive replies on 40\)/);
  assert.match(block, /\+3 more/);
  assert.match(block, /venue_type=restaurant_club until 2026-12-07/);
  assert.ok(block.length <= guidance.GUIDANCE_BLOCK_MAX_CHARS);
  assert.ok(guidance.GUIDANCE_AGENT_KEYS.includes("prospecting") && !guidance.GUIDANCE_AGENT_KEYS.includes("support"));

  const empty = guidance.renderGuidanceBlock({ guard: OK_GUARD, baseCap: 15, effectiveCap: 15, guidance: { ...EMPTY_SEGMENT_GUIDANCE } });
  assert.match(empty, /Prioritize segments: none yet \(insufficient data\)\./);
  assert.match(empty, /Stop spending on: none\./);

  const briefing = runner.composeBriefing({
    definition: { key: "outreach", name: "Outreach Agent" },
    now: NOW,
    metrics: { capturedAt: NOW.toISOString() } as never,
    recentRuns: [
      { status: "failed", startedAt: daysAgo(1), finishedAt: daysAgo(1), error: "Grok request failed (503)", summary: null },
      { status: "failed", startedAt: daysAgo(2), finishedAt: daysAgo(2), error: "deadline", summary: null },
      { status: "succeeded", startedAt: daysAgo(3), finishedAt: daysAgo(3), error: null, summary: "Drafted two first touches." },
    ],
    openTasks: [{ id: 1, title: "t", priority: "medium", status: "open" }],
    pendingActions: 2,
    guidanceBlock: block,
  });
  assert.ok(briefing.includes(block));
  assert.match(briefing, /YOUR LAST 3 RUN\(S\), newest first: .*failed \(Grok request failed \(503\)\); .*failed \(deadline\); .*succeeded\./);
  assert.match(briefing, /YOUR PREVIOUS SUCCESSFUL RUN .*REPORTED:\nDrafted two first touches\./);
  assert.match(briefing, /Your last 2 runs failed\. Keep this run short/);
  assert.match(briefing, /2 action proposal\(s\) still awaiting operator approval/);
  const first = runner.composeBriefing({ definition: { key: "support", name: "Support" }, now: NOW, metrics: {} as never, recentRuns: [], openTasks: [], pendingActions: 0, guidanceBlock: null });
  assert.match(first, /This is your first recorded run\./);
  assert.ok(!first.includes("GROWTH GUIDANCE"));
  assert.equal(runner.isRunInProgress(), false);
  assert.equal(runner.providerBackoffRemainingMs(NOW), 0);
});

test("mergeVariantStats keeps registry rows authoritative and reports unassigned stats", () => {
  const rows = [makeVariant({ key: "tours_to_bookings", weight: 0.55, active: true }), makeVariant({ key: "open_dates", active: false, weight: 0.1 })];
  const merged = guidance.mergeVariantStats(rows, [
    makeVariantStat({ variantKey: "tours_to_bookings", sent: 12, delivered: 11, positiveReplied: 2, weight: 0.4, active: true }),
    makeVariantStat({ variantKey: "unassigned", sent: 3 }),
  ]);
  assert.equal(merged.length, 3);
  const control = merged.find((v) => v.variantKey === "tours_to_bookings")!;
  assert.equal(control.weight, 0.55, "registry weight wins over the snapshot");
  assert.equal(control.sent, 12);
  const open = merged.find((v) => v.variantKey === "open_dates")!;
  assert.equal(open.active, false);
  assert.equal(open.sent, 0);
  assert.equal(open.smoothedPositiveReplyRate, 0.5);
  assert.ok(merged.some((v) => v.variantKey === "unassigned"));
});

test("studio hook: campaign step cap rule", () => {
  assert.equal(stepExceedsCap(null, 3), false);
  assert.equal(stepExceedsCap(3, 3), false);
  assert.equal(stepExceedsCap(4, 3), true);
  const err = new CampaignStepCapError(4, 3);
  assert.equal(err.message, "Campaign step 4 exceeds policy max_campaign_steps (3).");
});

test("a rejected lifecycle email is final for that org and template; failures stop after a few attempts", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { sql } = await import("drizzle-orm");
  const query = new PgDialect().sqlToQuery(trialClock.lifecycleTemplatesTakenSql(sql`o.id`));
  assert.match(query.sql, /'executed', 'rejected'\)/);
  assert.match(query.sql, /having count\(\*\) >= \$\d/);
  assert.ok(query.params.includes(trialClock.MAX_LIFECYCLE_FAILED_ATTEMPTS));
});

test("a lifecycle email approved after the org paid, or after its trigger passed, is not sent", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const base = { plan: "trial", firstPaidAt: null, creditsBalance: 0, trialEndsAt: new Date("2026-10-10T00:00:00Z"), createdAt: new Date("2026-09-26T00:00:00Z") };
  assert.equal(growthActions.lifecycleNoLongerApplies("trial_expired", base, now, 14), null);
  assert.match(growthActions.lifecycleNoLongerApplies("trial_expired", { ...base, plan: "starter" }, now, 14) ?? "", /paid/);
  assert.match(growthActions.lifecycleNoLongerApplies("trial_expired", { ...base, firstPaidAt: new Date() }, now, 14) ?? "", /paid/);
  assert.match(growthActions.lifecycleNoLongerApplies("trial_credits_out", { ...base, creditsBalance: 10 }, now, 14) ?? "", /credits again/);
  const active = { ...base, creditsBalance: 3, trialEndsAt: new Date("2026-10-25T00:00:00Z") };
  assert.equal(growthActions.lifecycleNoLongerApplies("trial_day_10", active, now, 14), null);
  assert.match(growthActions.lifecycleNoLongerApplies("trial_expired", active, now, 14) ?? "", /not ended/);
});

test("attribution never matches on a shared social/listing host or ISP mail, nor credits an org that predates the first email", () => {
  const signup = {
    organizationId: 3,
    venueId: 4,
    ownerEmail: "owner@bellsouth.net",
    contactEmail: null,
    websiteUrl: "https://www.facebook.com/OtherVenue",
    orgContactEmail: null,
  };
  assert.equal(attribution.matchProspect({ email: "rose@hall.com", website: "https://facebook.com/RoseHall" }, signup), null);
  assert.equal(attribution.matchProspect({ email: "rose@hall.com", website: "m.facebook.com/RoseHall" }, signup), null);
  assert.equal(attribution.matchProspect({ email: "rose@hall.com", website: "https://www.theknot.com/marketplace/rose" }, { ...signup, websiteUrl: "theknot.com/marketplace/other" }), null);
  assert.equal(attribution.matchProspect({ email: "someone@bellsouth.net", website: null }, signup), null, "ISP mail never matches");
  assert.equal(attribution.matchProspect({ email: "someone@yahoo.co.uk", website: null }, { ...signup, ownerEmail: "x@yahoo.co.uk" }), null);

  const firstContactAt = new Date("2026-09-01T00:00:00Z");
  assert.equal(attribution.isPreexistingCustomer(new Date("2026-08-01T00:00:00Z"), { contactCount: 1, firstContactAt }), true);
  assert.equal(attribution.isPreexistingCustomer(new Date("2026-09-05T00:00:00Z"), { contactCount: 1, firstContactAt }), false);
  assert.equal(attribution.isPreexistingCustomer(new Date("2026-08-01T00:00:00Z"), { contactCount: 0, firstContactAt: null }), false);
});

test("evaluator: a baseline of 0 never declares a win for an unchanged 0", async () => {
  const zero = card({ baseline: 0, decisionDate: daysAgo(1) });
  const evaluation = experiments.evaluateExperiment(zero, { growth: await kpisWithPositiveRate(0, 60) }, NOW, 30);
  assert.equal(evaluation.decision, "inconclusive");
  assert.match(evaluation.reason, /target equals the baseline/);
});

test("evaluator readout is limited to data since the experiment started", async () => {
  const startedAt = daysAgo(7);
  const base = {
    orgs: async () => [{ createdAt: daysAgo(20) }, { createdAt: daysAgo(3) }],
    emails: async (since: Date) => {
      assert.ok(since.getTime() >= startedAt.getTime(), "emails are loaded from the start date on");
      return [
        { createdAt: daysAgo(9), sentAt: daysAgo(8) },
        { createdAt: daysAgo(6), sentAt: daysAgo(5) },
        { createdAt: daysAgo(1), sentAt: null },
      ];
    },
    legacySends: async (since: Date) => (since.getTime() >= startedAt.getTime() ? 0 : 99),
    ledger: async () => [],
    venueCreatedAts: async () => [daysAgo(10), daysAgo(2)],
  } as unknown as import("./kpiTypes.js").GrowthLoaders;
  const scoped = experiments.loadersSince(base, startedAt);
  assert.equal((await scoped.orgs()).length, 1);
  assert.equal((await scoped.emails(daysAgo(30))).length, 2);
  assert.equal(await scoped.legacySends(daysAgo(30)), 0);
  assert.equal((await scoped.venueCreatedAts(daysAgo(30))).length, 1);
});
