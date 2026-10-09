import { db, controlExperimentsTable, EXPERIMENT_STATUSES } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { latestGrowthSnapshot, previousGrowthSnapshot, snapshotMetrics, type GrowthSnapshot } from "../metrics.js";
import { num, str, type ControlPlaneTool } from "../toolTypes.js";
import { experimentMinN } from "./config.js";
import {
  ExperimentStateError,
  ExperimentValidationError,
  MAX_DECISION_DAYS,
  MAX_OPEN_EXPERIMENTS,
  MIN_DECISION_DAYS,
  createExperimentCard,
  evaluateExperimentById,
  updateExperimentCard,
  type ExperimentCardPatch,
} from "./experiments.js";
import { loadGrowthGuidance } from "./guidance.js";
import { kpiDeltas } from "./kpiMath.js";
import type { GrowthKpis } from "./kpiTypes.js";
import { METRIC_KEYS, describeMetricKeys } from "./metricKeys.js";

/*
 * Growth-owned agent tools, merged into the registry by tools.ts
 * (`{ ...CORE_TOOLS, ...vettingTools, ...growthTools }`). Experiments are
 * typed cards evaluated by code (growth-loop.md 8.4); the KPI and guidance
 * tools read the latest snapshot and the deterministic adaptation state
 * (11.2). Nothing here calls a model or a vendor.
 */

