import assert from "node:assert/strict";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.APP_BASE_URL ??= "https://studio.test";
delete process.env.XAI_API_KEY;
delete process.env.GOOGLE_PLACES_API_KEY;

const domain = await import("./domain.js");
const checks = await import("./checks.js");
const { computeLegitimacy } = await import("./score.js");
const places = await import("./places.js");
const facts = await import("./facts.js");
const vet = await import("./vet.js");
const fx = await import("./fixtures.js");
const { parseCdx, parseRdap } = await import("./deps.js");
const copywriter = await import("../outreach/copywriter.js");
const template = await import("../outreach/emailTemplate.js");
const studio = await import("../outreach/studio.js");
const { ACTION_CATALOG, describeActionCatalog, computeRequiresApproval } = await import("../actions.js");
const tools = await import("../tools.js");
const { AGENT_DEFINITIONS } = await import("../agents.js");
const { POLICY_DEFAULTS } = await import("../policies.js");
const { shouldPauseOnEvent } = await import("../outreach/sendingHealth.js");
const { checkProspectTransition, VETTING_REQUIRED_FOR_QUALIFY } = await import("../outreach/prospectTransitions.js");

type VettingCheck = import("./types.js").VettingCheck;
type CitableFact = import("./types.js").CitableFact;

const POLICY = { passScore: 60, reviewScore: 40, blockedCountries: ["CA"], ttlDays: 30 };
const DAY = 24 * 60 * 60 * 1000;

function check(key: string, points: number, extra: Partial<VettingCheck> = {}): VettingCheck {
  return { key: key as VettingCheck["key"], outcome: "pass", points, hardFail: false, detail: key, evidence: [], ...extra };
}

/* ————— domain helpers ————— */

test("domain: registrableDomain handles www, subdomains, and co.uk", () => {
  assert.equal(domain.registrableDomain("www.events.willowhouse.co.uk"), "willowhouse.co.uk");
  assert.equal(domain.registrableDomain("Venue.COM"), "venue.com");
  assert.equal(domain.websiteDomain("willowhouseweddings.test/weddings"), "willowhouseweddings.test");
  assert.equal(domain.normalizeWebsiteUrl("www.x.com"), "https://www.x.com/");
  assert.equal(domain.normalizeWebsiteUrl("javascript:alert(1)"), null);
});

test("domain: mailbox classification and phone normalization", () => {
  assert.equal(domain.isDisposable("mailinator.com"), true);
  assert.equal(domain.isFreeMail("gmail.com"), true);
  assert.equal(domain.isRoleMailbox("info"), true);
  assert.equal(domain.isRoleMailbox("events2"), true);
  assert.equal(domain.isRoleMailbox("weddings.team"), true);
  assert.equal(domain.isRoleMailbox("dana"), false);
  assert.equal(domain.mxProvider(["aspmx.l.google.com"]).provider, "google_workspace");
  assert.equal(domain.normalizePhone("(518) 555-0142"), "5185550142");
  assert.equal(domain.normalizePhone("+1 518 555 0142"), "5185550142");
});

/* ————— checks ————— */

test("checks: the real venue fixture passes reachability, TLS, email, NAP, marketplace, social, wedding signal, contact name", () => {
  const site = fx.WILLOW_SITE;
  const reach = checks.checkSiteReachable(site, fx.WILLOW_URL, fx.NOW);
  assert.equal(reach.outcome, "pass");
  assert.equal(reach.points, 5);
  assert.equal(checks.checkNotParked(site, fx.NOW).outcome, "pass");
  const tls = checks.checkTls(fx.TLS_OK, site.finalUrl, fx.NOW);
  assert.equal(tls.outcome, "pass");
  assert.equal(tls.points, 4);
  const published = checks.checkEmailPublished(site, fx.WILLOW_EMAIL, null, fx.NOW);
  assert.equal(published.outcome, "pass");
  assert.equal(published.points, 6);
  assert.equal(published.evidence[0]?.url, fx.WILLOW_URL);
  const nap = checks.checkNap(checks.extractNap(site), fx.WILLOW_PHONE, fx.NOW);
  assert.equal(nap.outcome, "pass");
  assert.equal(nap.points, 12);
  const market = checks.checkMarketplacePresence(site, fx.NOW);
  assert.equal(market.outcome, "pass");
  assert.equal(market.points, 8);
  assert.ok(market.evidence.some((e) => e.url.includes("theknot")));
  const social = checks.checkSocialHandles(site, fx.NOW);
  assert.match(String(social.data?.handles ?? ""), /instagram:willowhouse/);
  const wedding = checks.checkWeddingSignal(site, fx.NOW);
  assert.equal(wedding.outcome, "pass");
  assert.equal(wedding.points, 5);
  const named = checks.checkContactNamePublished(site, "Dana Whitfield", fx.NOW);
  assert.equal(named.outcome, "pass");
  assert.match(named.evidence[0]?.excerpt ?? "", /Owner/);
});

