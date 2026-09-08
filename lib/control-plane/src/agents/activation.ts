import type { AgentContext, AgentDefinition, AgentOutput, DecisionProposal } from "../types.js";
import { clamp, dayBucket, formatPercent, observation, pct, pluralize, round } from "../util.js";

const SETUP_GRACE_DAYS = 2;
const FIRST_SESSION_TARGET_DAYS = 7;

/**
 * Activation owns the distance between "signed up" and "delivered a gallery".
 * A venue that never uploads photos, or uploads them and never shares its
 * link, is the most expensive kind of customer there is.
 */
export const activationAgent: AgentDefinition = {
  key: "activation-agent",
  domain: "activation",
  displayName: "Activation",
  charter: "Get every new venue to its first delivered gallery within a week.",
  defaultIntervalMinutes: 240,
  defaultAutonomy: "supervised",

  run(ctx: AgentContext): AgentOutput {
    const { snapshot, now } = ctx;
    const { venues } = snapshot;
    const proposals: DecisionProposal[] = [];
    const today = dayBucket(now);

    const activated = venues.filter((venue) => venue.readyCount > 0);
    const activationRate = pct(activated.length, venues.length);
    const stalledSetup = venues.filter(
      (venue) => !venue.ready && venue.ageDays >= SETUP_GRACE_DAYS,
    );
    const readyButIdle = venues.filter(
      (venue) => venue.ready && venue.sessionsTotal === 0 && venue.ageDays >= SETUP_GRACE_DAYS,
    );
    const timeToFirst = activated
      .map((venue) => venue.ageDays)
      .sort((a, b) => a - b);
    const medianAgeOfActivated = timeToFirst.length
      ? timeToFirst[Math.floor(timeToFirst.length / 2)]
      : null;

    const observations = [
      observation("activation_rate", "Venues with a delivered gallery", round(activationRate, 3), {
        goodDirection: "up",
        detail: `${activated.length} of ${venues.length} venues — ${formatPercent(activationRate)}`,
        severity: venues.length >= 3 && activationRate < 0.5 ? "warning" : "info",
      }),
      observation("stalled_setup", "Venues stuck before photo setup", stalledSetup.length, {
        goodDirection: "down",
        severity: stalledSetup.length > 0 ? "warning" : "info",
      }),
      observation("ready_but_idle", "Set up but never shared a link", readyButIdle.length, {
        goodDirection: "down",
        severity: readyButIdle.length > 0 ? "warning" : "info",
      }),
      observation("median_age_activated", "Median age of activated venues (days)", medianAgeOfActivated),
    ];

    // Venues stuck in setup: the blocker is always a named coverage gap, so
    // say which photos are missing rather than "complete your profile".
    for (const venue of stalledSetup.slice(0, 6)) {
      const gaps = venue.coverageGaps;
      const gapText = gaps.length ? gaps.join(", ") : "more venue photography";
      proposals.push({
        kind: "activation.setup_nudge",
        title: `${venue.name} cannot generate yet — missing ${pluralize(gaps.length || 1, "photo set")}`,
        rationale:
          `${venue.name} signed up ${venue.ageDays} days ago with ${venue.mediaCount} photos and still ` +
          `cannot run the couple flow. Missing coverage: ${gapText}. Until that is fixed the venue ` +
          `cannot produce a single gallery, so nothing else in the funnel applies to it.`,
        effect: {
          type: "venue.nudge",
          venueId: venue.id,
          subject: `Two or three more photos and ${venue.name} is live on glimpse`,
          body:
            `Hi ${venue.name},\n\n` +
            `Your glimpse page is almost ready. To generate galleries we still need ${gapText}.\n\n` +
            `Upload them from your dashboard and your couple link goes live immediately.`,
          reason: `setup_gap_${gaps.join("_") || "coverage"}`,
        },
        evidence: {
          venueId: venue.id,
          slug: venue.slug,
          mediaCount: venue.mediaCount,
          coverageGaps: gaps,
          ageDays: venue.ageDays,
        },
        confidence: 0.86,
        impactScore: clamp(70 - venue.ageDays, 30, 90),
        dedupeKey: `activation.setup.${venue.id}.${today}`,
        expiresInHours: 120,
      });
    }

    // Set up but never used: the product works, the habit does not exist yet.
    for (const venue of readyButIdle.slice(0, 6)) {
      proposals.push({
        kind: "activation.first_gallery_nudge",
        title: `${venue.name} is live but has never run a gallery`,
        rationale:
          `${venue.name} completed photo setup ${venue.ageDays} days ago and has produced no galleries. ` +
          `The product is ready; what is missing is the venue handing the link to a couple.`,
        effect: {
          type: "venue.nudge",
          venueId: venue.id,
          subject: `Run your first glimpse gallery this week`,
          body:
            `Hi ${venue.name},\n\n` +
            `Your venue is fully set up — your couple link works right now. Try it on your next tour: ` +
            `the couple uploads a photo of themselves and gets four images of their wedding at your ` +
            `venue plus a branded reel.\n\n` +
            `Your link and QR code are on your dashboard.`,
          reason: "no_first_session",
        },
        evidence: { venueId: venue.id, slug: venue.slug, ageDays: venue.ageDays },
        confidence: 0.8,
        impactScore: clamp(65 - venue.ageDays, 25, 85),
        dedupeKey: `activation.first_gallery.${venue.id}.${today}`,
        expiresInHours: 168,
      });
    }

    // Systemic activation failure is a product problem, not an outreach one.
    const overdue = venues.filter(
      (venue) => venue.readyCount === 0 && venue.ageDays >= FIRST_SESSION_TARGET_DAYS,
    );
    if (venues.length >= 3 && overdue.length >= Math.ceil(venues.length / 2)) {
      proposals.push({
        kind: "activation.systemic_gap",
        title: `${overdue.length} of ${venues.length} venues never reached a first gallery`,
        rationale:
          `More than half the roster is past the ${FIRST_SESSION_TARGET_DAYS}-day activation target with ` +
          `no delivered gallery. At this ratio the onboarding path itself is the constraint, not any one ` +
          `venue's follow-through.`,
        effect: {
          type: "workItem.upsert",
          workItem: {
            type: "upgrade",
            title: "Rework venue onboarding to reach first gallery inside a week",
            detail:
              `${overdue.length} of ${venues.length} venues are past ${FIRST_SESSION_TARGET_DAYS} days with ` +
              `no delivered gallery. Setup gaps: ${stalledSetup.length}; set up but idle: ${readyButIdle.length}. ` +
              `The split says whether the fix belongs in the upload flow or in link distribution.`,
            severity: "high",
            surface: "onboarding",
            dedupeKey: "activation.systemic_gap",
            evidence: {
              overdue: overdue.length,
              total: venues.length,
              stalledSetup: stalledSetup.length,
              readyButIdle: readyButIdle.length,
            },
          },
        },
        evidence: { overdue: overdue.length, total: venues.length },
        confidence: 0.82,
        impactScore: 85,
        dedupeKey: "activation.systemic_gap",
      });
    } else if (overdue.length === 0 && venues.length > 0) {
      proposals.push({
        kind: "activation.systemic_gap_cleared",
        title: "Onboarding backlog cleared",
        rationale: "Every venue past the activation window has now delivered a gallery.",
        effect: {
          type: "workItem.close",
          dedupeKey: "activation.systemic_gap",
          note: "No venue is past the activation window without a delivered gallery.",
        },
        evidence: { total: venues.length },
        confidence: 0.9,
        impactScore: 10,
        dedupeKey: `activation.systemic_gap_cleared.${today}`,
      });
    }

    return {
      summary:
        `${formatPercent(activationRate)} activated (${activated.length}/${venues.length}); ` +
        `${stalledSetup.length} stuck in setup, ${readyButIdle.length} live but idle.`,
      observations,
      proposals,
      memory: [],
      metrics: [
        { metricKey: "activation.rate", value: round(activationRate, 4) },
        { metricKey: "activation.stalled_setup", value: stalledSetup.length },
        { metricKey: "activation.ready_but_idle", value: readyButIdle.length },
      ],
    };
  },
};