const KPI_SECTIONS = ["signups", "activation", "trialToPaid", "revenue", "credits", "churn", "outbound", "deliverability", "experiments", "all"] as const;
type KpiSection = (typeof KPI_SECTIONS)[number];

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function optionalObject(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Tool-facing error text: validation/state errors are the agent's to fix, so keep their message verbatim. */
function rethrowForAgent(err: unknown): never {
  if (err instanceof ExperimentValidationError || err instanceof ExperimentStateError) throw new Error(err.message);
  throw err;
}

async function snapshotForTools(fresh: boolean): Promise<GrowthSnapshot> {
  if (!fresh) {
    const latest = await latestGrowthSnapshot();
    if (latest) return latest;
  }
  const taken = await snapshotMetrics();
  if (!taken.metrics.growth) {
    throw new Error("The growth KPI document could not be computed (a loader failed); check the server logs.");
  }
  return {
    snapshotId: taken.snapshotId,
    createdAt: taken.createdAt,
    metrics: taken.metrics as GrowthSnapshot["metrics"],
    growth: taken.metrics.growth,
  };
}

export const growthTools: Record<string, ControlPlaneTool> = {
  list_experiments: {
    declaration: {
      name: "list_experiments",
      description:
        "Experiment cards with hypothesis, primary metric key, baseline, target lift, decision date, scope (segment/variant), status, latest evaluator readout and decision.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: [...EXPERIMENT_STATUSES], description: "Optional status filter." },
          limit: { type: "integer", description: "Max rows (default 20, max 50)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 20, 50);
      const status = str(args.status);
      const rows = await db
        .select()
        .from(controlExperimentsTable)
        .where(status && (EXPERIMENT_STATUSES as readonly string[]).includes(status) ? eq(controlExperimentsTable.status, status) : undefined)
        .orderBy(desc(controlExperimentsTable.createdAt))
        .limit(limit);
      return { experiments: rows, portfolioLimit: MAX_OPEN_EXPERIMENTS };
    },
  },

  create_experiment: {
    declaration: {
      name: "create_experiment",
      description:
        `Register an experiment card (status: proposed) with a falsifiable hypothesis, ONE primary metric key from the registry, the minimum relative lift worth acting on, and a decision date ${MIN_DECISION_DAYS}-${MAX_DECISION_DAYS} days out. The deterministic evaluator decides win/kill/inconclusive at the decision date; baseline is read from the latest KPI snapshot when omitted. At most ${MAX_OPEN_EXPERIMENTS} cards may be proposed or running. Metric keys: ${describeMetricKeys()}.`,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short card title (3-120 chars)." },
          hypothesis: { type: "string", description: "Falsifiable statement being tested (10+ chars)." },
          metric: { type: "string", description: "Human-readable description of the success metric." },
          primaryMetricKey: { type: "string", enum: Object.keys(METRIC_KEYS), description: "Registry key the evaluator reads." },
          segment: { type: "string", description: "Optional 'region:<Region>' or 'venue_type:<type>' scope (outbound keys only)." },
          variantKey: { type: "string", description: "Optional control_copy_variants.key under test (outbound keys only; not with segment)." },
          baseline: { type: "number", description: "Current metric value; omitted = read from the latest snapshot now." },
          minDetectableLift: { type: "number", description: "Relative lift worth acting on, e.g. 0.25 = +25%." },
          killThreshold: { type: "number", description: "Absolute metric value at/below which (above, for lower-is-better) the card is killed early." },
          decisionDate: { type: "string", description: `ISO date ${MIN_DECISION_DAYS}-${MAX_DECISION_DAYS} days ahead.` },
          assignments: { type: "object", description: "Free-form {control: {...}, treatment: {...}} assignment description." },
          variants: { type: "object", description: "Optional variant descriptions for humans." },
        },
        required: ["name", "hypothesis", "metric", "primaryMetricKey", "minDetectableLift", "decisionDate"],
      },
    },
    async execute(args, ctx) {
      const name = str(args.name);
      const hypothesis = str(args.hypothesis);
      const metric = str(args.metric);
      const primaryMetricKey = str(args.primaryMetricKey);
      const decisionDate = str(args.decisionDate);
      const minDetectableLift = Number(args.minDetectableLift);
      if (!name || !hypothesis || !metric || !primaryMetricKey || !decisionDate || !Number.isFinite(minDetectableLift)) {
        throw new Error("name, hypothesis, metric, primaryMetricKey, minDetectableLift and decisionDate are required.");
      }
      try {
        return await createExperimentCard(
          {
            name,
            hypothesis,
            metric,
            primaryMetricKey,
            segment: str(args.segment),
            variantKey: str(args.variantKey),
            baseline: optionalNumber(args.baseline),
            minDetectableLift,
            killThreshold: optionalNumber(args.killThreshold),
            decisionDate,
            assignments: optionalObject(args.assignments),
            variants: optionalObject(args.variants),
          },
          ctx.agentKey,
        );
      } catch (err) {
        return rethrowForAgent(err);
      }
    },
  },

  update_experiment: {
    declaration: {
      name: "update_experiment",
      description:
        "Edit a proposed/running card (hypothesis, scope, lift, kill threshold, decision date, assignments), start a proposed card (status running; the baseline is re-read if missing), or abort a broken premise (status aborted, result required). Completion is decided by the evaluator or an operator, never here.",
      parameters: {
        type: "object",
        properties: {
          experimentId: { type: "integer" },
          status: { type: "string", enum: [...EXPERIMENT_STATUSES], description: "running (start) or aborted (stop). completed is refused." },
          result: { type: "string", description: "Readout / learnings. Required when aborting." },
          hypothesis: { type: "string" },
          segment: { type: "string", description: "'region:<Region>' | 'venue_type:<type>' | empty string to clear." },
          variantKey: { type: "string", description: "Copy variant key or empty string to clear." },
          baseline: { type: "number" },
          minDetectableLift: { type: "number" },
          killThreshold: { type: "number" },
          decisionDate: { type: "string", description: `ISO date, at most ${MAX_DECISION_DAYS} days ahead.` },
          assignments: { type: "object" },
        },
        required: ["experimentId"],
      },
    },
    async execute(args, ctx) {
      const experimentId = num(args.experimentId, 0, Number.MAX_SAFE_INTEGER);
      if (!experimentId) throw new Error("experimentId is required.");
      const status = str(args.status);
      if (status === "completed") {
        return { updated: false, reason: "completion is decided by the evaluator or an operator" };
      }
      if (status === "proposed") {
        return { updated: false, reason: "cards are created as proposed; use create_experiment" };
      }
      if (status && status !== "running" && status !== "aborted") {
        throw new Error(`status must be running or aborted (got "${status}").`);
      }
      const patch: ExperimentCardPatch = {};
      if (status === "running" || status === "aborted") patch.status = status;
      const result = str(args.result);
      if (result !== null) patch.result = result;
      const hypothesis = str(args.hypothesis);
      if (hypothesis !== null) patch.hypothesis = hypothesis;
      if (typeof args.segment === "string") patch.segment = args.segment.trim() || null;
      if (typeof args.variantKey === "string") patch.variantKey = args.variantKey.trim() || null;
      const baseline = optionalNumber(args.baseline);
      if (baseline !== undefined) patch.baseline = baseline;
      const lift = optionalNumber(args.minDetectableLift);
      if (lift != null) patch.minDetectableLift = lift;
      const kill = optionalNumber(args.killThreshold);
      if (kill !== undefined) patch.killThreshold = kill;
      const decisionDate = str(args.decisionDate);
      if (decisionDate !== null) patch.decisionDate = decisionDate;
      const assignments = optionalObject(args.assignments);
      if (assignments !== undefined) patch.assignments = assignments;
      try {
        const experiment = await updateExperimentCard(experimentId, patch, ctx.agentKey);
        return { updated: true, experiment };
      } catch (err) {
        return rethrowForAgent(err);
      }
    },
  },

  get_growth_kpis: {
    declaration: {
      name: "get_growth_kpis",
      description:
        "Outcome KPIs from the latest snapshot: signups by week, activation funnel and time to first gallery, trial-to-paid by cohort (paid = subscription or credit pack), plan mix and MRR estimate, credits, churn, outbound funnel by segment/variant/campaign/step, deliverability. Pass section to get one part; section 'all' also returns the headline deltas against the previous snapshot.",
      parameters: {
        type: "object",
        properties: {
          section: { type: "string", enum: [...KPI_SECTIONS] },
          fresh: { type: "boolean", description: "Recompute now instead of using the latest snapshot (slow)." },
        },
      },
    },
    async execute(args) {
      const requested = str(args.section);
      const section: KpiSection = requested && (KPI_SECTIONS as readonly string[]).includes(requested) ? (requested as KpiSection) : "all";
      const snapshot = await snapshotForTools(args.fresh === true);
      const growth = snapshot.growth;
      if (section !== "all") {
        return {
          snapshotId: snapshot.snapshotId,
          computedAt: growth.computedAt,
          kpis: { [section]: growth[section as keyof GrowthKpis] },
          dataQuality: growth.dataQuality,
        };
      }
      const previous = await previousGrowthSnapshot(snapshot.snapshotId).catch(() => null);
      return {
        snapshotId: snapshot.snapshotId,
        computedAt: growth.computedAt,
        kpis: growth,
        deltas: kpiDeltas(growth, previous?.growth ?? null).map((d) => ({
          key: d.key,
          label: d.label,
          unit: d.unit,
          current: d.current,
          previous: d.previous,
          delta: d.delta,
          tone: d.tone,
        })),
        previousSnapshotAt: previous?.createdAt.toISOString() ?? null,
      };
    },
  },

  get_growth_guidance: {
    declaration: {
      name: "get_growth_guidance",
      description:
        "Deterministic adaptation state: segment prioritize/pause lists with their rates, deliverability guard and effective daily cap, copy variants with weights and stats, campaign step cap, and the last 10 rule firings.",
      parameters: { type: "object", properties: {} },
    },
    async execute() {
      const latest = await latestGrowthSnapshot().catch(() => null);
      const guidance = await loadGrowthGuidance({ kpis: latest?.growth ?? null, adaptationLimit: 10 });
      return {
        ...guidance,
        snapshotId: latest?.snapshotId ?? null,
        computedAt: latest?.growth.computedAt ?? null,
      };
    },
  },

  evaluate_experiment: {
    declaration: {
      name: "evaluate_experiment",
      description:
        "Run the deterministic evaluator for one experiment against the latest snapshot and return what it would decide today. Does not change the experiment.",
      parameters: {
        type: "object",
        properties: { experimentId: { type: "integer" } },
        required: ["experimentId"],
      },
    },
    async execute(args) {
      const experimentId = num(args.experimentId, 0, Number.MAX_SAFE_INTEGER);
      if (!experimentId) throw new Error("experimentId is required.");
      try {
        const { experiment, evaluation } = await evaluateExperimentById(experimentId, new Date(), { persist: false });
        return {
          experimentId,
          status: experiment.status,
          primaryMetricKey: experiment.primaryMetricKey,
          decisionDate: experiment.decisionDate?.toISOString() ?? null,
          minN: experimentMinN(),
          evaluation,
        };
      } catch (err) {
        return rethrowForAgent(err);
      }
    },
  },
};