test("checks: parked page, empty shell, unreachable, bot wall, 404, non-html", () => {
  const parked = checks.checkNotParked(fx.siteFromPages([{ url: fx.WILLOW_URL, html: fx.PARKED_HTML }]), fx.NOW);
  assert.equal(parked.outcome, "fail");
  assert.equal(parked.hardFail, true);
  assert.match(parked.evidence[0]?.excerpt ?? "", /for sale/i);
  const shell = checks.checkNotParked(fx.siteFromPages([{ url: fx.WILLOW_URL, html: fx.EMPTY_SHELL_HTML }]), fx.NOW);
  assert.equal(shell.outcome, "warn");

  const unreachable = checks.checkSiteReachable(fx.siteFromPages([], { finalUrl: null, status: null, error: "ENOTFOUND" }), fx.WILLOW_URL, fx.NOW);
  assert.equal(unreachable.outcome, "fail");
  assert.equal(unreachable.hardFail, true);
  const botWall = checks.checkSiteReachable(fx.siteFromPages([], { status: 403, finalUrl: fx.WILLOW_URL }), fx.WILLOW_URL, fx.NOW);
  assert.equal(botWall.outcome, "error");
  assert.equal(botWall.hardFail, false);
  const missing = checks.checkSiteReachable(fx.siteFromPages([], { status: 404, finalUrl: fx.WILLOW_URL }), fx.WILLOW_URL, fx.NOW);
  assert.equal(missing.outcome, "fail");
  assert.equal(missing.hardFail, true);
  const pdf = checks.checkSiteReachable(
    fx.siteFromPages([{ url: fx.WILLOW_URL, html: "" }], { contentType: "application/pdf" }),
    fx.WILLOW_URL,
    fx.NOW,
  );
  assert.equal(pdf.outcome, "fail");
});

test("checks: a redirect to another registrable domain is a warning naming both", () => {
  const moved = fx.siteFromPages([{ url: "https://venuegroup.test/", html: fx.WILLOW_HOME_HTML }], {
    requestedUrl: fx.WILLOW_URL,
    finalUrl: "https://venuegroup.test/",
  });
  const result = checks.checkSiteReachable(moved, fx.WILLOW_URL, fx.NOW);
  assert.equal(result.outcome, "warn");
  assert.equal(result.points, 2);
  assert.match(result.detail, /willowhouseweddings\.test/);
  assert.match(result.detail, /venuegroup\.test/);
});

test("checks: domain age and archive history scoring", () => {
  const old = checks.checkDomainAge(parseRdap(fx.RDAP_OLD, fx.RDAP_URL_OLD), "willowhouseweddings.test", fx.NOW);
  assert.equal(old.points, 15);
  const at = (days: number) => ({ registeredAt: new Date(fx.NOW.getTime() - days * DAY), registrar: null, sourceUrl: fx.RDAP_URL_OLD, error: null });
  assert.equal(checks.checkDomainAge(at(400), "x.test", fx.NOW).points, 10);
  assert.equal(checks.checkDomainAge(at(100), "x.test", fx.NOW).points, 4);
  const fresh = checks.checkDomainAge(parseRdap(fx.RDAP_FRESH, fx.RDAP_URL_OLD), "freshvenue.test", fx.NOW);
  assert.equal(fresh.points, 0);
  assert.equal(fresh.data?.freshDomain, true);
  assert.equal(checks.checkDomainAge({ registeredAt: null, registrar: null, sourceUrl: fx.RDAP_URL_OLD, error: "timeout" }, "x.test", fx.NOW).outcome, "error");

  assert.equal(checks.checkSiteHistory(parseCdx(fx.CDX_OLD, fx.CDX_URL_OLD), fx.NOW).points, 6);
  const empty = checks.checkSiteHistory(parseCdx(fx.CDX_EMPTY, fx.CDX_URL_OLD), fx.NOW);
  assert.equal(empty.outcome, "skip");
  assert.equal(empty.data?.noCaptures, true);
  const errored = checks.checkSiteHistory({ firstCaptureAt: null, sourceUrl: fx.CDX_URL_OLD, error: "HTTP 503" }, fx.NOW);
  assert.equal(errored.outcome, "error");
  assert.notEqual(errored.data?.noCaptures, true);
});

test("checks: MX, SPF and DMARC", () => {
  const mx = checks.checkMx(fx.DNS_WORKSPACE, "willowhouseweddings.test", fx.NOW);
  assert.equal(mx.outcome, "pass");
  assert.equal(mx.points, 10);
  assert.equal(checks.checkSpfDmarc(fx.DNS_WORKSPACE, "willowhouseweddings.test", fx.NOW).points, 6);
  const none = checks.checkMx(fx.DNS_NONE, "willowhouseweddings.test", fx.NOW);
  assert.equal(none.outcome, "fail");
  assert.equal(none.hardFail, true);
  assert.equal(checks.checkMx(fx.DNS_GMAIL, "gmail.com", fx.NOW).points, 5);
  assert.equal(checks.checkSpfDmarc(fx.DNS_GMAIL, "gmail.com", fx.NOW).outcome, "skip");
  const noAuth = checks.checkSpfDmarc(fx.DNS_GODADDY_NO_AUTH, "willowhouseweddings.test", fx.NOW);
  assert.equal(noAuth.outcome, "warn");
  assert.equal(noAuth.points, 0);
});

