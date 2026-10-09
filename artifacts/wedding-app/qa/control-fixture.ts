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
  const loaded = dirs.length > 0 ? dirs.map(readSample) : [fallbackSample, fallbackSample];
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
      vettingStatus: index === 1 ? "review" : "passed",
      legitimacyScore: index === 1 ? 52 : 78,
      vettedAt: minutesAgo(600),
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
      citedFacts: [
        { kind: "space", value: (facts.spaces?.[0] as string | undefined) ?? "The Timber Barn", sourceUrl: sample.manifest.site },
        ...(index === 0 ? [{ kind: "location", value: (facts.location as string | undefined) ?? "Hudson, NY", sourceUrl: sample.manifest.site }] : []),
      ],
      vettingSnapshot: { status: index === 1 ? "review" : "passed", score: index === 1 ? 52 : 78, vettedAt: minutesAgo(600) },
      draftNotes: index === 1 ? { ...sample.manifest.copy.notes, violations: ["body is 131 words (max 120)"] } : sample.manifest.copy.notes,
      providerMessageId: null,
      sentTo: null,
      sentAt: null,
      deliveredAt: null,
      bouncedAt: null,
      bounceReason: null,
      openedAt: null,
      clickedAt: null,
      lastError: index === 0 ? null : "Deferred: the daily prospect cap is reached; approve again tomorrow.",
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
        vetting: {
          id,
          prospectId: id,
          status: index === 1 ? "review" : "passed",
          score: index === 1 ? 52 : 78,
          tier: "A",
          hardFails: [],
          checks: [],
          summary: "Real venue site with a long-lived domain.",
          contactDomain: slugHost(sample.manifest.site),
          mxProvider: "google",
          domainRegisteredAt: null,
          firstCaptureAt: null,
          placesPlaceId: null,
          vettedAt: minutesAgo(600),
          expiresAt: new Date(now.getTime() + 28 * 86_400_000).toISOString(),
          vettedBy: "system",
        },
        facts: [
          { id: id * 100 + 1, prospectId: id, kind: "space", value: (facts.spaces?.[0] as string | undefined) ?? "The Timber Barn", sourceUrl: sample.manifest.site, sourceKind: "website", excerpt: null, status: "verified", verifiedAt: minutesAgo(600), createdBy: "system", createdAt: minutesAgo(600) },
          { id: id * 100 + 2, prospectId: id, kind: "capacity", value: String(facts.capacity ?? 180), sourceUrl: sample.manifest.site, sourceKind: "website", excerpt: null, status: "verified", verifiedAt: minutesAgo(600), createdBy: "system", createdAt: minutesAgo(600) },
        ],
        approvable: index === 0,
        assets,
        preview: { html: sample.html, htmlDark: sample.htmlDark, text: sample.text, headers: sample.manifest.headers },
        warnings: { research: sample.manifest.research.warnings, config: [], vetting: index === 1 ? ["Legitimacy 52/100 needs an operator decision (Pipeline → Evidence → Override)."] : [] },
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

/* ————— Console fixtures beyond the studio (WS-H) ————— */

const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

/** 30 daily points with a gentle drift; deterministic so screenshots are stable. */
function series(start: number, step: number, wobble: number, days = 30): Array<{ at: string; value: number }> {
  return Array.from({ length: days }, (_, i) => ({
    at: daysAgo(days - 1 - i),
    value: Math.max(0, Math.round((start + step * i + Math.sin(i * 1.7) * wobble) * 100) / 100),
  }));
}

function trend(key: string, label: string, unit: string, betterWhen: "higher" | "lower", points: Array<{ at: string; value: number }>) {
  const current = points.at(-1)?.value ?? null;
  const previous7d = points.at(-8)?.value ?? null;
  return { key, label, unit, betterWhen, points, current, previous7d, delta7d: current !== null && previous7d !== null ? current - previous7d : null };
}

