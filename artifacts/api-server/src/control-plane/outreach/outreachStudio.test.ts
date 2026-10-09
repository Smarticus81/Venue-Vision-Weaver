import { BRAND_COLORS } from "@workspace/brand";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.APP_BASE_URL ??= "https://studio.test";
delete process.env.XAI_API_KEY;

const research = await import("./venueResearch.js");
const template = await import("./emailTemplate.js");
const copywriter = await import("./copywriter.js");
const guards = await import("./contactGuards.js");
const sender = await import("./sender.js");
const grok = await import("../grok.js");
const { ACTION_CATALOG } = await import("../actions.js");
const { AGENT_DEFINITIONS } = await import("../agents.js");

type Deps = import("./venueResearch.js").ResearchDeps;
type EmailRow = import("@workspace/db").ControlOutreachEmail;
type ProspectRow = import("@workspace/db").ControlProspect;
type AssetRow = import("@workspace/db").ControlProspectAsset;

const HOME = "https://www.willowhouseweddings.test/";

function homepage(options: { withImages: boolean }): string {
  const images = options.withImages
    ? `<meta property="og:image" content="/images/og-garden.jpg" />
       <img class="hero" src="/images/hero-barn.jpg" alt="The Barn at golden hour" width="1600" height="900" />
       <img src="/images/logo.png" alt="Willow House logo" />
       <img src="/images/gallery/terrace.jpg" srcset="/images/gallery/terrace-800.jpg 800w, /images/gallery/terrace-1600.jpg 1600w" alt="Garden Terrace reception" />
       <img src="/images/gallery/tiny.jpg" alt="thumb" width="120" height="80" />
       <img src="/images/gallery/duplicate-of-hero.jpg" alt="" />`
    : `<img src="/images/logo.png" alt="Willow House logo" />
       <img src="/images/icons/arrow.svg" alt="" />`;
  return `<!doctype html><html><head><title>Willow House | Weddings in Hudson, NY</title>
    <meta name="description" content="A restored 1850s farmhouse and barn on 40 acres along the Hudson." />
    <meta property="og:site_name" content="Willow House" />
    ${images}
    <script type="application/ld+json">{"@type":"EventVenue","name":"Willow House","address":{"addressLocality":"Hudson","addressRegion":"NY"}}</script>
    </head><body>
    <h1>Weddings at Willow House</h1>
    <h2>The Barn</h2><p>Seats up to 180 guests for dinner and dancing.</p>
    <h2>The Garden Terrace</h2><p>Ceremonies under the pergola.</p>
    <a href="/weddings">Weddings</a><a href="https://instagram.com/x">IG</a>
    </body></html>`;
}

function stubDeps(options: { withImages: boolean; dims?: Record<string, [number, number]> }): Deps & {
  stored: string[];
  downloads: string[];
} {
  const stored: string[] = [];
  const downloads: string[] = [];
  const dims = options.dims ?? {};
  return {
    stored,
    downloads,
    async fetchPage(url) {
      if (url === HOME) return { finalUrl: HOME, html: homepage(options) };
      if (url === `${HOME}weddings`) {
        return {
          finalUrl: `${HOME}weddings`,
          html: options.withImages
            ? `<html><body><h1>Weddings</h1><img src="/images/gallery/chapel.jpg" alt="The Chapel" width="1400" height="900" /></body></html>`
            : `<html><body><h1>Weddings</h1><p>Call us.</p></body></html>`,
        };
      }
      return null;
    },
    async fetchBinary(url) {
      downloads.push(url);
      return { buffer: Buffer.from(url), contentType: "image/jpeg" };
    },
    async processImage(buffer) {
      const url = buffer.toString();
      const [width, height] = dims[url] ?? [1600, 1000];
      // Duplicate-of-hero shares the hero's hash; everything else hashes by url.
      const hash = url.includes("duplicate-of-hero")
        ? "ff00ff00ff00ff00"
        : url.includes("hero-barn")
          ? "ff00ff00ff00ff00"
          : createHash("sha1").update(url).digest("hex").slice(0, 16);
      return { width, height, buffer, contentType: "image/jpeg", hash };
    },
    async store(path) {
      stored.push(path);
      return `/public-objects/${path}`;
    },
  };
}