test("checks: mailbox class and role", () => {
  const named = checks.checkMailboxClass(fx.WILLOW_EMAIL, fx.WILLOW_URL);
  assert.equal(named.outcome, "pass");
  assert.equal(named.points, 8);
  assert.equal(checks.checkMailboxRole(fx.WILLOW_EMAIL).points, 10);
  assert.equal(checks.checkMailboxRole("info@willowhouseweddings.test").points, 5);
  const free = checks.checkMailboxClass("willowhouse@gmail.com", fx.WILLOW_URL);
  assert.equal(free.outcome, "warn");
  assert.equal(free.points, 0);
  const disposable = checks.checkMailboxClass("x@yopmail.com", fx.WILLOW_URL);
  assert.equal(disposable.outcome, "fail");
  assert.equal(disposable.hardFail, true);
  const mismatch = checks.checkMailboxClass("events@othervenue.test", fx.WILLOW_URL);
  assert.equal(mismatch.outcome, "warn");
  assert.match(mismatch.detail, /does not match/);
});

test("checks: a contact name not on the site is a warning and the fact stays unverified", async () => {
  const result = checks.checkContactNamePublished(fx.WILLOW_SITE, "Pat Nobody", fx.NOW);
  assert.equal(result.outcome, "warn");
  assert.equal(result.data?.verified, false);
  const run = await vet.runVetting(
    { ...fx.WILLOW_PROSPECT, contactName: "Pat Nobody" },
    { emailSourceUrl: fx.WILLOW_URL, policy: POLICY, deps: fx.makeDeps() },
  );
  const owner = run.facts.find((fact) => fact.kind === "owner_name" && fact.value === "Pat Nobody");
  assert.ok(owner, "the unverified name is still recorded");
  assert.equal(owner.status, "unverified");
});

test("checks: blocked region from JSON-LD or the typed region", () => {
  const canada = checks.checkBlockedRegion(checks.extractNap(fx.siteFromPages([{ url: fx.WILLOW_URL, html: fx.CANADA_HTML }])), null, ["CA"]);
  assert.equal(canada.outcome, "fail");
  assert.equal(canada.hardFail, true);
  const empty = checks.extractNap(fx.siteFromPages([{ url: fx.WILLOW_URL, html: fx.EMPTY_SHELL_HTML }]));
  assert.equal(checks.checkBlockedRegion(empty, "Toronto, ON", ["CA"]).outcome, "fail");
  assert.equal(checks.checkBlockedRegion(empty, "Hudson, NY", ["CA"]).outcome, "pass");
  assert.equal(checks.checkBlockedRegion(empty, "Portland, ME", ["CA"]).outcome, "pass");
});

/* ————— scoring ————— */

test("score: verdict thresholds, composite fresh-domain rule, error routing", () => {
  const parts = (total: number) => [check("domain_age", Math.min(total, 15)), check("mx_present", Math.max(0, total - 15))];
  assert.equal(computeLegitimacy(parts(78), POLICY).status, "passed");
  assert.equal(computeLegitimacy(parts(52), POLICY).status, "review");
  assert.equal(computeLegitimacy(parts(30), POLICY).status, "failed");
  assert.equal(
    computeLegitimacy([...parts(90), check("site_not_parked", 0, { outcome: "fail", hardFail: true })], POLICY).status,
    "failed",
  );

  const freshDomain = check("domain_age", 0, { outcome: "warn", data: { freshDomain: true } });
  const noHistory = check("site_history", 0, { outcome: "skip", data: { noCaptures: true } });
  const placesSkip = check("places", 0, { outcome: "skip" });
  const filler = check("mx_present", 80);
  assert.ok(computeLegitimacy([freshDomain, noHistory, placesSkip, filler], POLICY).hardFails.includes("domain_age"));
  const historyError = check("site_history", 0, { outcome: "error" });
  assert.ok(!computeLegitimacy([freshDomain, historyError, placesSkip, filler], POLICY).hardFails.includes("domain_age"));
  const placesMatch = check("places", 20, { outcome: "pass" });
  assert.ok(!computeLegitimacy([freshDomain, noHistory, placesMatch, filler], POLICY).hardFails.includes("domain_age"));

  assert.equal(computeLegitimacy([check("site_reachable", 0, { outcome: "error" }), check("mx_present", 70)], POLICY).status, "error");
  const threeErrors = ["domain_age", "site_history", "tls"].map((key) => check(key, 0, { outcome: "error" }));
  assert.equal(computeLegitimacy([...threeErrors, check("mx_present", 70)], POLICY).status, "error");
  // A site behind a bot wall or down: site-derived checks score 0, so the
  // low score is an outage, not a verdict (never "failed" without a hard fail).
  assert.equal(
    computeLegitimacy([check("site_reachable", 0, { outcome: "error" }), check("domain_age", 15), check("mx_present", 21)], POLICY).status,
    "error",
  );
  assert.equal(
    computeLegitimacy(
      [check("site_reachable", 0, { outcome: "error" }), check("site_not_parked", 0, { outcome: "fail", hardFail: true })],
      POLICY,
    ).status,
    "failed",
    "a real hard fail still wins over an outage",
  );

  const passed = computeLegitimacy(
    [check("mx_present", 10, { data: { mxProvider: "google_workspace", freeMail: false } }), check("domain_age", 68)],
    POLICY,
  );
  assert.match(passed.summary, /^Passed 78\/100:/);
  assert.match(passed.summary, /Workspace/);
});