const trends = {
  windowDays: 30,
  series: [
    trend("organizations", "Organizations", "count", "higher", series(8, 0.2, 0.4)),
    trend("paid", "Paid organizations", "count", "higher", series(2, 0.1, 0.2)),
    trend("mrr", "MRR (estimate)", "cents", "higher", series(25800, 900, 400)),
    trend("activation", "Venue activation", "percent", "higher", series(41, 0.6, 2)),
    trend("sessions7d", "Galleries started 7d", "count", "higher", series(6, 0.2, 2)),
    trend("bounceRate", "Bounce rate 14d", "rate", "lower", series(0.021, -0.0004, 0.002)),
    trend("complaintRate", "Complaint rate 14d", "rate", "lower", series(0.0006, 0, 0.0002)),
  ],
};

const funnel = {
  owners: { signups: 14, signups30d: 6, activated: 9, paid: 5, churned: 1 },
  prospects: { total: 157, vetted: 61, contacted: 24, replied: 6, converted: 2, unsubscribed: 1 },
};

const growthKpis = {
  version: 1,
  computedAt: minutesAgo(45),
  window: { start30d: daysAgo(30), start14d: daysAgo(14), start7d: daysAgo(7), cohortStart: daysAgo(84) },
  signups: { orgs7d: 2, orgs30d: 6, venues7d: 2, venues30d: 7, attributedToOutbound30d: 2, byWeek: [] },
  activation: {
    minPhotos: 3,
    funnel: { orgs: 14, withVenue: 13, photosReady: 11, firstGallery: 9, galleryViewed: 8, secondGallery14d: 5 },
    rates: { withVenue: 13 / 14, photosReady: 11 / 13, firstGallery: 9 / 11, galleryViewed: 8 / 9, secondGallery14d: 5 / 8 },
    timeToFirstGalleryHours: { median: 5.3, p75: 30.2, n: 9 },
    firstGalleryWithin7d: 0.57,
    firstGalleryWithin14d: 0.64,
    byCohortWeek: Array.from({ length: 12 }, (_, i) => ({
      weekStart: daysAgo(7 * (i + 1)),
      orgs: 1 + (i % 3),
      photosReady: 1 + (i % 2),
      firstGallery: i % 3 === 0 ? 0 : 1,
      galleryViewed: i % 3 === 0 ? 0 : 1,
      secondGallery14d: i % 4 === 0 ? 1 : 0,
      paid: i > 2 && i % 2 === 0 ? 1 : 0,
      matured: i >= 2,
    })),
  },
  trialToPaid: {
    overall: { orgs: 11, paid: 5, rate: 5 / 11 },
    byActivation: { activated: { orgs: 8, paid: 5, rate: 5 / 8 }, notActivated: { orgs: 3, paid: 0, rate: 0 } },
    byCohortWeek: [],
    medianDaysToPaid: 9,
  },
  revenue: {
    planMix: { trial: 8, starter: 3, growth: 1, payg: 1, none: 1 },
    paidOrgs: 5,
    subscriptionOrgs: 4,
    mrrCents: 3 * 12900 + 27900,
    arpaCents: 13320,
    packPurchases30d: 1,
    packRevenueCents30d: 5900,
    prices: { source: "env", starterCents: 12900, growthCents: 27900, creditPackCents: 5900 },
  },
  credits: { purchased30d: 10, subscriptionGranted30d: 175, consumed30d: 41, refunded30d: 1, promo30d: 0, trialGranted30d: 30, consumedPerPaidOrg30d: 6.2, float: 61 },
  churn: { subscriptionsDeleted30d: 1, trialsExpired30d: 2, trialsExpiredWithoutPurchase30d: 2, paidOrgsAtWindowStart: 4, logoChurnRate30d: 0.25, trialsExpiringNext7d: 2, trialsExpiringNext7dWithoutGallery: 1 },
  outbound: {
    funnel: { drafted: 31, approved: 25, sent: 24, delivered: 23, bounced: 1, complained: 0, replied: 6, positiveReplied: 4, signups: 2, activated: 2, paid: 1, legacySends: 0 },
    rates: { deliveryRate: 23 / 24, bounceRate: 1 / 24, complaintRate: 0, replyRate: 6 / 23, positiveReplyRate: 4 / 23, signupRate: 2 / 23, paidRate: 1 / 23 },
    bySegment: [
      { segmentType: "region", segment: "Hudson Valley", prospects: 48, sent: 14, delivered: 14, replied: 4, positiveReplied: 3, signups: 2, activated: 2, paid: 1, replyRate: 4 / 14, positiveReplyRate: 3 / 14, signupRate: 2 / 14, guidance: "prioritize" },
      { segmentType: "region", segment: "Hill Country", prospects: 61, sent: 10, delivered: 9, replied: 2, positiveReplied: 1, signups: 0, activated: 0, paid: 0, replyRate: 2 / 9, positiveReplyRate: 1 / 9, signupRate: 0, guidance: null },
      { segmentType: "venue_type", segment: "barn_farm", prospects: 70, sent: 15, delivered: 15, replied: 5, positiveReplied: 3, signups: 2, activated: 2, paid: 1, replyRate: 5 / 15, positiveReplyRate: 3 / 15, signupRate: 2 / 15, guidance: "prioritize" },
      { segmentType: "venue_type", segment: "hotel", prospects: 22, sent: 9, delivered: 8, replied: 1, positiveReplied: 1, signups: 0, activated: 0, paid: 0, replyRate: 1 / 8, positiveReplyRate: 1 / 8, signupRate: 0, guidance: null },
    ],
    byVariant: [],
    byCampaign: [],
    byStep: [],
  },
  deliverability: {
    window14d: { sent: 18, delivered: 17, bounced: 1, complained: 0, bounceRate: 1 / 18, complaintRate: 0 },
    status: "warn",
    guard: { status: "warn", since: daysAgo(1), reason: "bounce rate 5.6% over the last 14 days (18 sends)", baseCap: 15, effectiveCap: 15 },
  },
  experiments: { proposed: 1, running: 1, decisionsDue7d: 1, decided30d: 1 },
  dataQuality: ["Fewer than 50 sends in 14 days; deliverability rules are watching but not acting yet."],
};

