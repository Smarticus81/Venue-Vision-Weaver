import type { AgentContext, AgentDefinition, AgentOutput, DecisionProposal } from "../types.js";
import {
  FAILURE_FAMILY_LABELS,
  classifyFailure,
  clamp,
  dayBucket,
  formatPercent,
  observation,
  pct,
  round,
  topEntries,
} from "../util.js";

const FAILURE_RATE_ALERT = 0.15;
const FAILURE_RATE_CRITICAL = 0.3;
const SLOW_DELIVERY_MINUTES = 12;
const RETRY_MAX_AGE_HOURS = 12;
const RETRY_PER_TICK = 3;

/**
 * Product repair and upgrades. This agent reads the generation pipeline's own
 * wreckage — failed sessions, their error families, delivery latency — and
 * turns it into either an immediate repair (retry a session that failed for a
 * transient reason) or a durable work item describing what to fix.
 */
export const productAgent: AgentDefinition = {
  key: "product-agent",
  domain: "product",
  displayName: "Product Repair",
  charter: "Keep the generation pipeline healthy and turn failures into fixes.",
  defaultIntervalMinutes: 30,
  defaultAutonomy: "supervised",

  run(ctx: AgentContext): AgentOutput {
    const { snapshot, now } = ctx;
    const { funnel, failures, venues, workItems } = snapshot;
    const proposals: DecisionProposal[] = [];
    const today = dayBucket(now);

    const attempted24h = funnel.last24h.ready + funnel.last24h.failed;
    const failureRate24h = pct(funnel.last24h.failed, attempted24h);
    const attempted7d = funnel.last7d.ready + funnel.last7d.failed;
    const failureRate7d = pct(funnel.last7d.failed, attempted7d);
    const families = topEntries(failures, (failure) => classifyFailure(failure.errorMessage), 4);
    const dominant = families[0] ?? null;
    const medianMinutes = funnel.last7d.medianMinutesToReady;

    const observations = [
      observation("failure_rate_24h", "Generation failure rate, 24h", round(failureRate24h, 3), {
        goodDirection: "down",
        detail: `${funnel.last24h.failed} failed of ${attempted24h} finished`,
        severity:
          failureRate24h >= FAILURE_RATE_CRITICAL
            ? "critical"
            : failureRate24h >= FAILURE_RATE_ALERT
              ? "warning"
              : "info",
      }),
      observation("failure_rate_7d", "Generation failure rate, 7d", round(failureRate7d, 3), {
        goodDirection: "down",
        detail: `${funnel.last7d.failed} failed of ${attempted7d} finished`,
      }),
      observation("median_minutes_to_ready", "Median minutes to delivery", medianMinutes, {
        goodDirection: "down",
        severity:
          medianMinutes !== null && medianMinutes > SLOW_DELIVERY_MINUTES ? "warning" : "info",
      }),
      observation(
        "dominant_failure",
        "Leading failure family",
        dominant ? (FAILURE_FAMILY_LABELS[dominant.key] ?? dominant.key) : "none",
        { detail: dominant ? `${dominant.count} of ${failures.length} recent failures` : undefined },
      ),
      observation("stuck_processing", "Sessions still processing", funnel.last24h.processing, {
        goodDirection: "down",
      }),
    ];

    // Elevated failure rate — file (or refresh) the repair item naming the
    // dominant family, because "generation is failing" is not actionable.
    if (attempted24h >= 4 && failureRate24h >= FAILURE_RATE_ALERT && dominant) {
      const label = FAILURE_FAMILY_LABELS[dominant.key] ?? dominant.key;
      const severity = failureRate24h >= FAILURE_RATE_CRITICAL ? "critical" : "high";
      proposals.push({
        kind: "product.failure_spike",
        title: `${formatPercent(failureRate24h)} of galleries failed in 24h — ${label.toLowerCase()}`,
        rationale:
          `${funnel.last24h.failed} of ${attempted24h} finished galleries failed in the last 24 hours. ` +
          `The largest cluster is "${label}" (${dominant.count} of the ${failures.length} recent failures ` +
          `examined). Each failure costs a couple their gallery and the venue its credit until the refund ` +
          `lands, so this is a repair, not a metric.`,
        effect: {
          type: "workItem.upsert",
          workItem: {
            type: "repair",
            title: `Repair ${label.toLowerCase()} in the gallery pipeline`,
            detail:
              `24h failure rate ${formatPercent(failureRate24h)} (${funnel.last24h.failed}/${attempted24h}). ` +
              `Failure families: ${families.map((family) => `${FAILURE_FAMILY_LABELS[family.key] ?? family.key} ×${family.count}`).join("; ")}. ` +
              `Affected venues: ${[...new Set(failures.map((failure) => failure.venueSlug))].slice(0, 8).join(", ") || "n/a"}.`,
            severity,
            surface: "gallery_pipeline",
            dedupeKey: `product.failure_family.${dominant.key}`,
            evidence: {
              failureRate24h: round(failureRate24h, 4),
              families,
              sampleErrors: failures.slice(0, 5).map((failure) => failure.errorMessage),
            },
          },
        },
        evidence: { failureRate24h: round(failureRate24h, 4), families },
        confidence: 0.88,
        impactScore: clamp(60 + failureRate24h * 100, 0, 100),
        dedupeKey: `product.failure_spike.${dominant.key}.${today}`,
      });
    }

    // Close a standing repair item once its family stops appearing.
    for (const item of workItems.filter(
      (workItem) => workItem.status !== "done" && workItem.dedupeKey.startsWith("product.failure_family."),
    )) {
      const family = item.dedupeKey.replace("product.failure_family.", "");
      const stillFailing = families.some((entry) => entry.key === family);
      if (!stillFailing && failureRate24h < FAILURE_RATE_ALERT) {
        proposals.push({
          kind: "product.failure_cleared",
          title: `"${item.title}" is no longer reproducing`,
          rationale:
            `No failure in the recent window classified as ${FAILURE_FAMILY_LABELS[family] ?? family}, ` +
            `and the 24h failure rate is ${formatPercent(failureRate24h)}. The repair item should close ` +
            `rather than linger and dull the queue.`,
          effect: {
            type: "workItem.close",
            dedupeKey: item.dedupeKey,
            note: `Family no longer observed; 24h failure rate ${formatPercent(failureRate24h)}.`,
          },
          evidence: { workItemId: item.id, family, failureRate24h: round(failureRate24h, 4) },
          confidence: 0.8,
          impactScore: 15,
          dedupeKey: `product.failure_cleared.${family}.${today}`,
        });
      }
    }

    // Transient failures deserve an automatic second attempt; permanent ones
    // (quality gate, bad reference photos) must not be retried in a loop.
    const retryable = failures
      .filter((failure) => failure.ageHours <= RETRY_MAX_AGE_HOURS)
      .filter((failure) => {
        const family = classifyFailure(failure.errorMessage);
        return family === "timeout" || family === "provider_quota" || family === "server_restart";
      })
      .slice(0, RETRY_PER_TICK);

    for (const failure of retryable) {
      const family = classifyFailure(failure.errorMessage);
      proposals.push({
        kind: "product.retry_session",
        title: `Retry gallery #${failure.id} (${FAILURE_FAMILY_LABELS[family] ?? family})`,
        rationale:
          `Gallery #${failure.id} at ${failure.venueSlug} failed ${round(failure.ageHours, 1)}h ago with a ` +
          `transient fault (${family}). A retry costs one generation attempt and, if it succeeds, the couple ` +
          `gets the gallery they were promised without anyone opening a ticket.`,
        effect: {
          type: "session.retry",
          sessionId: failure.id,
          note: `Automatic retry after ${family} failure`,
        },
        evidence: {
          sessionId: failure.id,
          venueSlug: failure.venueSlug,
          family,
          errorMessage: failure.errorMessage,
        },
        confidence: 0.72,
        impactScore: 45,
        dedupeKey: `product.retry.${failure.id}`,
        expiresInHours: 24,
      });
    }

    // Latency is an upgrade, not a repair — file it separately so the two
    // never compete for the same slot in the queue.
    if (medianMinutes !== null && medianMinutes > SLOW_DELIVERY_MINUTES && funnel.last7d.ready >= 5) {
      proposals.push({
        kind: "product.slow_delivery",
        title: `Delivery takes ${round(medianMinutes, 1)} minutes at the median`,
        rationale:
          `Median time from start to delivered gallery is ${round(medianMinutes, 1)} minutes over ` +
          `${funnel.last7d.ready} deliveries, against a ${SLOW_DELIVERY_MINUTES}-minute target. Couples wait ` +
          `on this screen, so latency here reads as failure long before it is one.`,
        effect: {
          type: "workItem.upsert",
          workItem: {
            type: "upgrade",
            title: "Cut median gallery delivery time below the wait threshold",
            detail:
              `Median ${round(medianMinutes, 1)} min over ${funnel.last7d.ready} deliveries in 7 days. ` +
              `Look at generation attempts per frame, quality-gate re-runs, and motion reel encode time.`,
            severity: "medium",
            surface: "gallery_pipeline",
            dedupeKey: "product.slow_delivery",
            evidence: { medianMinutes: round(medianMinutes, 1), deliveries: funnel.last7d.ready },
          },
        },
        evidence: { medianMinutes: round(medianMinutes, 1) },
        confidence: 0.75,
        impactScore: 50,
        dedupeKey: "product.slow_delivery",
      });
    }

    // Venues whose photo coverage is thin produce weaker galleries; that is a
    // product upgrade (guided capture), not an activation nudge.
    const thinCoverage = venues.filter((venue) => venue.ready && venue.coverageGaps.length > 0);
    if (thinCoverage.length >= 3) {
      proposals.push({
        kind: "product.coverage_upgrade",
        title: `${thinCoverage.length} live venues are generating from partial coverage`,
        rationale:
          `${thinCoverage.length} venues can generate but are missing coverage types ` +
          `(${[...new Set(thinCoverage.flatMap((venue) => venue.coverageGaps))].join(", ")}). ` +
          `Frames drawn from partial coverage are the ones the quality gate rejects most.`,
        effect: {
          type: "workItem.upsert",
          workItem: {
            type: "upgrade",
            title: "Guide venues to complete photo coverage during upload",
            detail:
              `${thinCoverage.length} live venues have coverage gaps: ` +
              `${thinCoverage.map((venue) => `${venue.slug} (${venue.coverageGaps.join("/")})`).slice(0, 10).join(", ")}.`,
            severity: "medium",
            surface: "venue_media",
            dedupeKey: "product.coverage_upgrade",
            evidence: { venues: thinCoverage.length },
          },
        },
        evidence: { venues: thinCoverage.map((venue) => venue.slug).slice(0, 10) },
        confidence: 0.7,
        impactScore: 40,
        dedupeKey: "product.coverage_upgrade",
      });
    }

    return {
      summary:
        `24h failure rate ${formatPercent(failureRate24h)} (${funnel.last24h.failed}/${attempted24h})` +
        (dominant ? `, led by ${FAILURE_FAMILY_LABELS[dominant.key] ?? dominant.key}` : "") +
        `; median delivery ${medianMinutes === null ? "n/a" : `${round(medianMinutes, 1)} min`}.`,
      observations,
      proposals,
      memory: dominant
        ? [
            {
              kind: "fact",
              content: `${today}: leading failure family was ${FAILURE_FAMILY_LABELS[dominant.key] ?? dominant.key} (${dominant.count} occurrences).`,
              importance: 0.5,
              tags: ["product", "failures", dominant.key],
            },
          ]
        : [],
      metrics: [
        { metricKey: "product.failure_rate_24h", value: round(failureRate24h, 4) },
        { metricKey: "product.failure_rate_7d", value: round(failureRate7d, 4) },
        ...(medianMinutes === null
          ? []
          : [{ metricKey: "product.median_minutes_to_ready", value: round(medianMinutes, 2) }]),
      ],
    };
  },
};