/* ————— Tier B: Google Places ————— */

test("places: match rules, closed business, skip when disabled", async () => {
  const fetchJson = (json: unknown) => async () => ({ status: 200, json });
  const input = { name: "Willow House", region: "Hudson, NY", location: "Hudson, NY", websiteDomain: "willowhouseweddings.test" };
  const matched = await places.searchPlace(input, { fetchJson: fetchJson(fx.PLACES_MATCH), apiKey: "k", now: fx.NOW });
  assert.ok(matched.match);
  const passed = places.checkPlaces(matched, "willowhouseweddings.test", fx.NOW);
  assert.equal(passed.outcome, "pass");
  assert.equal(passed.points, 20);
  const rating = places.placesFact(matched.match);
  assert.equal(rating?.kind, "google_rating");
  assert.match(rating?.value ?? "", /4\.8 \(143 reviews\)/);
  assert.match(rating?.sourceUrl ?? "", /google\.com\/maps/);

  const noWebsite = { places: [{ ...fx.PLACES_MATCH.places[0]!, websiteUri: undefined }] };
  const byName = await places.searchPlace(input, { fetchJson: fetchJson(noWebsite), apiKey: "k", now: fx.NOW });
  assert.ok(byName.match, "name + city match when the listing has no website");

  const closed = await places.searchPlace(input, { fetchJson: fetchJson(fx.PLACES_CLOSED), apiKey: "k", now: fx.NOW });
  const closedCheck = places.checkPlaces(closed, "willowhouseweddings.test", fx.NOW);
  assert.equal(closedCheck.outcome, "fail");
  assert.equal(closedCheck.hardFail, true);

  const skipped = places.checkPlaces(null, null, fx.NOW, "daily Places cap reached (30)");
  assert.equal(skipped.outcome, "skip");
  assert.match(skipped.detail, /cap/);
  assert.equal(places.placesEnabled(), false);
});

/* ————— orchestration ————— */

test("runVetting: the real fixture passes and emits sourced facts with timestamps", async () => {
  const result = await vet.runVetting(fx.WILLOW_PROSPECT, { emailSourceUrl: fx.WILLOW_URL, policy: POLICY, deps: fx.makeDeps() });
  assert.equal(result.status, "passed", result.summary);
  assert.ok(result.score >= 60);
  assert.equal(result.tier, "A");
  const has = (kind: string, value?: string | RegExp) =>
    result.facts.some((fact) => fact.kind === kind && (value === undefined || (typeof value === "string" ? fact.value === value : value.test(fact.value))));
  assert.ok(result.facts.some((fact) => fact.kind === "phone" && fact.sourceKind === "json_ld"));
  assert.ok(has("address"));
  assert.ok(has("marketplace", "The Knot"));
  assert.ok(has("social", "instagram:willowhouse"));
  assert.ok(result.facts.some((fact) => fact.kind === "email" && fact.status === "verified"));
  assert.ok(result.facts.some((fact) => fact.kind === "owner_name" && fact.value === "Dana Whitfield" && fact.status === "verified"));
  for (const item of result.checks) {
    for (const evidence of item.evidence) assert.equal(evidence.observedAt, fx.NOW.toISOString());
  }

  const flaky = await vet.runVetting(fx.WILLOW_PROSPECT, {
    emailSourceUrl: fx.WILLOW_URL,
    policy: POLICY,
    deps: fx.makeDeps({ rdap: async () => { throw new Error("rdap down"); } }),
  });
  assert.equal(flaky.checks.find((c) => c.key === "domain_age")?.outcome, "error");
});

test("runVetting: hard fails on no MX, disposable, parked, Canada; network errors never throw", async () => {
  const noMx = await vet.runVetting(fx.WILLOW_PROSPECT, { emailSourceUrl: null, policy: POLICY, deps: fx.makeDeps({ resolveDns: async () => fx.DNS_NONE }) });
  assert.equal(noMx.status, "failed");
  assert.ok(noMx.hardFails.includes("mx_present"));

  const disposable = await vet.runVetting({ ...fx.WILLOW_PROSPECT, email: "x@yopmail.com" }, { emailSourceUrl: null, policy: POLICY, deps: fx.makeDeps() });
  assert.equal(disposable.status, "failed");
  assert.ok(disposable.hardFails.includes("mailbox_class"));

  const parked = await vet.runVetting(fx.WILLOW_PROSPECT, {
    emailSourceUrl: null,
    policy: POLICY,
    deps: fx.makeDeps({ fetchSite: async () => fx.siteFromPages([{ url: fx.WILLOW_URL, html: fx.PARKED_HTML }]) }),
  });
  assert.equal(parked.status, "failed");
  assert.ok(parked.hardFails.includes("site_not_parked"));

  const canada = await vet.runVetting(
    { ...fx.WILLOW_PROSPECT, region: "Toronto, ON" },
    { emailSourceUrl: null, policy: POLICY, deps: fx.makeDeps({ fetchSite: async () => fx.siteFromPages([{ url: fx.WILLOW_URL, html: fx.CANADA_HTML }]) }) },
  );
  assert.equal(canada.status, "failed");
  assert.ok(canada.hardFails.includes("blocked_region"));

  const offline = await vet.runVetting(fx.WILLOW_PROSPECT, {
    emailSourceUrl: null,
    policy: POLICY,
    deps: fx.makeDeps({ fetchSite: async () => { throw new Error("ECONNRESET"); } }),
  });
  assert.equal(offline.checks.find((c) => c.key === "site_reachable")?.outcome, "error");
  assert.equal(offline.status, "error");

  const malformed = await vet.runVetting({ ...fx.WILLOW_PROSPECT, email: "not-an-email" }, { emailSourceUrl: null, policy: POLICY, deps: fx.makeDeps() });
  assert.equal(malformed.status, "failed");
  assert.ok(malformed.hardFails.includes("mx_present"));

  const noWebsite = await vet.runVetting({ ...fx.WILLOW_PROSPECT, website: null }, { emailSourceUrl: null, policy: POLICY, deps: fx.makeDeps() });
  assert.equal(noWebsite.status, "failed", "a prospect without a website can never pass");
});