const metrics = {
  capturedAt: now.toISOString(),
  organizations: { total: 14, byPlan: { trial: 8, starter: 3, growth: 1, payg: 1, none: 1 }, totalCreditsBalance: 61, lowCreditCount: 3, paidCount: 5, paidSubscriptionCount: 4 },
  venues: { total: 19, new7d: 2, new30d: 6, withMedia: 15, withSessions: 11, unadoptedLegacy: 0, activationRate: 58 },
  sessions: { total: 143, byStatus: { ready: 131, failed: 6, processing: 6 }, created7d: 12, created30d: 41, ready7d: 11, failed7d: 1, failureRate7d: 8, avgCompletionMinutes7d: 6 },
  credits: { granted30d: 70, consumed30d: 41, refunded30d: 1, purchased30d: 30, grantsByReason30d: { purchase: 30, trial: 40 } },
  assets: { generated7d: 55 },
};

const metricKeys = [
  { key: "outbound.positive_reply_rate", label: "Positive reply rate", unit: "rate", direction: "higher", supportsSegment: true, supportsVariant: true },
  { key: "activation.first_gallery_rate", label: "First gallery rate", unit: "rate", direction: "higher", supportsSegment: false, supportsVariant: false },
  { key: "activation.hours_to_first_gallery", label: "Hours to first gallery", unit: "hours", direction: "lower", supportsSegment: false, supportsVariant: false },
];

