import fs from "node:fs";
import path from "node:path";

/**
 * Control-plane fixtures for the isolated UI harness. The Outreach tab is the
 * interesting one: it renders the sample emails produced by
 * `pnpm run outreach:demo` (qa-output/outreach-demo) when they exist, with
 * image URLs rewritten to the fixture storage route.
 */

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

const metrics = {
  computedAt: now.toISOString(),
  organizations: { total: 14, totalCreditsBalance: 61, lowCreditCount: 3, paidCount: 5 },
  venues: { total: 19, new7d: 2, new30d: 6, withMedia: 15, withSessions: 11, activationRate: 58 },
  sessions: { total: 143, created7d: 12, created30d: 41, ready7d: 11, failed7d: 1, failureRate7d: 8, avgCompletionMinutes7d: 6 },
  credits: { granted30d: 70, consumed30d: 41, refunded30d: 1, purchased30d: 30, grantsByReason30d: { purchase: 30, trial: 40 } },
  assets: { generated7d: 55 },
};

const agentDefs: Array<[string, string, string, string]> = [
  ["prospecting", "Prospecting Agent", "prospecting", "Finds and qualifies potential venue customers."],
  ["outreach", "Outreach Agent", "outreach", "Drafts personal venue emails through the studio."],
  ["campaigns", "Campaigns Agent", "campaigns", "Designs and runs multi-step sequences."],
  ["activation", "Activation Agent", "activation", "Gets new venues to their first live gallery."],
  ["support", "Support Agent", "support", "Finds stuck or failed couple sessions."],
  ["product", "Product Repair Agent", "product", "Turns failure patterns into repair work."],
  ["finance", "Finance Agent", "finance", "Owns the credit ledger and revenue signals."],
  ["experiments", "Experiments Agent", "experiments", "Runs the experiment portfolio."],
  ["governance", "Governance Agent", "governance", "Audits the other agents."],
];

export const overview = {
  operatorEmail: "operator@example.test",
  aiConfigured: true,
  model: "grok-4.7",
  metrics,
  agents: agentDefs.map(([key, name, domain, description], i) => ({
    key,
    name,
    domain,
    description,
    status: "active",
    intervalMinutes: 360,
    lastRunAt: minutesAgo(30 + i * 40),
    lastRunStatus: "succeeded",
  })),
  counts: { pendingActions: 2, openTasks: 3, runningExperiments: 1, runs24h: 7 },
};

function demoDirs(): string[] {
  const root = path.resolve(import.meta.dirname, "../../../qa-output/outreach-demo");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(path.join(dir, "email-light.html")));
}