test("research: picks real venue photos, records sources, skips logos/tiny/duplicates", async () => {
  const deps = stubDeps({
    withImages: true,
    dims: { "https://www.willowhouseweddings.test/images/gallery/tiny.jpg": [120, 80] },
  });
  const result = await research.researchVenue(
    { prospectId: 7, name: "Willow House", website: HOME, region: null },
    deps,
  );
  assert.equal(result.status, "ok");
  assert.ok(result.sourceUrls.includes(HOME));
  assert.ok(result.sourceUrls.includes(`${HOME}weddings`), "crawls the weddings subpage");
  assert.ok(result.images.length >= 3 && result.images.length <= 6);
  assert.equal(result.images.filter((image) => image.selected).length, 3, "top three are preselected");
  for (const image of result.images) {
    assert.match(image.sourceUrl, /^https:\/\/www\.willowhouseweddings\.test\//);
    assert.ok(image.pageUrl.startsWith(HOME));
    assert.match(image.objectKey, /^\/public-objects\/outreach\/7\//);
    assert.ok(image.altText.length > 0);
  }
  assert.ok(!deps.downloads.some((url) => /logo|\.svg/.test(url)), "logos and svgs are never downloaded");
  assert.ok(!result.images.some((image) => image.sourceUrl.includes("tiny.jpg")), "small images are dropped");
  assert.ok(!result.images.some((image) => image.sourceUrl.includes("duplicate-of-hero")), "near-duplicates are dropped");
  // An og:image named like a share card ("og-...") is kept but no longer outranks the hero photo.
  assert.equal(result.images[0]!.sourceUrl, `${HOME}images/hero-barn.jpg`, "the hero photo ranks first");
  assert.ok(result.images.some((image) => image.sourceUrl.endsWith("og-garden.jpg")), "the og:image is still a candidate");
  assert.equal(research.looksLikeShareCard("https://venue.test/img/og-share-card.png"), true);
  assert.equal(research.looksLikeShareCard("https://venue.test/img/barn-at-dusk.jpg"), false);
  assert.ok(result.images.some((image) => image.sourceUrl.endsWith("terrace-1600.jpg")), "largest srcset entry wins");

  assert.equal(result.facts.name, "Willow House");
  assert.equal(result.facts.location, "Hudson, NY");
  assert.equal(result.facts.capacity, 180);
  assert.ok(result.facts.spaces.some((space) => /barn/i.test(space)));
  assert.ok(result.facts.spaces.some((space) => /garden terrace/i.test(space)));
});

test("research: falls back gracefully and flags the operator when no usable images exist", async () => {
  const deps = stubDeps({ withImages: false });
  const result = await research.researchVenue(
    { prospectId: 8, name: "Willow House", website: HOME, region: "Hudson Valley" },
    deps,
  );
  assert.equal(result.status, "no_images");
  assert.deepEqual(result.images, []);
  assert.deepEqual(deps.stored, []);
  assert.match(result.warnings[0] ?? "", /No usable venue photos/);
  assert.equal(result.facts.capacity, 180, "facts still extracted without images");

  // The email still renders as a clean text-only note.
  const rendered = template.renderOutreachEmail({
    subject: "A preview of weddings at Willow House",
    greeting: "Hi there,",
    paragraphs: ["First paragraph.", "Second paragraph."],
    signOffLines: ["Thanks,", "Sam at Dreemer"],
    ctaLabel: "Ask for a free preview",
    ctaUrl: "mailto:sam@dreemer.co",
    images: [],
    venueName: "Willow House",
    unsubscribeUrl: "https://studio.test/api/outreach/unsubscribe/tok",
    postalAddress: "Dreemer · 1 Main St · Hudson, NY 12534",
  });
  assert.ok(!/<img/.test(rendered.html), "no broken image slots");
  assert.match(rendered.html, /First paragraph\./);
});

test("research: unreachable or missing websites fail soft with a warning", async () => {
  const deps = stubDeps({ withImages: true });
  const down = await research.researchVenue({ prospectId: 9, name: "Ghost Venue", website: "https://down.test/", region: null }, deps);
  assert.equal(down.status, "fetch_failed");
  assert.match(down.warnings[0] ?? "", /Could not load down\.test/);
  const none = await research.researchVenue({ prospectId: 9, name: "Ghost Venue", website: null, region: null }, deps);
  assert.equal(none.status, "fetch_failed");
  assert.deepEqual(none.images, []);
});

test("research: refuses private and loopback hosts (SSRF guard)", async () => {
  for (const host of ["localhost", "127.0.0.1", "10.0.0.8", "192.168.1.1", "169.254.169.254", "[::1]", "metadata.internal"]) {
    assert.equal(research.hostLooksPrivate(host), true, host);
  }
  assert.equal(research.hostLooksPrivate("www.example.com"), false);
  await assert.rejects(research.assertPublicUrl("http://127.0.0.1/admin"), /private/);
  await assert.rejects(research.assertPublicUrl("ftp://example.com/x"), /non-http/);
});

test("template: responsive, dark-mode aware, escaped, with plain text and alt text", () => {
  const rendered = template.renderOutreachEmail({
    subject: "Weddings at The Barn <test>",
    greeting: "Hi Dana,",
    paragraphs: ["I came across The Barn. <script>alert(1)</script>", "Second paragraph.", "Third."],
    signOffLines: ["Thanks,", "Sam at Dreemer"],
    ctaLabel: "Ask for a free preview",
    ctaUrl: "javascript:alert(1)",
    images: [
      { url: "https://studio.test/api/storage/public-objects/outreach/1/a.jpg", alt: "The Barn at golden hour", width: 1200, height: 750, sourceHost: "thebarn.test" },
      { url: "https://studio.test/api/storage/public-objects/outreach/1/b.jpg", alt: "Garden Terrace", width: 1200, height: 800, sourceHost: "thebarn.test" },
      { url: "https://studio.test/api/storage/public-objects/outreach/1/c.jpg", alt: "The Chapel", width: 1200, height: 900, sourceHost: "thebarn.test" },
      { url: "https://studio.test/api/storage/public-objects/outreach/1/d.jpg", alt: "Fourth", width: 1200, height: 900, sourceHost: "thebarn.test" },
    ],
    venueName: "The Barn",
    unsubscribeUrl: "https://studio.test/api/outreach/unsubscribe/tok123",
    postalAddress: "Dreemer · 1 Main St · Hudson, NY 12534",
  });
  assert.equal((rendered.html.match(/<img /g) ?? []).length, 3, "at most three images");
  assert.match(rendered.html, /alt="The Barn at golden hour"/);
  assert.match(rendered.html, /Photo: thebarn\.test/);
  assert.match(rendered.html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(rendered.html, /\[data-ogsc\]/);
  assert.match(rendered.html, /@media screen and \(max-width: 620px\)/);
  assert.match(rendered.html, /<!--\[if mso\]>/);
  assert.match(rendered.html, /name="color-scheme" content="light dark"/);
  assert.ok(!rendered.html.includes("<script>alert(1)</script>"), "body is escaped");
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.ok(!rendered.html.includes('href="javascript:'), "unsafe CTA link is neutralised");
  assert.match(rendered.html, /href="https:\/\/studio\.test\/api\/outreach\/unsubscribe\/tok123"/);
  assert.match(rendered.html, /Dreemer · 1 Main St · Hudson, NY 12534/);
  assert.match(rendered.text, /Unsubscribe here[^\n]*https:\/\/studio\.test\/api\/outreach\/unsubscribe\/tok123/);
  assert.match(rendered.html, /publicly lists this address for event inquiries/);
  assert.match(rendered.text, /publicly lists this address for event inquiries/);
  assert.ok(!/this one note/.test(rendered.text), "the footer no longer claims a single note");
  assert.equal(rendered.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click", "headers are built by the renderer");
  assert.match(rendered.text, /Dreemer · 1 Main St/);
  assert.match(rendered.text, /^Hi Dana,/);

  const dark = template.renderOutreachEmail({
    subject: "s",
    greeting: "Hi,",
    paragraphs: ["Body."],
    signOffLines: ["Sam"],
    ctaLabel: "Go",
    ctaUrl: "https://dreemer.co",
    images: [],
    venueName: "V",
    unsubscribeUrl: "https://studio.test/u/t",
    postalAddress: "addr",
    forceScheme: "dark",
  });
  assert.match(
    dark.html,
    new RegExp(`background-color:${BRAND_COLORS.dark.canvas}`, "i"),
    "forced dark preview paints the dark canvas",
  );
});

test("unsubscribe: RFC 8058 headers are attached and one-click is advertised", () => {
  const headers = template.buildListUnsubscribeHeaders("https://studio.test/api/outreach/unsubscribe/tok", null);
  assert.equal(headers["List-Unsubscribe"], "<https://studio.test/api/outreach/unsubscribe/tok>");
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const withMailbox = template.buildListUnsubscribeHeaders("https://studio.test/u/tok", "unsubscribe@dreemer.co");
  assert.match(withMailbox["List-Unsubscribe"]!, /^<https:\/\/studio\.test\/u\/tok>, <mailto:unsubscribe@dreemer\.co\?subject=unsubscribe>$/);
});

const policy = { maxContacts: 3, minGapHours: 72 };
const baseProspect = {
  id: 1,
  email: "owner@venue.test",
  status: "qualified",
  contactCount: 0,
  lastContactedAt: null as Date | null,
};

test("suppression and consent: suppressed, opted-out, capped, and too-soon prospects are refused", () => {
  const ok = { suppressed: false, existingCustomerSlug: null };
  assert.doesNotThrow(() => guards.assertProspectContactable(baseProspect, policy, ok));
  assert.throws(() => guards.assertProspectContactable(baseProspect, policy, { ...ok, suppressed: true }), /suppression list/);
  assert.throws(() => guards.assertProspectContactable({ ...baseProspect, status: "unsubscribed" }, policy, ok), /may not be emailed/);
  assert.throws(() => guards.assertProspectContactable({ ...baseProspect, status: "replied" }, policy, ok), /may not be emailed/);
  assert.throws(() => guards.assertProspectContactable({ ...baseProspect, contactCount: 3 }, policy, ok), /3\/3 emails/);
  const now = new Date("2026-10-03T12:00:00Z");
  assert.throws(
    () =>
      guards.assertProspectContactable(
        { ...baseProspect, status: "contacted", contactCount: 1, lastContactedAt: new Date("2026-10-02T12:00:00Z") },
        policy,
        ok,
        now,
      ),
    /72h gap/,
  );
  assert.doesNotThrow(() =>
    guards.assertProspectContactable(
      { ...baseProspect, status: "contacted", contactCount: 1, lastContactedAt: new Date("2026-09-20T12:00:00Z") },
      policy,
      ok,
      now,
    ),
  );
  assert.throws(() => guards.assertProspectContactable(baseProspect, policy, { ...ok, existingCustomerSlug: "willow" }), /already owns venue/);
});

type VettingRow = import("@workspace/db").ControlProspectVetting;
type FactRow = import("@workspace/db").ControlProspectFact;

const SEND_NOW = new Date("2026-10-03T12:00:00Z");

function vettingRow(overrides: Partial<VettingRow> = {}): VettingRow {
  return {
    id: 1,
    prospectId: 1,
    status: "passed",
    score: 82,
    tier: "A",
    hardFails: [],
    checks: [],
    summary: "Passed 82/100: 9-year-old domain, Workspace mail.",
    contactDomain: "venue.test",
    mxProvider: "google_workspace",
    domainRegisteredAt: null,
    firstCaptureAt: null,
    placesPlaceId: null,
    vettedAt: new Date("2026-10-01T12:00:00Z"),
    expiresAt: new Date("2026-10-31T12:00:00Z"),
    vettedBy: "system:vetting",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as VettingRow;
}

function factRow(id: number, kind: string, value: string, status = "verified"): FactRow {
  return {
    id,
    prospectId: 1,
    kind,
    value,
    sourceUrl: "https://willow.test/",
    sourceKind: "website",
    excerpt: null,
    status,
    verifiedAt: new Date(),
    createdBy: "system:vetting",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as FactRow;
}

const WILLOW_FACTS = [factRow(1, "space", "The Barn"), factRow(2, "location", "Hudson, NY"), factRow(3, "space", "Garden Terrace")];

interface SendWorldOverrides {
  actionStatus?: string | null;
  actionId?: number | null;
  suppressed?: boolean;
  emailStatus?: string;
  vetting?: VettingRow | null;
  revet?: VettingRow;
  facts?: FactRow[];
  guard?: import("./sendingHealth.js").GuardState;
  requireReplyTo?: boolean;
  sendsEnabled?: boolean;
  config?: Partial<import("./sender.js").SendConfig>;
  cap?: { cap: number; sentToday: number };
  subject?: string;
  body?: string;
  campaignId?: number | null;
  campaignStatus?: string | null;
  lastContactedAt?: Date | null;
  deliverError?: string;
}

function fakeSendWorld(overrides: SendWorldOverrides = {}) {
  const calls: Record<string, unknown[]> = {
    deliver: [],
    markSent: [],
    markFailed: [],
    markDeferred: [],
    bumpProspect: [],
    revet: [],
    lock: [],
  };
  const email = {
    id: 42,
    prospectId: 1,
    actionId: overrides.actionId === undefined ? 900 : overrides.actionId,
    campaignId: overrides.campaignId ?? null,
    step: null,
    variantKey: null,
    status: overrides.emailStatus ?? "draft",
    subjectOptions: ["A", "B"],
    subject: overrides.subject ?? "A preview of weddings at Willow House",
    body: overrides.body ?? "I came across Willow House while looking at venues in Hudson.\n\nThe Barn looks like a place couples would love.",
    greeting: "Hi Dana,",
    signOff: "Thanks,\nSam at Dreemer",
    ctaLabel: "Ask for a free preview",
    ctaUrl: "https://studio.test/claim/claimtoken1234567890?utm_source=dreemer-outreach",
    imageAssetIds: [5],
    draftNotes: null,
    citedFacts: null,
    vettingSnapshot: null,
    unsubscribeToken: "tok_abcdefghijklmnop",
    claimToken: "claimtoken1234567890",
    htmlSnapshot: null,
    textSnapshot: null,
    providerMessageId: null,
    sentTo: null,
    sentAt: null,
    deliveredAt: null,
    bouncedAt: null,
    bounceReason: null,
    openedAt: null,
    clickedAt: null,
    lastError: null,
    createdByAgent: "outreach",
    editedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as EmailRow;
  const prospect = {
    ...baseProspect,
    lastContactedAt: overrides.lastContactedAt ?? null,
    name: "Willow House",
    contactName: "Dana",
    phone: null,
    website: "https://willow.test",
    region: "Hudson, NY",
    source: "agent_research",
    score: 80,
    qualification: null,
    campaignId: null,
    campaignStep: 0,
    statusChangedBy: null,
    vettingStatus: "passed",
    legitimacyScore: 82,
    vettedAt: new Date(),
    createdByAgent: "prospecting",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ProspectRow;
  const asset = {
    id: 5,
    prospectId: 1,
    kind: "venue_image",
    objectKey: "/public-objects/outreach/1/a.jpg",
    sourceUrl: "https://willow.test/images/a.jpg",
    pageUrl: "https://willow.test/",
    contentType: "image/jpeg",
    width: 1200,
    height: 750,
    bytes: 1000,
    altText: "Willow House barn",
    score: 90,
    selected: true,
    createdBy: "research",
    createdAt: new Date(),
  } as AssetRow;
  const deps: import("./sender.js").OutreachSendDeps = {
    loadEmail: async () => email,
    loadProspect: async () => prospect,
    loadActionStatus: async () => (overrides.actionStatus === undefined ? "executing" : overrides.actionStatus),
    loadAssets: async () => [asset],
    isSuppressed: async () => overrides.suppressed ?? false,
    existingCustomerSlug: async () => null,
    loadPolicy: async () => policy,
    dailyCap: async () => overrides.cap ?? { cap: 15, sentToday: 0 },
    loadVetting: async () => (overrides.vetting === undefined ? vettingRow() : overrides.vetting),
    revet: async () => {
      calls.revet.push(true);
      if (!overrides.revet) throw new Error("revet unavailable");
      return overrides.revet;
    },
    loadFacts: async () => overrides.facts ?? WILLOW_FACTS,
    policyFlags: async () => ({
      guard: overrides.guard ?? { status: "ok", since: null, reason: null, okDays: 0 },
      requireReplyTo: overrides.requireReplyTo ?? true,
      sendsEnabled: overrides.sendsEnabled ?? true,
    }),
    campaignStatus: async () => (overrides.campaignStatus === undefined ? "active" : overrides.campaignStatus),
    withSendLock: async (fn) => {
      calls.lock.push(true);
      return fn();
    },
    deliver: async (message) => {
      if (overrides.deliverError) throw new Error(overrides.deliverError);
      calls.deliver.push(message);
      return { id: "re_123" };
    },
    markSent: async (...args) => {
      calls.markSent.push(args);
    },
    markFailed: async (...args) => {
      calls.markFailed.push(args);
    },
    markDeferred: async (...args) => {
      calls.markDeferred.push(args);
    },
    bumpProspect: async (...args) => {
      calls.bumpProspect.push(args);
    },
    config: () => ({
      postalAddress: "Dreemer · 1 Main St",
      unsubscribeMailbox: null,
      replyTo: "sam@dreemer.co",
      postalAddressIsPlaceholder: false,
      sandboxSender: false,
      resendConfigured: true,
      ...overrides.config,
    }),
    imageUrl: (key) => `https://studio.test/api/storage${key}`,
    now: () => SEND_NOW,
  };
  return { deps, calls };
}

test("nothing sends without an approved action", async () => {
  for (const actionStatus of ["pending", "rejected", "executed", "failed", "approvedish", null]) {
    const { deps, calls } = fakeSendWorld({ actionStatus });
    await assert.rejects(sender.sendOutreachEmail(42, deps), /not approved|missing/);
    assert.equal(calls.deliver.length, 0, `no delivery when action is ${actionStatus}`);
  }
  const noAction = fakeSendWorld({ actionId: null });
  await assert.rejects(sender.sendOutreachEmail(42, noAction.deps), /no governed action/);
  assert.equal(noAction.calls.deliver.length, 0);

  const already = fakeSendWorld({ emailStatus: "sent" });
  await assert.rejects(sender.sendOutreachEmail(42, already.deps), /cannot be sent again/);
  assert.equal(already.calls.deliver.length, 0);
});

test("suppressed addresses never receive mail even with an approved action", async () => {
  const { deps, calls } = fakeSendWorld({ suppressed: true });
  await assert.rejects(sender.sendOutreachEmail(42, deps), /suppression list/);
  assert.equal(calls.deliver.length, 0);
  assert.equal(calls.markFailed.length, 1, "the failure is recorded on the email");
});

test("an approved email sends once with unsubscribe headers, reply-to, images, and records delivery", async () => {
  const { deps, calls } = fakeSendWorld();
  const result = await sender.sendOutreachEmail(42, deps);
  assert.equal(result.sent, true);
  assert.equal(result.providerId, "re_123");
  assert.equal(calls.deliver.length, 1);
  const message = calls.deliver[0] as import("./sender.js").DeliverMessage;
  assert.equal(message.to, "owner@venue.test");
  assert.equal(message.replyTo, "sam@dreemer.co");
  assert.equal(message.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(message.headers["List-Unsubscribe"]!, /unsubscribe\/tok_abcdefghijklmnop/);
  assert.match(message.html, /outreach\/1\/a\.jpg/);
  assert.match(message.html, /alt="Willow House barn"/);
  assert.match(message.text, /came across Willow House/);
  assert.match(message.text, /publicly lists this address/);
  assert.equal(calls.lock.length, 1, "cap check and delivery run under the send lock");
  assert.equal(calls.markSent.length, 1);
  assert.equal(calls.bumpProspect.length, 1);
  assert.equal(calls.markFailed.length, 0);
});

test("the send action is high risk and only reachable through the governed catalog", () => {
  const action = ACTION_CATALOG.send_outreach_email;
  assert.ok(action);
  assert.equal(action.riskLevel, "high");
  assert.equal(action.paramsSchema.safeParse({ emailId: 1 }).success, true);
  assert.equal(action.paramsSchema.safeParse({ emailId: 1, extra: true }).success, false, "strict params");
  const outreach = AGENT_DEFINITIONS.find((agent) => agent.key === "outreach");
  assert.ok(outreach?.tools.includes("draft_outreach_email"));
  assert.ok(!AGENT_DEFINITIONS.some((agent) => agent.key !== "outreach" && agent.tools.includes("draft_outreach_email")));
});

test("copy: validator rejects hype, stats, length, and ungrounded spaces; fallback always passes", () => {
  const input: import("./copywriter.js").CopyInput = {
    facts: { name: "Willow House", location: "Hudson, NY", spaces: ["The Barn", "Garden Terrace"], style: null, capacity: 180, summary: null },
    verifiedFacts: [
      { kind: "owner_name", value: "Dana Reyes", sourceUrl: "https://willow.test/about" },
      { kind: "space", value: "The Barn", sourceUrl: "https://willow.test/" },
      { kind: "space", value: "Garden Terrace", sourceUrl: "https://willow.test/" },
      { kind: "location", value: "Hudson, NY", sourceUrl: "https://willow.test/" },
    ],
    prospectName: "Willow House",
    contactName: "Dana Reyes",
    ask: "preview",
    contactCount: 0,
    stepGuidance: null,
    senderFirstName: "Sam",
  };
  const fallback = copywriter.fallbackCopy(input);
  assert.deepEqual(copywriter.validateCopy(fallback, input), []);
  assert.ok(fallback.subjects.every((s) => s.length <= 50));
  assert.ok(copywriter.countWords(fallback.body) <= 120);
  assert.equal(fallback.greeting, "Hi Dana,");
  assert.match(fallback.body, /Barn/);

  const hype = copywriter.validateCopy(
    {
      ...fallback,
      subjects: ["Revolutionize your bookings!!!", "This subject line is far too long for a mobile inbox preview"],
      body: `${fallback.body} Venues see 40% more bookings with our cutting-edge solution.`,
    },
    input,
  );
  assert.ok(hype.some((v) => /statistic/.test(v)));
  assert.ok(hype.some((v) => /cutting-edge|solution|revolutioni/.test(v)));
  assert.ok(hype.some((v) => /subject 2 is \d+ characters/.test(v)));
  assert.ok(hype.some((v) => /shout/.test(v)));

  const noSpaces = copywriter.validateCopy({ ...fallback, body: "I work at Dreemer. ".repeat(6) }, input);
  assert.ok(noSpaces.some((v) => /actual spaces/.test(v)));

  const long = copywriter.validateCopy({ ...fallback, body: `${fallback.body} ${"more words here ".repeat(40)}` }, input);
  assert.ok(long.some((v) => /max 120/.test(v)));

  assert.equal(copywriter.clampSubject("A preview of weddings at The Extraordinarily Long Venue Name Estate", "The Extraordinarily Long Venue Name Estate").length <= 50, true);
});

test("copy: without XAI_API_KEY the studio uses the fallback and says so", async () => {
  const result = await copywriter.writeCopy({
    facts: { name: "Willow House", location: null, spaces: [], style: null, capacity: null, summary: null },
    verifiedFacts: [],
    prospectName: "Willow House",
    contactName: null,
    ask: "call",
    contactCount: 1,
    stepGuidance: null,
    senderFirstName: "Sam",
  });
  assert.equal(result.notes.source, "fallback");
  assert.equal(result.greeting, "Hi there,");
  assert.match(result.body, /15-minute call/);
});

test("grok: tolerant JSON parsing for structured completions", () => {
  assert.deepEqual(grok.parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(grok.parseJsonObject('Sure! {"a":{"b":2}} trailing'), { a: { b: 2 } });
  assert.equal(grok.parseJsonObject("[1,2]"), null);
  assert.equal(grok.parseJsonObject("nope"), null);
});

/* ————— Send gates: deferred (draft kept, action back to pending) vs failed ————— */

const { isDeferredSendError } = await import("./sendErrors.js");
const studioModule = await import("./studio.js");
const configModule = await import("./config.js");
const webhook = await import("./resendWebhook.js");
const venueEmail = await import("./venueEmail.js");

async function expectSendRefusal(
  overrides: SendWorldOverrides,
  message: RegExp,
  kind: "deferred" | "failed",
): Promise<ReturnType<typeof fakeSendWorld>> {
  const world = fakeSendWorld(overrides);
  let caught: unknown = null;
  await sender.sendOutreachEmail(42, world.deps).catch((err: unknown) => {
    caught = err;
  });
  assert.ok(caught instanceof Error, `expected a refusal matching ${message}`);
  assert.match((caught as Error).message, message);
  assert.equal(world.calls.deliver.length, 0, `${message} must not deliver`);
  assert.equal(isDeferredSendError(caught), kind === "deferred", `${message} should be ${kind}`);
  assert.equal(world.calls.markDeferred.length, kind === "deferred" ? 1 : 0);
  assert.equal(world.calls.markFailed.length, kind === "failed" ? 1 : 0);
  return world;
}

test("sender: fixable preconditions keep the draft (deferred)", async () => {
  await expectSendRefusal({ cap: { cap: 15, sentToday: 15 } }, /Daily prospect email cap reached \(15\/15\)/, "deferred");
  await expectSendRefusal({ cap: { cap: 0, sentToday: 0 } }, /paused \(daily cap is 0\)/, "deferred");
  await expectSendRefusal(
    { guard: { status: "paused", since: null, reason: "1 spam complaint in 14 days", okDays: 0 } },
    /paused by the deliverability guard \(1 spam complaint/,
    "deferred",
  );
  await expectSendRefusal({ sendsEnabled: false }, /frozen/, "deferred");
  await expectSendRefusal({ vetting: null }, /has not been vetted/, "deferred");
  await expectSendRefusal({ vetting: vettingRow({ status: "review", score: 48 }) }, /48\/100/, "deferred");
  await expectSendRefusal({ vetting: vettingRow({ status: "error" }) }, /could not complete/, "deferred");
  await expectSendRefusal({ facts: [factRow(1, "space", "The Barn")] }, /cites 1 verified venue fact/, "deferred");
  await expectSendRefusal({ subject: "Re: your venue" }, /fake a reply/, "deferred");
  await expectSendRefusal({ config: { postalAddressIsPlaceholder: true } }, /OUTREACH_POSTAL_ADDRESS/, "deferred");
  await expectSendRefusal({ config: { replyTo: null } }, /OUTREACH_REPLY_TO is not set/, "deferred");
  await expectSendRefusal({ config: { replyTo: "sam@gmail.com" } }, /free-mail/, "deferred");
  await expectSendRefusal({ config: { sandboxSender: true } }, /sandbox/, "deferred");
  await expectSendRefusal({ config: { resendConfigured: false } }, /RESEND_API_KEY/, "deferred");
  await expectSendRefusal({ lastContactedAt: new Date(SEND_NOW.getTime() - 10 * 3_600_000) }, /72h gap/, "deferred");
  await expectSendRefusal({ campaignId: 3, campaignStatus: "paused" }, /Campaign 3 is "paused"/, "deferred");
});

test("sender: blocked recipients and provider rejections fail the email", async () => {
  await expectSendRefusal({ suppressed: true }, /suppression list/, "failed");
  await expectSendRefusal({ vetting: vettingRow({ status: "failed", summary: "Failed 12/100: parked domain" }) }, /may not be emailed/, "failed");
  await expectSendRefusal({ campaignId: 3, campaignStatus: "completed" }, /Campaign 3 is "completed"/, "failed");
  await expectSendRefusal({ deliverError: "The email provider rejected the send." }, /provider rejected/, "failed");
});

test("sender: an expired passed verdict re-vets once and sends when it still passes; vetting runs before config checks", async () => {
  const expired = vettingRow({ expiresAt: new Date(SEND_NOW.getTime() - 3_600_000) });
  const ok = fakeSendWorld({ vetting: expired, revet: vettingRow() });
  const result = await sender.sendOutreachEmail(42, ok.deps);
  assert.equal(result.sent, true);
  assert.equal(ok.calls.revet.length, 1);

  const stale = await expectSendRefusal(
    { vetting: expired, revet: vettingRow({ status: "review", score: 50, expiresAt: new Date(SEND_NOW.getTime() + 86_400_000) }) },
    /needs an operator decision/,
    "deferred",
  );
  assert.equal(stale.calls.revet.length, 1);

  // With delivery unconfigured, the vetting refusal still comes first.
  await expectSendRefusal({ vetting: vettingRow({ status: "failed" }), config: { resendConfigured: false } }, /may not be emailed/, "failed");
});

test("sender: the cap message distinguishes a guard pause from a normal cap", () => {
  assert.match(sender.dailyCapMessage({ cap: 0, sentToday: 0 }), /paused/);
  assert.match(sender.dailyCapMessage({ cap: 10, sentToday: 10 }), /10\/10/);
});

test("contact guards: refusal codes separate a waiting gap from permanent blocks", () => {
  const ok = { suppressed: false, existingCustomerSlug: null };
  const codeOf = (fn: () => void): string | null => {
    try {
      fn();
      return null;
    } catch (err) {
      return (err as InstanceType<typeof guards.ContactGuardError>).code;
    }
  };
  assert.equal(codeOf(() => guards.assertProspectContactable(baseProspect, policy, { ...ok, suppressed: true })), "suppressed");
  assert.equal(codeOf(() => guards.assertProspectContactable({ ...baseProspect, status: "replied" }, policy, ok)), "status");
  assert.equal(codeOf(() => guards.assertProspectContactable({ ...baseProspect, contactCount: 3 }, policy, ok)), "lifetime_cap");
  assert.equal(
    codeOf(() =>
      guards.assertProspectContactable({ ...baseProspect, lastContactedAt: new Date(SEND_NOW.getTime() - 3_600_000) }, policy, ok, SEND_NOW),
    ),
    "gap",
  );
});

/* ————— Studio rules (pure) ————— */

test("studio: campaign touches must be active, enrolled, and in step order", () => {
  const prospect = { id: 1, campaignId: 3, campaignStep: 1 };
  const campaign = { id: 3, status: "active", steps: [{ step: 1 }, { step: 2 }, { step: 3 }] };
  assert.deepEqual(studioModule.resolveCampaignTouch({ requestedCampaignId: 3, requestedStep: null, prospect, campaign }), { campaignId: 3, step: 2 });
  assert.throws(() => studioModule.resolveCampaignTouch({ requestedCampaignId: 3, requestedStep: 3, prospect, campaign }), /due step 2/);
  assert.throws(
    () => studioModule.resolveCampaignTouch({ requestedCampaignId: 3, requestedStep: null, prospect, campaign: { ...campaign, status: "paused" } }),
    /only active campaigns/,
  );
  assert.throws(
    () => studioModule.resolveCampaignTouch({ requestedCampaignId: 3, requestedStep: null, prospect: { ...prospect, campaignId: 9 }, campaign }),
    /not enrolled/,
  );
  assert.throws(
    () => studioModule.resolveCampaignTouch({ requestedCampaignId: 3, requestedStep: null, prospect: { ...prospect, campaignStep: 3 }, campaign }),
    /completed the sequence/,
  );
  // An inherited campaign that is not active simply makes the note a standalone touch.
  assert.deepEqual(
    studioModule.resolveCampaignTouch({ requestedCampaignId: null, requestedStep: null, prospect, campaign: { ...campaign, status: "draft" } }),
    { campaignId: null, step: null },
  );
  assert.deepEqual(
    studioModule.resolveCampaignTouch({ requestedCampaignId: null, requestedStep: null, prospect: { ...prospect, campaignId: null }, campaign: null }),
    { campaignId: null, step: null },
  );
});

test("studio: failed research waits a day before re-crawling; good research lasts two weeks", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  assert.equal(studioModule.researchIsFresh({ status: "fetch_failed", fetchedAt: hoursAgo(2) }, now), true);
  assert.equal(studioModule.researchIsFresh({ status: "fetch_failed", fetchedAt: hoursAgo(25) }, now), false);
  assert.equal(studioModule.researchIsFresh({ status: "ok", fetchedAt: hoursAgo(24 * 13) }, now), true);
  assert.equal(studioModule.researchIsFresh({ status: "no_images", fetchedAt: hoursAgo(24 * 15) }, now), false);
});

test("studio: provider events are monotonic; opens and clicks stamp their first time", () => {
  const at = new Date("2026-10-08T12:00:00Z");
  const base = { status: "sent", deliveredAt: null, openedAt: null, clickedAt: null };
  assert.deepEqual(studioModule.deliveryEventPatch(base, { eventType: "delivered", at }), { deliveredAt: at, status: "delivered" });
  assert.deepEqual(studioModule.deliveryEventPatch({ ...base, status: "bounced" }, { eventType: "delivered", at }), { deliveredAt: at });
  assert.deepEqual(studioModule.deliveryEventPatch({ ...base, status: "complained" }, { eventType: "bounced", at }), {});
  assert.equal(studioModule.deliveryEventPatch({ ...base, status: "delivered" }, { eventType: "complained", at }).status, "complained");
  assert.deepEqual(studioModule.deliveryEventPatch(base, { eventType: "opened", at }), { openedAt: at });
  assert.deepEqual(studioModule.deliveryEventPatch({ ...base, openedAt: at }, { eventType: "opened", at: new Date() }), {});
  assert.deepEqual(studioModule.deliveryEventPatch(base, { eventType: "clicked", at }), { openedAt: at, clickedAt: at });
  assert.equal(webhook.EVENT_MAP["email.opened"], "opened");
  assert.equal(webhook.EVENT_MAP["email.clicked"], "clicked");
});

test("claim links: the default CTA is the tracked claim URL with UTM parameters", () => {
  delete process.env.OUTREACH_CTA_URL;
  const url = new URL(configModule.outreachDefaultCtaUrl("Willow House", { token: "claimtoken1234567890", campaignId: 3, variantKey: "v2" }));
  assert.equal(url.origin, "https://studio.test");
  assert.equal(url.pathname, "/claim/claimtoken1234567890");
  assert.equal(url.searchParams.get("utm_source"), "dreemer-outreach");
  assert.equal(url.searchParams.get("utm_medium"), "email");
  assert.equal(url.searchParams.get("utm_campaign"), "campaign-3");
  assert.equal(url.searchParams.get("utm_content"), "v2");
  const firstTouch = new URL(configModule.claimUrl("tok_abcdefghijklmnop"));
  assert.equal(firstTouch.searchParams.get("utm_campaign"), "first-touch");
});

test("webhook: inbound replies are matched by the sender address", () => {
  assert.equal(webhook.inboundSenderAddress("Dana Whitfield <Dana@WillowHouse.test>"), "dana@willowhouse.test");
  assert.equal(webhook.inboundSenderAddress([{ email: "owner@venue.test", name: "Owner" }]), "owner@venue.test");
  assert.equal(webhook.inboundSenderAddress("not an address"), null);
  assert.equal(webhook.inboundSenderAddress(undefined), null);
});

test("venue email: operational notes carry a why-line, the postal address and List-Unsubscribe", () => {
  const rendered = venueEmail.renderVenueEmail({
    subject: "Your first gallery",
    paragraphs: ["Hi Dana,", "Your QR card is <ready>."],
    venueName: "Willow House",
    postalAddress: "Dreemer · 1 Main St",
    unsubscribeMailbox: "hello@dreemer.co",
  });
  assert.match(rendered.html, /&lt;ready&gt;/);
  assert.match(rendered.text, /you manage Willow House/);
  assert.match(rendered.text, /Dreemer · 1 Main St/);
  assert.equal(rendered.headers["List-Unsubscribe"], "<mailto:hello@dreemer.co?subject=unsubscribe>");
  assert.deepEqual(
    venueEmail.renderVenueEmail({ subject: "s", paragraphs: ["x"], venueName: "V", postalAddress: "a", unsubscribeMailbox: null }).headers,
    {},
  );
});