const experiments = [
  {
    id: 3, name: "Name the barn in the first line", hypothesis: "Opening with the venue's own space name lifts positive replies among barn venues.",
    metric: "Positive replies per delivered email", variants: null, status: "running", result: null, createdByAgent: "experiments",
    startedAt: daysAgo(12), endedAt: null, primaryMetricKey: "outbound.positive_reply_rate", baseline: 0.12, minDetectableLift: 0.25,
    killThreshold: 0.05, decisionDate: daysAgo(-5), segment: "venue_type:barn_farm", variantKey: "space_first", assignments: null,
    decision: null, decidedBy: null, decidedAt: null, observedValue: 0.2, observedN: 15,
    evaluation: { decision: "continue", reason: "Observed 20.0% vs target 15.0%; n=15 is below the 30 needed.", n: 15, target: 0.15, requiredN: 30, underpowered: true, evaluatedAt: minutesAgo(50) },
    createdAt: daysAgo(14), updatedAt: minutesAgo(50),
  },
  {
    id: 4, name: "Send the tour card with the first gallery", hypothesis: "A printable tour card in the first-gallery email gets more venues to a second gallery within 14 days.",
    metric: "Second gallery within 14 days", variants: null, status: "proposed", result: null, createdByAgent: "activation",
    startedAt: null, endedAt: null, primaryMetricKey: "activation.first_gallery_rate", baseline: null, minDetectableLift: 0.2,
    killThreshold: null, decisionDate: daysAgo(-28), segment: null, variantKey: null, assignments: null, decision: null,
    decidedBy: null, decidedAt: null, observedValue: null, observedN: null, evaluation: null, createdAt: daysAgo(2), updatedAt: daysAgo(2),
  },
  {
    id: 2, name: "Shorter subject lines", hypothesis: "Subjects under 35 characters get more replies.", metric: "Reply rate", variants: null,
    status: "completed", result: "No measurable difference after 40 sends.", createdByAgent: "experiments", startedAt: daysAgo(40), endedAt: daysAgo(12),
    primaryMetricKey: "outbound.positive_reply_rate", baseline: 0.11, minDetectableLift: 0.3, killThreshold: null, decisionDate: daysAgo(12),
    segment: null, variantKey: null, assignments: null, decision: "inconclusive", decidedBy: "operator:operator@example.test", decidedAt: daysAgo(12),
    observedValue: 0.12, observedN: 40, evaluation: null, createdAt: daysAgo(42), updatedAt: daysAgo(12),
  },
];

const growth = {
  snapshotId: 88,
  computedAt: minutesAgo(45),
  kpis: growthKpis,
  guidance: { prioritize: [], pause: [], updatedAt: null },
  variants: [
    { variantKey: "control", name: "Plain note", isControl: true, active: true, weight: 0.5, sent: 12, delivered: 12, replied: 3, positiveReplied: 2, signups: 1, replyRate: 0.25, positiveReplyRate: 2 / 12, signupRate: 1 / 12, smoothedPositiveReplyRate: 0.15 },
    { variantKey: "space_first", name: "Space first", isControl: false, active: true, weight: 0.5, sent: 12, delivered: 11, replied: 3, positiveReplied: 2, signups: 1, replyRate: 3 / 11, positiveReplyRate: 2 / 11, signupRate: 1 / 11, smoothedPositiveReplyRate: 0.16 },
  ],
  adaptations: [
    { id: 9, ruleKey: "segment_guidance", subjectType: "policy", subjectId: "segment_guidance", action: "prioritize", before: { prioritize: [] }, after: { prioritize: ["region:Hudson Valley"] }, reason: "Hudson Valley positive replies 3/14 vs 1/9 elsewhere.", snapshotId: 87, createdAt: daysAgo(3) },
  ],
  metricKeys,
  loopEnabled: true,
  latestDigest: {
    id: 5, weekStart: daysAgo(3), document: { headline: "Two signups from outreach; the barn note is ahead but under-sampled.", recommendations: [{ kind: "scale", text: "Keep drafting for Hudson Valley barns." }, { kind: "watch", text: "One bounce this week; the guard is watching." }] },
    polishedBy: null, actionId: 77, sentTo: null, sentAt: null, createdBy: "system", createdAt: daysAgo(3),
    html: "<!doctype html><html><body style=\"font-family:sans-serif;padding:24px\"><h1 style=\"font-size:18px\">Weekly digest</h1><p>Fixture preview.</p></body></html>",
  },
};