/* ————— the gate ————— */

test("gate: assertVettingAllowsOutreach and vettingIsFresh", () => {
  const future = new Date(fx.NOW.getTime() + 10 * DAY);
  const row = (status: string, expiresAt = future) => ({ status, score: 50, summary: "s", expiresAt });
  const reason = (fn: () => void): string | null => {
    try {
      fn();
      return null;
    } catch (err) {
      return (err as InstanceType<typeof vet.VettingGateError>).reason;
    }
  };
  assert.throws(() => vet.assertVettingAllowsOutreach(null, 7, fx.NOW), /has not been vetted/);
  assert.equal(reason(() => vet.assertVettingAllowsOutreach(null, 7, fx.NOW)), "unvetted");
  assert.throws(() => vet.assertVettingAllowsOutreach(row("failed"), 7, fx.NOW), /may not be emailed/);
  assert.equal(reason(() => vet.assertVettingAllowsOutreach(row("review"), 7, fx.NOW)), "review");
  assert.equal(reason(() => vet.assertVettingAllowsOutreach(row("error"), 7, fx.NOW)), "error");
  assert.equal(reason(() => vet.assertVettingAllowsOutreach(row("passed", new Date(fx.NOW.getTime() - DAY)), 7, fx.NOW)), "expired");
  assert.doesNotThrow(() => vet.assertVettingAllowsOutreach(row("passed"), 7, fx.NOW));
  assert.equal(vet.vettingIsFresh({ status: "passed", expiresAt: future }, fx.NOW), true);
  assert.equal(vet.vettingIsFresh({ status: "error", expiresAt: future }, fx.NOW), false);
  assert.equal(vet.isOperatorOverride({ vettedBy: "override:ops@dreemer.co" }), true);
  assert.equal(vet.isOperatorOverride({ vettedBy: "system:vetting" }), false);
  assert.deepEqual(vet.parseBlockedCountries("ca, us,xyz"), ["CA", "US"]);
});

/* ————— facts ————— */

test("facts: attributeFacts finds the page and excerpt for each research fact", () => {
  const pages = [
    { url: fx.WILLOW_URL, text: fx.WILLOW_SITE.pages[0]!.text },
    { url: fx.WILLOW_CONTACT_URL, text: fx.WILLOW_SITE.pages[1]!.text },
  ];
  const attributed = facts.attributeFacts(
    { name: "Willow House", location: "Hudson, NY", spaces: ["The Barn", "The Garden Terrace", "The Rose Garden"], style: null, capacity: 180, summary: null },
    pages,
  );
  const barn = attributed.find((fact) => fact.kind === "space" && fact.value === "The Barn");
  assert.equal(barn?.status, "verified");
  assert.equal(barn?.sourceUrl, fx.WILLOW_URL);
  assert.match(barn?.excerpt ?? "", /barn/i);
  assert.equal(attributed.find((fact) => fact.value === "The Garden Terrace")?.status, "verified");
  assert.equal(attributed.find((fact) => fact.kind === "location")?.status, "verified");
  assert.equal(attributed.find((fact) => fact.kind === "capacity")?.status, "verified");
  assert.equal(attributed.find((fact) => fact.value === "The Rose Garden")?.status, "unverified");
  assert.deepEqual(facts.attributeFacts({ name: "x", location: null, spaces: ["The Barn"], style: null, capacity: null, summary: null }, []), []);
});

