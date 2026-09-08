import type {
  AgentContext,
  AgentDefinition,
  AgentOutput,
  DecisionProposal,
  ExperimentSnapshot,
} from "../types.js";
import { clamp, formatPercent, observation, round, twoProportionTest, weekBucket } from "../util.js";

const SIGNIFICANCE_P = 0.05;
const STALE_EXPERIMENT_DAYS = 45;
const MAX_CONCURRENT_RUNNING = 3;

export interface ExperimentVerdict {
  decision: "conclude" | "abort" | "continue";
  winner: string | null;
  note: string;
  p: number | null;
  lift: number | null;
}

/**
 * Decide whether a running experiment has earned a conclusion. An experiment
 * that has not reached its sample size is never called, however tempting the
 * early split looks — that is the whole point of declaring the size up front.
 */
export function judgeExperiment(
  experiment: ExperimentSnapshot,
  ageDays: number,
): ExperimentVerdict {
  const [control, ...challengers] = experiment.variants;
  if (!control || challengers.length === 0) {
    return { decision: "abort", winner: null, note: "Experiment has fewer than two variants", p: null, lift: null };
  }

  const totalExposures = experiment.variants.reduce((sum, variant) => sum + variant.exposures, 0);
  if (totalExposures < experiment.minimumSampleSize) {
    if (ageDays >= STALE_EXPERIMENT_DAYS) {
      return {
        decision: "abort",
        winner: null,
        note:
          `Ran ${Math.round(ageDays)} days and reached ${totalExposures} of ${experiment.minimumSampleSize} ` +
          `required exposures. The surface does not carry enough traffic to settle this question.`,
        p: null,
        lift: null,
      };
    }
    return {
      decision: "continue",
      winner: null,
      note: `${totalExposures}/${experiment.minimumSampleSize} exposures collected`,
      p: null,
      lift: null,
    };
  }

  let best: { variant: (typeof challengers)[number]; p: number; lift: number } | null = null;
  for (const challenger of challengers) {
    const test = twoProportionTest(
      control.conversions,
      control.exposures,
      challenger.conversions,
      challenger.exposures,
    );
    if (!test) continue;
    const lift =
      control.conversionRate > 0
        ? (challenger.conversionRate - control.conversionRate) / control.conversionRate
        : challenger.conversionRate > 0
          ? 1
          : 0;
    if (test.p <= SIGNIFICANCE_P && lift > 0 && (best === null || test.p < best.p)) {
      best = { variant: challenger, p: test.p, lift };
    }
  }

  if (best) {
    return {
      decision: "conclude",
      winner: best.variant.key,
      note:
        `${best.variant.label} converts at ${formatPercent(best.variant.conversionRate)} against ` +
        `${formatPercent(control.conversionRate)} for control — a ${formatPercent(best.lift)} lift, ` +
        `p=${round(best.p, 4)} across ${totalExposures} exposures.`,
      p: best.p,
      lift: best.lift,
    };
  }

  const flat = experiment.variants
    .map((variant) => `${variant.label} ${formatPercent(variant.conversionRate)}`)
    .join(", ");
  return {
    decision: "conclude",
    winner: null,
    note: `Sample size reached with no significant difference (${flat}). Control stands.`,
    p: null,
    lift: null,
  };
}

/**
 * Experiments owns the org's learning rate: what is being tested, whether it
 * has run long enough to mean anything, and what the result changes.
 */