const policies = [
  ["agents_enabled", { enabled: true }, "Master switch: when false the scheduler starts no agent runs (manual runs included)."],
  ["outreach_sends_enabled", { enabled: true }, "Master switch for prospect outreach delivery; when false sendOutreachEmail refuses every send."],
  ["max_prospect_emails_per_day_base", { emails: 15 }, "Operator-set daily prospect cap; the deliverability guard restores max_prospect_emails_per_day to this value."],
  ["max_prospect_emails_per_day", { emails: 15 }, "Maximum prospect outreach emails the control plane may send per UTC day."],
  ["min_hours_between_prospect_contacts", { hours: 72 }, "Minimum gap between two emails to the same prospect."],
  ["max_contacts_per_prospect", { contacts: 3 }, "Lifetime cap of automated emails per prospect."],
  ["vetting_pass_score", { score: 60 }, "Minimum legitimacy score for outreach without an operator override."],
  ["vetting_blocked_countries", { codes: "CA" }, "Comma-separated ISO-2 country codes excluded from outreach."],
  ["max_daily_ai_usd", { usd: 25 }, "Estimated Grok spend cap per UTC day across all agent runs."],
  ["deliverability_guard", { status: "warn", since: daysAgo(1), reason: "bounce rate 5.6%", okDays: 0 }, "Automatic send-cap state driven by bounces and complaints."],
].map(([key, value, description], i) => ({ id: i + 1, key, value, description, createdAt: daysAgo(30), updatedAt: daysAgo(i) }));

const campaigns = [
  {
    id: 1, name: "Hudson Valley barns", objective: "Book a first preview with independent barn venues in the Hudson Valley.", audience: "Barn and farm venues, 100-250 guests",
    steps: [{ step: 1, waitDays: 0, guidance: "Personal note naming one real space." }, { step: 2, waitDays: 5, guidance: "Short follow-up with one photo." }],
    status: "draft", prospectCounts: { qualified: 12, contacted: 3 }, createdByAgent: "campaigns", launchedAt: null, completedAt: null, createdAt: daysAgo(6), updatedAt: daysAgo(6),
  },
  {
    id: 2, name: "Hill Country estates", objective: "Reach estate venues west of Austin.", audience: null,
    steps: [{ step: 1, waitDays: 0, guidance: "Lead with the courtyard." }],
    status: "active", prospectCounts: { contacted: 9, replied: 2, converted: 1 }, createdByAgent: "campaigns", launchedAt: daysAgo(10), completedAt: null, createdAt: daysAgo(12), updatedAt: daysAgo(10),
  },
];

const PROSPECT_NAMES = ["Willow House", "Cedar Ridge Barn", "The Orchard at Hollis", "Stonegate Estate", "Riverbend Farm", "Juniper Hall", "Maple Hollow", "The Granary", "Lakeview Lodge", "Copper Creek Ranch"];
const VETTING = ["passed", "passed", "review", "unvetted", "failed", "passed", "error", "unvetted"] as const;
const STATUSES = ["qualified", "new", "contacted", "replied", "qualified", "disqualified", "converted", "unsubscribed"] as const;

function syntheticProspects(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const name = `${PROSPECT_NAMES[i % PROSPECT_NAMES.length]}${i >= PROSPECT_NAMES.length ? ` ${Math.floor(i / PROSPECT_NAMES.length) + 1}` : ""}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const vettingStatus = VETTING[i % VETTING.length]!;
    return {
      id: 100 + i, name, contactName: i % 3 === 0 ? "Dana Reyes" : null, email: `events@${slug}.example`, phone: null,
      website: i % 11 === 5 ? null : `https://www.${slug}.example/`, region: i % 2 === 0 ? "Hudson Valley" : "Hill Country",
      source: "agent_research", score: 90 - (i % 30), qualification: "Independent venue with an active wedding program and a photo gallery.",
      status: STATUSES[i % STATUSES.length]!, campaignId: i % 4 === 0 ? 1 : null, campaignStep: 0, contactCount: i % 3, lastContactedAt: i % 3 ? daysAgo(i % 9) : null,
      statusChangedBy: null, createdByAgent: "prospecting", vettingStatus,
      legitimacyScore: vettingStatus === "unvetted" || vettingStatus === "error" ? null : vettingStatus === "passed" ? 78 : vettingStatus === "review" ? 52 : 31,
      vettedAt: vettingStatus === "unvetted" ? null : daysAgo(2), venueType: i % 2 ? "barn_farm" : "estate", repliedAt: null, replySentiment: null,
      convertedAt: null, convertedOrganizationId: null, convertedCampaignId: null, attributionMethod: null, createdAt: daysAgo(20 - (i % 20)), updatedAt: daysAgo(i % 5),
    };
  });
}