test("facts: citableFacts and citedFactsIn", () => {
  const rows = [
    { kind: "location", value: "Hudson, NY", sourceUrl: fx.WILLOW_URL, status: "verified" },
    { kind: "space", value: "The Barn", sourceUrl: fx.WILLOW_URL, status: "verified" },
    { kind: "space", value: "The Barn", sourceUrl: fx.WILLOW_CONTACT_URL, status: "verified" },
    { kind: "space", value: "The Chapel", sourceUrl: fx.WILLOW_URL, status: "unverified" },
    { kind: "phone", value: "5185550142", sourceUrl: fx.WILLOW_URL, status: "verified" },
    { kind: "capacity", value: "180", sourceUrl: fx.WILLOW_URL, status: "verified" },
    { kind: "owner_name", value: "Dana Whitfield", sourceUrl: fx.WILLOW_URL, status: "verified" },
  ];
  const citable = facts.citableFacts(rows);
  assert.deepEqual(citable.map((fact) => fact.kind), ["owner_name", "space", "location", "capacity"], "verified citable kinds only, deduped, ordered");
  const cited = facts.citedFactsIn({ greeting: "Hi there,", body: "We loved the barn and the river light in Hudson." }, citable);
  assert.deepEqual(cited.map((fact) => fact.kind).sort(), ["location", "space"]);
  assert.equal(facts.citedFactsIn({ greeting: "Hi Dana,", body: "x" }, citable)[0]?.kind, "owner_name");
  assert.equal(facts.citedFactsIn({ greeting: "Hi,", body: "Room for 180 guests." }, citable)[0]?.kind, "capacity");
  assert.equal(facts.citedFactsIn({ greeting: "Hi,", body: "Room for 1800 guests." }, citable).length, 0);
});

/* ————— copy ————— */

const BARN: CitableFact = { kind: "space", value: "The Barn", sourceUrl: fx.WILLOW_URL };
const TERRACE: CitableFact = { kind: "space", value: "The Garden Terrace", sourceUrl: fx.WILLOW_URL };
const HUDSON: CitableFact = { kind: "location", value: "Hudson, NY", sourceUrl: fx.WILLOW_URL };
const CAPACITY: CitableFact = { kind: "capacity", value: "180", sourceUrl: fx.WILLOW_URL };
const OWNER: CitableFact = { kind: "owner_name", value: "Dana Whitfield", sourceUrl: fx.WILLOW_URL };

function copyInput(verifiedFacts: CitableFact[], overrides: Partial<import("../outreach/copywriter.js").CopyInput> = {}) {
  const owner = verifiedFacts.find((fact) => fact.kind === "owner_name")?.value ?? null;
  return {
    facts: { name: "Willow House", location: "Hudson, NY", spaces: ["The Barn", "The Garden Terrace"], style: null, capacity: 180, summary: null },
    verifiedFacts,
    prospectName: "Willow House",
    contactName: owner,
    ask: "preview" as const,
    contactCount: 0,
    stepGuidance: null,
    senderFirstName: "Sam",
    ...overrides,
  };
}

test("copy: two verified facts required, invented spaces rejected, ordinary prose allowed, fallback cites two in every pairing", () => {
  const one = copyInput([BARN, HUDSON]);
  const draft = copywriter.fallbackCopy(one);
  const thin = copywriter.validateCopy({ ...draft, body: "I came across Willow House and The Barn. I work at Dreemer. ".repeat(4) }, copyInput([BARN, HUDSON]));
  assert.ok(thin.some((v) => /cites only 1/.test(v)), thin.join("; "));
  const invented = copywriter.validateCopy(
    { ...draft, body: `${draft.body} The Rose Garden would be lovely too.` },
    copyInput([BARN, TERRACE, HUDSON]),
  );
  assert.ok(invented.some((v) => /not in the verified facts/.test(v)), invented.join("; "));
  const prose = copywriter.validateCopy({ ...draft, body: `${draft.body.split("\n\n")[0]} Garden parties are common.\n\n${draft.body.split("\n\n").slice(1).join("\n\n")}` }, one);
  assert.ok(!prose.some((v) => /not in the verified facts/.test(v)), prose.join("; "));

  const pairings: CitableFact[][] = [
    [BARN, HUDSON],
    [BARN, OWNER],
    [HUDSON, OWNER],
    [HUDSON, CAPACITY],
    [CAPACITY, OWNER],
    [BARN, TERRACE],
  ];
  for (const pairing of pairings) {
    const input = copyInput(pairing);
    const fallback = copywriter.fallbackCopy(input);
    const label = pairing.map((fact) => fact.kind).join("+");
    assert.deepEqual(copywriter.validateCopy(fallback, input), [], label);
    assert.ok(facts.citedFactsIn(fallback, pairing).length >= 2, label);
    assert.ok(copywriter.countWords(fallback.body) <= 120, label);
  }
});

test("copy: the greeting is generic unless the owner name is verified; role names never greet", async () => {
  const anonymous = await copywriter.writeCopy(copyInput([BARN, HUDSON]));
  assert.equal(anonymous.greeting, "Hi there,");
  const named = await copywriter.writeCopy(copyInput([OWNER, BARN, HUDSON]));
  assert.equal(named.greeting, "Hi Dana,");
  assert.ok(named.notes.citedFacts.length >= 2);
  assert.equal(copywriter.firstName("Events Team"), null);
  assert.equal(copywriter.firstName("Front Desk"), null);
  assert.equal(copywriter.isRoleName("Sales"), true);
  assert.equal(copywriter.isRoleName("Dana Whitfield"), false);
});

/* ————— template ————— */

