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
  assert.equal(result.images[0]!.sourceUrl, `${HOME}images/og-garden.jpg`, "og:image ranks first");
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
  assert.match(rendered.text, /unsubscribe here[^\n]*https:\/\/studio\.test\/api\/outreach\/unsubscribe\/tok123/);
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

function fakeSendWorld(overrides: { actionStatus?: string | null; actionId?: number | null; suppressed?: boolean; emailStatus?: string } = {}) {
  const calls: Record<string, unknown[]> = { deliver: [], markSent: [], markFailed: [], bumpProspect: [] };
  const email = {
    id: 42,
    prospectId: 1,
    actionId: overrides.actionId === undefined ? 900 : overrides.actionId,
    campaignId: null,
    step: null,
    status: overrides.emailStatus ?? "draft",
    subjectOptions: ["A", "B"],
    subject: "A preview of weddings at Willow House",
    body: "Para one.\n\nPara two.",
    greeting: "Hi Dana,",
    signOff: "Thanks,\nSam at Dreemer",
    ctaLabel: "Ask for a free preview",
    ctaUrl: "mailto:sam@dreemer.co",
    imageAssetIds: [5],
    draftNotes: null,
    unsubscribeToken: "tok_abcdefghijklmnop",
    htmlSnapshot: null,
    textSnapshot: null,
    providerMessageId: null,
    sentTo: null,
    sentAt: null,
    deliveredAt: null,
    bouncedAt: null,
    bounceReason: null,
    lastError: null,
    createdByAgent: "outreach",
    editedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as EmailRow;
  const prospect = {
    ...baseProspect,
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
    loadActionStatus: async () => (overrides.actionStatus === undefined ? "approved" : overrides.actionStatus),
    loadAssets: async () => [asset],
    isSuppressed: async () => overrides.suppressed ?? false,
    existingCustomerSlug: async () => null,
    loadPolicy: async () => policy,
    dailyCap: async () => ({ cap: 15, sentToday: 0 }),
    deliver: async (message) => {
      calls.deliver.push(message);
      return { id: "re_123" };
    },
    markSent: async (...args) => {
      calls.markSent.push(args);
    },
    markFailed: async (...args) => {
      calls.markFailed.push(args);
    },
    bumpProspect: async (...args) => {
      calls.bumpProspect.push(args);
    },
    config: () => ({ postalAddress: "Dreemer · 1 Main St", unsubscribeMailbox: null, replyTo: "sam@dreemer.co" }),
    imageUrl: (key) => `https://studio.test/api/storage${key}`,
    now: () => new Date("2026-10-03T12:00:00Z"),
  };
  return { deps, calls };
}

test("nothing sends without an approved action", async () => {
  for (const actionStatus of ["pending", "rejected", "executed", "failed", null]) {
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
  assert.match(message.text, /Para one\./);
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