function evidenceFor(prospect: Record<string, any>) {
  const site = prospect.website ?? "https://example.test/";
  const vetted = prospect.vettingStatus !== "unvetted";
  return {
    prospect,
    vetting: vetted
      ? {
          id: prospect.id, prospectId: prospect.id, status: prospect.vettingStatus, score: prospect.legitimacyScore ?? 0, tier: "A", hardFails: [],
          checks: [
            { key: "site_reachable", outcome: "pass", points: 15, hardFail: false, detail: "Home page loads over HTTPS with venue content.", evidence: [{ url: site, excerpt: "Weddings at the barn", observedAt: daysAgo(2) }] },
            { key: "domain_age", outcome: "pass", points: 10, hardFail: false, detail: "Domain registered 2011.", evidence: [{ url: "https://rdap.org/domain/example", excerpt: null, observedAt: daysAgo(2) }] },
            { key: "mail_records", outcome: "warn", points: 4, hardFail: false, detail: "MX present; no DMARC record.", evidence: [] },
            { key: "places_listing", outcome: "skip", points: 0, hardFail: false, detail: "Places lookup is off.", evidence: [] },
          ],
          summary: "Real venue site with a long-lived domain; mail records are partly configured.", contactDomain: new URL(site).hostname,
          mxProvider: "google", domainRegisteredAt: "2011-03-02T00:00:00.000Z", firstCaptureAt: "2012-01-01T00:00:00.000Z", placesPlaceId: null,
          vettedAt: daysAgo(2), expiresAt: daysAgo(-28), vettedBy: "system",
        }
      : null,
    facts: vetted
      ? [
          { id: prospect.id * 10 + 1, prospectId: prospect.id, kind: "space", value: "The Timber Barn", sourceUrl: site, sourceKind: "website", excerpt: null, status: "verified", verifiedAt: daysAgo(2), createdBy: "system", createdAt: daysAgo(2) },
          { id: prospect.id * 10 + 2, prospectId: prospect.id, kind: "location", value: prospect.region ?? "Hudson, NY", sourceUrl: site, sourceKind: "json_ld", excerpt: null, status: "verified", verifiedAt: daysAgo(2), createdBy: "system", createdAt: daysAgo(2) },
          { id: prospect.id * 10 + 3, prospectId: prospect.id, kind: "capacity", value: "180", sourceUrl: site, sourceKind: "website", excerpt: null, status: "unverified", verifiedAt: null, createdBy: "system", createdAt: daysAgo(2) },
        ]
      : [],
    research: null,
    assets: [],
  };
}

function pendingActions(emailIds: number[]) {
  const base = [
    ...emailIds.map((id, i) => ({
      id: 500 + id, agentKey: "outreach", runId: 40 + i, actionType: "send_outreach_email", title: `Send studio email #${id}`,
      reasoning: "Drafted with two verified facts; venue vetted.", params: { emailId: id }, riskLevel: "high", requiresApproval: true,
      status: "pending", decidedBy: null, decisionNote: null, decidedAt: null, executedAt: null, result: null, error: null, createdAt: minutesAgo(60 + i),
    })),
    {
      id: 610, agentKey: "outreach", runId: 12, actionType: "send_prospect_email", title: "Email Cedar Ridge Barn (legacy)", reasoning: "Follow-up.",
      params: { prospectId: 101, subject: "Quick question", body: "Hi there" }, riskLevel: "high", requiresApproval: true, status: "pending",
      decidedBy: null, decisionNote: null, decidedAt: null, executedAt: null, result: null, error: null, createdAt: daysAgo(6),
    },
    {
      id: 611, agentKey: "activation", runId: 13, actionType: "send_venue_email", title: "Nudge Willow House to upload photos", reasoning: "Signed up 3 days ago with no photos.",
      params: { venueSlug: "willow-house", subject: "Your first gallery is two photos away", message: "Hi Dana,\n\nAdd five photos of your spaces and your first couple gallery can go out today.\n\nSam at Dreemer" },
      riskLevel: "medium", requiresApproval: true, status: "pending", decidedBy: null, decisionNote: null, decidedAt: null, executedAt: null, result: null, error: null, createdAt: daysAgo(1),
    },
  ];
  return base;
}