export const experimentsAgent: AgentDefinition = {
  key: "experiments-agent",
  domain: "experiments",
  displayName: "Experiments",
  charter: "Keep a live, powered experiment on every weak surface and call results honestly.",
  defaultIntervalMinutes: 720,
  defaultAutonomy: "supervised",

  run(ctx: AgentContext): AgentOutput {
    const { snapshot, now } = ctx;
    const proposals: DecisionProposal[] = [];
    const running = snapshot.experiments.filter((experiment) => experiment.status === "running");
    const concluded = snapshot.experiments.filter((experiment) => experiment.status === "concluded");

    const totalExposures = running.reduce(
      (sum, experiment) => sum + experiment.variants.reduce((inner, variant) => inner + variant.exposures, 0),
      0,
    );

    const observations = [
      observation("experiments_running", "Experiments running", running.length, {
        goodDirection: "up",
        severity: running.length === 0 ? "warning" : "info",
      }),
      observation("experiments_concluded", "Experiments concluded", concluded.length),
      observation("exposures_in_flight", "Exposures across running tests", totalExposures),
    ];

    for (const experiment of running) {
      const ageDays = experiment.ageDays ?? 0;
      const verdict = judgeExperiment(experiment, ageDays);
      if (verdict.decision === "continue") continue;

      if (verdict.decision === "abort") {
        proposals.push({
          kind: "experiments.abort",
          title: `Abort "${experiment.key}" — underpowered after ${Math.round(ageDays)} days`,
          rationale:
            `${verdict.note} Leaving it running splits traffic without ever producing an answer, which costs ` +
            `more than the question is worth.`,
          effect: { type: "experiment.abort", key: experiment.key, note: verdict.note },
          evidence: { experimentKey: experiment.key, variants: experiment.variants, ageDays },
          confidence: 0.8,
          impactScore: 35,
          dedupeKey: `experiments.abort.${experiment.key}`,
        });
        continue;
      }

      proposals.push({
        kind: "experiments.conclude",
        title: verdict.winner
          ? `Ship "${verdict.winner}" from ${experiment.key}`
          : `Close ${experiment.key} — control stands`,
        rationale:
          `${experiment.hypothesis}\n\n${verdict.note}` +
          (verdict.winner
            ? ` The winning variant should become the default on ${experiment.surface}.`
            : ` No variant beat control, so the surface keeps its current behaviour and the hypothesis is spent.`),
        effect: {
          type: "experiment.conclude",
          key: experiment.key,
          winner: verdict.winner,
          note: verdict.note,
        },
        evidence: {
          experimentKey: experiment.key,
          primaryMetric: experiment.primaryMetric,
          variants: experiment.variants,
          p: verdict.p,
          lift: verdict.lift,
        },
        confidence: verdict.winner ? 0.85 : 0.75,
        impactScore: verdict.winner ? clamp(50 + (verdict.lift ?? 0) * 100, 40, 95) : 30,
        dedupeKey: `experiments.conclude.${experiment.key}`,
      });
    }

    // An org with weak conversion and no live test is not learning anything.
    const startToReady =
      snapshot.funnel.last7d.started > 0
        ? snapshot.funnel.last7d.ready / snapshot.funnel.last7d.started
        : null;
    if (
      running.length < MAX_CONCURRENT_RUNNING &&
      running.length === 0 &&
      snapshot.funnel.last7d.started >= 8 &&
      startToReady !== null &&
      startToReady < 0.85
    ) {
      const key = `share-prompt-${weekBucket(now)}`;
      proposals.push({
        kind: "experiments.launch",
        title: "Launch a share-prompt test on the delivered gallery",
        rationale:
          `Nothing is currently being tested, ${snapshot.funnel.last7d.started} galleries started this week, and ` +
          `${formatPercent(startToReady)} reached delivery. The delivered-gallery screen is the highest-traffic ` +
          `surface with an unmeasured call to action.`,
        effect: {
          type: "experiment.launch",
          key,
          hypothesis:
            "Prompting the couple to share their gallery immediately after delivery increases share-link opens.",
          surface: "gallery_delivered",
          primaryMetric: "share_opened",
          variants: [
            { key: "control", label: "No explicit share prompt", weight: 50 },
            { key: "prompt", label: "Share prompt above the reel", weight: 50 },
          ],
          minimumSampleSize: 150,
        },
        evidence: { started7d: snapshot.funnel.last7d.started, startToReady: round(startToReady, 3) },
        confidence: 0.68,
        impactScore: 50,
        dedupeKey: `experiments.launch.${key}`,
      });
    }

    return {
      summary:
        `${running.length} running, ${concluded.length} concluded, ${totalExposures} exposures in flight.`,
      observations,
      proposals,
      memory: proposals
        .filter((proposal) => proposal.kind === "experiments.conclude")
        .map((proposal) => ({
          kind: "lesson" as const,
          content: `${proposal.title}: ${proposal.rationale.split("\n\n").pop() ?? ""}`.slice(0, 500),
          importance: 0.8,
          tags: ["experiments"],
        })),
      metrics: [
        { metricKey: "experiments.running", value: running.length },
        { metricKey: "experiments.exposures_in_flight", value: totalExposures },
      ],
    };
  },
};
