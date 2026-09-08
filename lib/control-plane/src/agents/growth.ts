import type { AgentContext, AgentDefinition, AgentOutput, DecisionProposal } from "../types.js";
import { changeRatio, clamp, formatPercent, observation, pct, round, weekBucket } from "../util.js";

const DORMANT_VENUE_DAYS = 21;
const DECLINE_ALERT = -0.25;

/**
 * Growth owns demand: how many couple galleries start each week, whether that
 * number is moving, and which venues have gone quiet.
 */
export const growthAgent: AgentDefinition = {
  key: "growth-agent",
  domain: "growth",
  displayName: "Growth",
  charter: "Grow weekly gallery starts and keep every live venue producing.",
  defaultIntervalMinutes: 180,
  defaultAutonomy: "supervised",

  run(ctx: AgentContext): AgentOutput {
    const { snapshot, now } = ctx;
    const { funnel, venues } = snapshot;
    const proposals: DecisionProposal[] = [];

    const wow = changeRatio(funnel.last7d.started, funnel.prev7d.started);
    const activeVenues = venues.filter((venue) => venue.sessionsLast7d > 0);
    const liveVenues = venues.filter((venue) => venue.ready);
    const dormant = liveVenues.filter(
      (venue) =>
        venue.sessionsTotal > 0 &&
        (venue.daysSinceLastSession ?? Number.POSITIVE_INFINITY) >= DORMANT_VENUE_DAYS,
    );
    const startToReady = pct(funnel.last7d.ready, funnel.last7d.started);
    const perActiveVenue = activeVenues.length
      ? round(funnel.last7d.started / activeVenues.length, 2)
      : 0;

    const observations = [
      observation("sessions_7d", "Gallery starts, last 7 days", funnel.last7d.started, {
        goodDirection: "up",
        delta: wow,
        severity: wow !== null && wow <= DECLINE_ALERT ? "warning" : "info",
      }),
      observation("active_venues_7d", "Venues producing this week", activeVenues.length, {
        goodDirection: "up",
        detail: `${liveVenues.length} venues are live and able to produce`,
      }),
      observation("starts_per_active_venue", "Starts per active venue", perActiveVenue, {
        goodDirection: "up",
      }),
      observation("start_to_ready_rate", "Start → delivered rate", round(startToReady, 3), {
        goodDirection: "up",
        detail: formatPercent(startToReady),
      }),
      observation("dormant_venues", "Live venues dormant 21+ days", dormant.length, {
        goodDirection: "down",
        severity: dormant.length > 0 ? "warning" : "info",
      }),
    ];

    // A real week-over-week decline is the one thing growth must never sit on.
    if (wow !== null && wow <= DECLINE_ALERT && funnel.prev7d.started >= 3) {
      proposals.push({
        kind: "growth.decline_alert",
        title: `Gallery starts fell ${formatPercent(Math.abs(wow))} week over week`,
        rationale:
          `Starts went from ${funnel.prev7d.started} to ${funnel.last7d.started} week over week ` +
          `across ${liveVenues.length} live venues. ${activeVenues.length} venues produced anything ` +
          `at all this week, so the drop is ${activeVenues.length < liveVenues.length / 2 ? "concentrated in venues going quiet" : "broad across the roster"}.`,
        effect: {
          type: "notify.operator",
          subject: `Gallery starts down ${formatPercent(Math.abs(wow))} this week`,
          body:
            `Last 7 days: ${funnel.last7d.started} starts, ${funnel.last7d.ready} delivered.\n` +
            `Prior 7 days: ${funnel.prev7d.started} starts, ${funnel.prev7d.ready} delivered.\n` +
            `Active venues: ${activeVenues.length} of ${liveVenues.length} live.\n` +
            `Dormant 21+ days: ${dormant.map((venue) => venue.slug).join(", ") || "none"}.`,
          severity: wow <= -0.4 ? "critical" : "warning",
        },
        evidence: {
          startsLast7d: funnel.last7d.started,
          startsPrev7d: funnel.prev7d.started,
          activeVenues: activeVenues.length,
          liveVenues: liveVenues.length,
        },
        confidence: 0.9,
        impactScore: clamp(60 + Math.abs(wow) * 60, 0, 100),
        dedupeKey: `growth.decline.${weekBucket(now)}`,
        expiresInHours: 168,
      });
    }

    // Dormant venues are the cheapest demand in the business — they already
    // signed up. One nudge each, at most once a fortnight.
    for (const venue of dormant.slice(0, 5)) {
      const days = venue.daysSinceLastSession ?? DORMANT_VENUE_DAYS;
      proposals.push({
        kind: "growth.reactivate_venue",
        title: `Re-engage ${venue.name} — ${days} days without a gallery`,
        rationale:
          `${venue.name} has produced ${venue.sessionsTotal} galleries but nothing in ${days} days. ` +
          `Its photo set is complete, so the couple flow works today — the venue has simply stopped ` +
          `sharing its link.`,
        effect: {
          type: "venue.nudge",
          venueId: venue.id,
          subject: `Your glimpse gallery link is ready for this weekend's tours`,
          body:
            `Hi ${venue.name},\n\n` +
            `Your glimpse link has been quiet for ${days} days. Couples who see their own wedding at ` +
            `your venue book faster — hand them the link or the QR code at the end of a tour and they ` +
            `get a four-image gallery plus a branded reel in minutes.\n\n` +
            `Open your dashboard to grab the link again.`,
          reason: `dormant_${days}d`,
        },
        evidence: { venueId: venue.id, slug: venue.slug, daysSinceLastSession: days },
        confidence: 0.75,
        impactScore: clamp(35 + venue.sessionsTotal * 2, 0, 80),
        dedupeKey: `growth.reactivate.${venue.id}.${weekBucket(now)}`,
        expiresInHours: 336,
      });
    }

    // Weak start→delivered conversion is a growth problem before it is a
    // product one: it is the surface couples abandon.
    if (funnel.last7d.started >= 10 && startToReady < 0.7) {
      proposals.push({
        kind: "growth.conversion_experiment",
        title: "Test the couple entry screen — delivery rate is under 70%",
        rationale:
          `Only ${formatPercent(startToReady)} of the ${funnel.last7d.started} galleries started this ` +
          `week reached a couple. Before adding demand, the existing demand should convert.`,
        effect: {
          type: "experiment.launch",
          key: `couple-entry-clarity-${weekBucket(now)}`,
          hypothesis:
            "Naming the deliverable and the wait time on the couple entry screen raises completed galleries.",
          surface: "couple_entry",
          primaryMetric: "gallery_delivered",
          variants: [
            { key: "control", label: "Current entry copy", weight: 50 },
            { key: "explicit", label: "Explicit deliverable and timing", weight: 50 },
          ],
          minimumSampleSize: 200,
        },
        evidence: {
          startToReady: round(startToReady, 3),
          started: funnel.last7d.started,
          ready: funnel.last7d.ready,
        },
        confidence: 0.66,
        impactScore: 55,
        dedupeKey: `growth.conversion_experiment.${weekBucket(now)}`,
      });
    }

    const summary =
      `${funnel.last7d.started} starts this week` +
      (wow === null ? "" : ` (${wow >= 0 ? "+" : ""}${formatPercent(wow)} WoW)`) +
      `, ${activeVenues.length}/${liveVenues.length} venues active, ${dormant.length} dormant.`;

    return {
      summary,
      observations,
      proposals,
      memory:
        wow !== null && Math.abs(wow) >= 0.3
          ? [
              {
                kind: "insight",
                content: `Week of ${weekBucket(now)}: starts moved ${formatPercent(wow)} WoW to ${funnel.last7d.started}.`,
                importance: 0.6,
                tags: ["growth", "weekly"],
              },
            ]
          : [],
      metrics: [
        { metricKey: "growth.sessions_7d", value: funnel.last7d.started },
        { metricKey: "growth.active_venues_7d", value: activeVenues.length },
        { metricKey: "growth.start_to_ready_rate", value: round(startToReady, 4) },
        { metricKey: "growth.dormant_venues", value: dormant.length },
      ],
    };
  },
};