const historyActions = [
  { id: 420, agentKey: "finance", runId: 9, actionType: "grant_promo_credits", title: "Grant 3 credits to Rustic", reasoning: "Two failed sessions.", params: { organizationId: 2, credits: 3 }, riskLevel: "medium", requiresApproval: true, status: "executing", decidedBy: "operator@example.test", decisionNote: null, decidedAt: minutesAgo(1), executedAt: null, result: null, error: null, createdAt: minutesAgo(20) },
  { id: 419, agentKey: "campaigns", runId: 8, actionType: "launch_campaign", title: "Launch Hill Country estates", reasoning: null, params: { campaignId: 2 }, riskLevel: "high", requiresApproval: true, status: "executed", decidedBy: "operator@example.test", decisionNote: "ok", decidedAt: daysAgo(10), executedAt: daysAgo(10), result: { campaignId: 2, status: "active" }, error: null, createdAt: daysAgo(11) },
];

function page<T>(rows: T[], params: URLSearchParams, fallbackLimit = 50): T[] {
  const limit = Math.min(Number(params.get("limit")) || fallbackLimit, 200);
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  return rows.slice(offset, offset + limit);
}

/** Returns fixture JSON for GET /api/control/* URLs, or undefined when unknown. */
export function controlFixture(url: string): unknown {
  const [pathname = "", query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  const studio = samples();
  if (pathname === "/control/overview") return { ...overview, metrics, funnel, trends };
  if (pathname === "/control/outreach/emails") {
    const status = params.get("status");
    const rows = studio
      .map((s) => s.listItem)
      .filter((item) => (status ? item.email.status === status : true))
      .filter((item) => (params.get("awaiting") === "true" ? item.email.status === "draft" && item.actionStatus === "pending" : true));
    return { emails: page(rows, params) };
  }
  const detail = pathname.match(/^\/control\/outreach\/emails\/(\d+)$/);
  if (detail) {
    const sample = studio[Number(detail[1]) - 1];
    return sample ? { detail: sample.detail } : undefined;
  }
  if (pathname === "/control/outreach/sending") {
    return {
      guard: { status: "warn", since: daysAgo(1), reason: "bounce rate 5.6% over 14 days", okDays: 0 },
      dailyCap: { policyMax: 15, sentToday: 3 },
      health: { windowDays: 14, sent: 18, bounced: 1, complained: 0, bounceRatePct: 5.6 },
    };
  }
  if (pathname === "/control/actions") {
    const status = params.get("status");
    const all = [...pendingActions(studio.map((s) => s.listItem.email.id)), ...historyActions];
    return { actions: page(status ? all.filter((a) => a.status === status) : all, params) };
  }
  if (pathname === "/control/tasks") return { tasks: [] };
  if (pathname === "/control/runs") return { runs: [] };
  if (pathname === "/control/experiments") {
    const status = params.get("status");
    return { experiments: status ? experiments.filter((e) => e.status === status) : experiments };
  }
  if (pathname === "/control/growth") return growth;
  if (pathname === "/control/audit") return { events: [] };
  if (pathname === "/control/policies") return { policies };
  if (pathname === "/control/metrics/history") return { snapshots: [] };
  if (pathname === "/control/prospects") {
    const all = [...studio.map((s) => s.detail.prospect), ...syntheticProspects(70)];
    const q = (params.get("q") ?? "").toLowerCase();
    const rows = all
      .filter((p) => (params.get("status") ? p.status === params.get("status") : true))
      .filter((p) => (params.get("vettingStatus") ? p.vettingStatus === params.get("vettingStatus") : true))
      .filter((p) => (q ? [p.name, p.email, p.website ?? "", p.region ?? ""].some((v) => v.toLowerCase().includes(q)) : true));
    return { prospects: page(rows, params) };
  }
  const evidence = pathname.match(/^\/control\/prospects\/(\d+)\/evidence$/);
  if (evidence) {
    const id = Number(evidence[1]);
    const prospect = [...studio.map((s) => s.detail.prospect), ...syntheticProspects(70)].find((p) => p.id === id);
    return prospect ? evidenceFor(prospect) : undefined;
  }
  if (pathname === "/control/campaigns") return { campaigns };
  return undefined;
}