function readSample(dir: string) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Record<string, any>;
  const rewrite = (html: string) => html.replace(/file:\/\/[^"']+/g, "/api/storage/public-objects/demo.webp");
  return {
    manifest,
    html: rewrite(fs.readFileSync(path.join(dir, "email-light.html"), "utf8")),
    htmlDark: rewrite(fs.readFileSync(path.join(dir, "email-dark.html"), "utf8")),
    text: fs.readFileSync(path.join(dir, "email.txt"), "utf8"),
  };
}

const fallbackSample = {
  manifest: {
    site: "https://www.willowhouseweddings.example/",
    research: {
      status: "ok",
      sourceUrls: ["https://www.willowhouseweddings.example/", "https://www.willowhouseweddings.example/weddings"],
      facts: { name: "Willow House", location: "Hudson, NY", spaces: ["The Timber Barn", "The Stone Terrace", "The Orchard Lawn"], style: "A restored 1850s farmhouse and timber barn on forty acres above the Hudson.", capacity: 180, summary: null },
      warnings: [],
      images: [
        { sourceUrl: "https://www.willowhouseweddings.example/images/barn.jpg", pageUrl: "https://www.willowhouseweddings.example/", width: 1200, height: 750, bytes: 184000, altText: "The Timber Barn at dusk", score: 92, selected: true },
        { sourceUrl: "https://www.willowhouseweddings.example/images/terrace.jpg", pageUrl: "https://www.willowhouseweddings.example/", width: 1200, height: 800, bytes: 162000, altText: "Stone Terrace at golden hour", score: 71, selected: true },
        { sourceUrl: "https://www.willowhouseweddings.example/images/lawn.jpg", pageUrl: "https://www.willowhouseweddings.example/weddings", width: 1200, height: 900, bytes: 171000, altText: "Ceremony on the Orchard Lawn", score: 64, selected: true },
      ],
    },
    copy: {
      subjects: ["A preview of weddings at Willow House", "Willow House, after the tour"],
      greeting: "Hi Dana,",
      body: "I came across Willow House while looking at wedding venues in Hudson, NY. The Timber Barn and the Stone Terrace look like places couples would want to picture their own day in.\n\nI work at Dreemer. After a couple tours with you, we make them a short, personal preview of their wedding in your actual spaces, so the conversation keeps going once they leave.\n\nWould you like a free preview made for Willow House?",
      signOff: "Thanks,\nSam at Dreemer",
      ctaLabel: "Ask for a free preview",
      notes: { source: "fallback", wordCount: 86, attempts: 0, violations: [] },
    },
    headers: { "List-Unsubscribe": "<https://dreemer.co/api/outreach/unsubscribe/demo>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  },
  html: "<!doctype html><html><body style=\"font-family:sans-serif;padding:24px\">Run <code>pnpm run outreach:demo</code> to render real samples here.</body></html>",
  htmlDark: "<!doctype html><html><body style=\"background:#141917;color:#eef1ec;font-family:sans-serif;padding:24px\">Run <code>pnpm run outreach:demo</code> to render real samples here.</body></html>",
  text: "Run pnpm run outreach:demo to render real samples here.",
};

function samples() {
  const dirs = demoDirs();
  const loaded = dirs.length > 0 ? dirs.map(readSample) : [fallbackSample];
  return loaded.map((sample, index) => {
    const id = index + 1;
    const facts = sample.manifest.research.facts as Record<string, any>;
    const venueName: string = facts.name ?? `Venue ${id}`;
    const prospect = {
      id,
      name: venueName,
      contactName: id === 1 ? "Dana Reyes" : null,
      email: `events@${slugHost(sample.manifest.site)}`,
      phone: null,
      website: sample.manifest.site,
      region: facts.location ?? null,
      source: "agent_research",
      score: 84 - index * 7,
      qualification: "Independent venue with an active wedding program and a strong photo gallery.",
      status: "qualified",
      campaignId: null,
      campaignStep: 0,
      contactCount: 0,
      lastContactedAt: null,
      statusChangedBy: null,
      createdByAgent: "prospecting",
      vettingStatus: "unvetted",
      legitimacyScore: null,
      vettedAt: null,
      venueType: null,
      repliedAt: null,
      replySentiment: null,
      convertedAt: null,
      convertedOrganizationId: null,
      convertedCampaignId: null,
      attributionMethod: null,
      createdAt: minutesAgo(900),
      updatedAt: minutesAgo(90),
    };
    const assets = (sample.manifest.research.images as Array<Record<string, any>>).map((image, i) => ({
      id: id * 10 + i + 1,
      kind: "venue_image",
      url: "/api/storage/public-objects/demo.webp",
      sourceUrl: image.sourceUrl,
      pageUrl: image.pageUrl,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      altText: image.altText,
      score: image.score,
      selected: image.selected,
      inEmail: image.selected,
      createdAt: minutesAgo(60),
    }));
    const email = {
      id,
      prospectId: id,
      actionId: 500 + id,
      campaignId: null,
      step: null,
      status: "draft",
      subjectOptions: sample.manifest.copy.subjects,
      subject: sample.manifest.copy.subjects[0],
      body: sample.manifest.copy.body,
      greeting: sample.manifest.copy.greeting,
      signOff: sample.manifest.copy.signOff,
      ctaLabel: sample.manifest.copy.ctaLabel,
      ctaUrl: `mailto:sam@dreemer.co?subject=Free%20preview%20for%20${encodeURIComponent(venueName)}`,
      imageAssetIds: assets.filter((a) => a.inEmail).map((a) => a.id),
      variantKey: null,
      citedFacts: null,
      vettingSnapshot: null,
      draftNotes: sample.manifest.copy.notes,
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
      createdAt: minutesAgo(55),
      updatedAt: minutesAgo(40 - index * 5),
    };
    return {
      listItem: {
        email,
        prospect: { id, name: venueName, email: prospect.email, contactName: prospect.contactName, status: prospect.status, vettingStatus: prospect.vettingStatus, website: prospect.website, region: prospect.region },
        actionStatus: "pending",
        imageCount: email.imageAssetIds.length,
      },
      detail: {
        email,
        prospect,
        action: { id: 500 + id, status: "pending", decidedBy: null, decisionNote: null, error: null },
        research: {
          status: sample.manifest.research.status,
          facts,
          sourceUrls: sample.manifest.research.sourceUrls,
          warnings: sample.manifest.research.warnings,
          fetchedAt: minutesAgo(58),
        },
        vetting: null,
        facts: [],
        approvable: true,
        assets,
        preview: { html: sample.html, htmlDark: sample.htmlDark, text: sample.text, headers: sample.manifest.headers },
        warnings: { research: sample.manifest.research.warnings, config: [], vetting: [] },
        editable: true,
      },
    };
  });
}

function slugHost(site: string): string {
  try {
    return new URL(site).hostname.replace(/^www\./, "");
  } catch {
    return "example.test";
  }
}

/** Returns fixture JSON for GET /api/control/* URLs, or undefined when unknown. */
export function controlFixture(url: string): unknown {
  const [pathname] = url.split("?");
  if (pathname === "/control/overview") return overview;
  if (pathname === "/control/outreach/emails") return { emails: samples().map((s) => s.listItem) };
  const detail = pathname?.match(/^\/control\/outreach\/emails\/(\d+)$/);
  if (detail) {
    const sample = samples()[Number(detail[1]) - 1];
    return sample ? { detail: sample.detail } : undefined;
  }
  if (pathname === "/control/actions") return { actions: [] };
  if (pathname === "/control/tasks") return { tasks: [] };
  if (pathname === "/control/runs") return { runs: [] };
  if (pathname === "/control/experiments") return { experiments: [] };
  if (pathname === "/control/audit") return { events: [] };
  if (pathname === "/control/policies") return { policies: [] };
  if (pathname === "/control/prospects") return { prospects: samples().map((s) => s.detail.prospect) };
  if (pathname === "/control/campaigns") return { campaigns: [] };
  return undefined;
}