test("template: the footer says why the venue receives the note; a custom why-line is escaped", () => {
  const base = {
    subject: "s",
    greeting: "Hi there,",
    paragraphs: ["Body."],
    signOffLines: ["Sam"],
    ctaLabel: "Go",
    ctaUrl: "https://dreemer.co",
    images: [],
    venueName: "Willow House",
    unsubscribeUrl: "https://studio.test/api/outreach/unsubscribe/tok",
    postalAddress: "Dreemer · 1 Main St · Hudson, NY 12534",
  };
  const rendered = template.renderOutreachEmail(base);
  for (const body of [rendered.html, rendered.text]) {
    assert.match(body, /publicly lists this address for event inquiries/);
    assert.match(body, /[Uu]nsubscribe/);
    assert.match(body, /at most three times/);
  }
  const custom = template.renderOutreachEmail({ ...base, whyLine: "Because <b>you</b> asked." });
  assert.match(custom.html, /Because &lt;b&gt;you&lt;\/b&gt; asked\./);
  assert.ok(!/publicly lists this address/.test(custom.text));
});

/* ————— deliverability guard, actions, agents, policies ————— */

test("sendingHealth: shouldPauseOnEvent is pure and correct", () => {
  const health = (sent: number, bounced: number, complained: number) => ({
    windowDays: 14,
    sent,
    bounced,
    complained,
    bounceRatePct: sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0,
  });
  assert.match(shouldPauseOnEvent(health(25, 0, 1), "complained") ?? "", /complaint/);
  assert.ok(shouldPauseOnEvent(health(25, 2, 0), "bounced"));
  assert.equal(shouldPauseOnEvent(health(25, 1, 0), "bounced"), null);
  assert.equal(shouldPauseOnEvent(health(100, 2, 0), "bounced"), null);
  assert.equal(shouldPauseOnEvent(health(0, 0, 0), "complained"), null);
});

test("actions: send_prospect_email and resume_agent are retired; proposing them is impossible", async () => {
  const legacy = ACTION_CATALOG.send_prospect_email!;
  assert.equal(legacy.retired, true);
  assert.equal(legacy.riskLevel, "high");
  await assert.rejects(legacy.execute({ prospectId: 1, subject: "abc", message: "x".repeat(20) }), /retired/);
  assert.equal(ACTION_CATALOG.resume_agent?.retired, true);
  const described = describeActionCatalog();
  assert.equal(described.find((entry) => entry.type === "send_prospect_email")?.retired, true);
  const declaration = tools.toolDeclarations(["propose_action"])[0]!;
  const enumValues = (declaration.parameters as { properties: { actionType: { enum: string[] } } }).properties.actionType.enum;
  assert.ok(!enumValues.includes("send_prospect_email"));
  assert.ok(!enumValues.includes("resume_agent"));
  assert.ok(!/send_prospect_email \(legacy/.test(JSON.stringify(declaration)));
  assert.equal(computeRequiresApproval({ riskLevel: "high" }, true, false), true);
  assert.equal(computeRequiresApproval({ riskLevel: "low" }, true, false), false);
});

test("tools: propose_action is narrowed to each agent's allowlist", () => {
  for (const agent of AGENT_DEFINITIONS) {
    if (!agent.tools.includes("propose_action")) continue;
    const declaration = tools.toolDeclarations(["propose_action"], agent.key)[0]!;
    const enumValues = (declaration.parameters as { properties: { actionType: { enum: string[] } } }).properties.actionType.enum;
    if (agent.actions !== undefined) {
      for (const value of enumValues) assert.ok(agent.actions.includes(value), `${agent.key} may not see ${value}`);
    }
    assert.ok(!enumValues.includes("send_prospect_email"));
  }
  assert.deepEqual(tools.proposableActionTypesFor(null), tools.proposableActionTypesFor(undefined));
});

test("tools: upsert_prospect facts carry sources; invalid entries are reported, not thrown", () => {
  const { facts: recorded, rejectedFacts } = tools.agentFacts({
    email: fx.WILLOW_EMAIL,
    emailSourceUrl: fx.WILLOW_CONTACT_URL,
    contactName: "Dana Whitfield",
    contactNameSourceUrl: fx.WILLOW_URL,
    facts: [
      { kind: "space", value: "The Barn", sourceUrl: fx.WILLOW_URL },
      { kind: "phone", value: "555", sourceUrl: fx.WILLOW_URL },
      { kind: "capacity", value: "180", sourceUrl: "not a url" },
    ],
  });
  assert.deepEqual(
    recorded.map((fact) => `${fact.kind}:${fact.status}:${fact.sourceKind}`),
    ["email:unverified:agent_research", "owner_name:unverified:agent_research", "space:unverified:agent_research"],
  );
  assert.equal(rejectedFacts.length, 2);
  const declaration = tools.toolDeclarations(["upsert_prospect"])[0]!;
  assert.match(JSON.stringify(declaration), /emailSourceUrl/);
});

test("agents: prompts and grants reference vetting", () => {
  const byKey = new Map(AGENT_DEFINITIONS.map((agent) => [agent.key, agent]));
  assert.match(byKey.get("prospecting")!.mission, /Pass emailSourceUrl to upsert_prospect every time/);
  assert.match(byKey.get("outreach")!.mission, /never propose send_prospect_email/);
  assert.match(byKey.get("governance")!.mission, /byVettingStatus/);
  for (const key of ["prospecting", "outreach", "governance"]) {
    assert.ok(byKey.get(key)!.tools.includes("vet_prospect"), `${key} has vet_prospect`);
  }
  assert.ok(tools.TOOL_NAMES.includes("vet_prospect"));
});

test("policies: vetting and deliverability defaults exist with sane values", () => {
  const byKey = new Map(POLICY_DEFAULTS.map((policy) => [policy.key, policy.value]));
  assert.deepEqual(byKey.get("vetting_pass_score"), { score: 60 });
  assert.deepEqual(byKey.get("vetting_review_score"), { score: 40 });
  assert.deepEqual(byKey.get("vetting_blocked_countries"), { codes: "CA" });
  assert.deepEqual(byKey.get("outreach_require_reply_to"), { enabled: true });
  assert.deepEqual(byKey.get("max_prospect_emails_per_day_base"), { emails: 15 });
  assert.equal((byKey.get("deliverability_guard") as { status: string }).status, "ok");
});

/* ————— studio and pipeline rules ————— */

test("pipeline: transitions follow the table, qualify needs a passed vetting, unsubscribe always wins", () => {
  assert.deepEqual(checkProspectTransition({ from: "new", to: "qualified", vettingStatus: "passed" }), { ok: true, noop: false });
  const unvetted = checkProspectTransition({ from: "new", to: "qualified", vettingStatus: "unvetted" });
  assert.equal(unvetted.ok, false);
  assert.equal(!unvetted.ok && unvetted.error, VETTING_REQUIRED_FOR_QUALIFY);
  assert.equal(checkProspectTransition({ from: "disqualified", to: "qualified", vettingStatus: "review" }).ok, false);
  assert.equal(checkProspectTransition({ from: "unsubscribed", to: "qualified", vettingStatus: "passed" }).ok, false);
  assert.equal(checkProspectTransition({ from: "converted", to: "unsubscribed", vettingStatus: "passed" }).ok, false);
  assert.equal(checkProspectTransition({ from: "disqualified", to: "unsubscribed", vettingStatus: "failed" }).ok, true);
  assert.equal(checkProspectTransition({ from: "contacted", to: "replied", vettingStatus: "passed" }).ok, true);
  assert.deepEqual(checkProspectTransition({ from: "replied", to: "replied", vettingStatus: "passed" }), { ok: true, noop: true });
});

test("studio: approvable only when vetting, facts, guard and compliance config all allow a send", () => {
  const future = new Date(fx.NOW.getTime() + 10 * DAY);
  const readiness = {
    postalPlaceholder: false,
    replyTo: "sam@dreemer.co",
    sandboxSender: false,
    sendsEnabled: true,
    requireReplyTo: true,
    guard: { status: "ok" as const, since: null, reason: null, okDays: 0 },
  };
  const base = { editable: true, vetting: { status: "passed", expiresAt: future }, citedFacts: 2, readiness, now: fx.NOW };
  assert.equal(studio.computeApprovable(base), true);
  assert.equal(studio.computeApprovable({ ...base, editable: false }), false);
  assert.equal(studio.computeApprovable({ ...base, vetting: { status: "review", expiresAt: future } }), false);
  assert.equal(studio.computeApprovable({ ...base, vetting: { status: "passed", expiresAt: new Date(fx.NOW.getTime() - DAY) } }), false);
  assert.equal(studio.computeApprovable({ ...base, citedFacts: 1 }), false);
  assert.equal(studio.computeApprovable({ ...base, readiness: { ...readiness, postalPlaceholder: true } }), false);
  assert.equal(studio.computeApprovable({ ...base, readiness: { ...readiness, replyTo: null } }), false);
  assert.equal(studio.computeApprovable({ ...base, readiness: { ...readiness, sandboxSender: true } }), false);
  assert.equal(studio.computeApprovable({ ...base, readiness: { ...readiness, sendsEnabled: false } }), false);
  assert.equal(studio.computeApprovable({ ...base, readiness: { ...readiness, guard: { ...readiness.guard, status: "paused" } } }), false);

  assert.match(studio.vettingWarningsFor(null)[0] ?? "", /has not run/);
  assert.match(studio.vettingWarningsFor({ status: "review", score: 48, expiresAt: future, summary: "s" }, fx.NOW)[0] ?? "", /48\/100/);
  assert.match(
    studio.vettingWarningsFor({ status: "passed", score: 80, expiresAt: new Date(fx.NOW.getTime() - 2 * DAY), summary: "s" }, fx.NOW)[0] ?? "",
    /expired 2 days ago/,
  );
  const warnings = studio.configWarningsFor({
    ...readiness,
    postalPlaceholder: true,
    resendConfigured: false,
    replyTo: "owner@gmail.com",
    replyToFreeMail: true,
    guard: { status: "paused", since: null, reason: "1 spam complaint", okDays: 0 },
  });
  assert.ok(warnings.some((w) => /OUTREACH_POSTAL_ADDRESS/.test(w)));
  assert.ok(warnings.some((w) => /free-mail/.test(w)));
  assert.ok(warnings.some((w) => /paused by the deliverability guard: 1 spam complaint/.test(w)));
});
