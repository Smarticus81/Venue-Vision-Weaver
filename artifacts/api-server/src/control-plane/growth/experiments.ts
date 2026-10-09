import { db, agentTasksTable, controlExperimentsTable, type ControlExperiment } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { recordAuditEvent } from "../audit.js";
import type { BusinessMetrics } from "../metrics.js";
import { latestGrowthSnapshot, snapshotMetrics } from "../metrics.js";
import { activationMinPhotos, experimentMinN, guardMinSends, trialDays } from "./config.js";
import { computeGrowthKpis, defaultGrowthLoaders } from "./kpi.js";
import { DAY_MS } from "./kpiMath.js";
import type { GrowthKpis, GrowthLoaders } from "./kpiTypes.js";
import { METRIC_KEYS, parseSegment, type MetricSource } from "./metricKeys.js";

/*
 * Experiment lifecycle (growth-loop.md section 8). Cards carry a primary
 * metric key, a baseline, the lift worth acting on, an optional kill
 * threshold and a decision date; a deterministic evaluator (no model) reads
 * the latest snapshot and decides win / kill / inconclusive. Agents create
 * cards and may start or abort them; completion is decided by the evaluator
 * or an operator.
 */

export interface ExperimentCard {
  id: number;
  status: string;
  primaryMetricKey: string | null;
  baseline: number | null;
  minDetectableLift: number | null;
  killThreshold: number | null;
  decisionDate: Date | null;
  segment: string | null;
  variantKey: string | null;
  startedAt: Date | null;
}

export type EvaluationDecision = "continue" | "win" | "kill" | "inconclusive" | "not_measurable";

export interface Evaluation {
  decision: EvaluationDecision;
  observedValue: number | null;
  n: number;
  baseline: number | null;
  target: number | null;
  requiredN: number | null;
  underpowered: boolean;
  reason: string;
  evaluatedAt: string;
}

export type ExperimentSnapshot = BusinessMetrics & { growth: GrowthKpis };

export const MIN_DECISION_DAYS = 7;
export const MAX_DECISION_DAYS = 60;
export const MAX_OPEN_EXPERIMENTS = 3;

export function toExperimentCard(row: ControlExperiment): ExperimentCard {
  return {
    id: row.id,
    status: row.status,
    primaryMetricKey: row.primaryMetricKey,
    baseline: row.baseline,
    minDetectableLift: row.minDetectableLift,
    killThreshold: row.killThreshold,
    decisionDate: row.decisionDate,
    segment: row.segment,
    variantKey: row.variantKey,
    startedAt: row.startedAt,
  };
}

/** Two-proportion z-test approximation (alpha 0.05, power 0.8): 15.7 * p(1-p) / (p * lift)^2. */
export function requiredSampleSize(baseline: number | null, minDetectableLift: number | null): number | null {
  if (baseline == null || minDetectableLift == null) return null;
  if (!(baseline > 0 && baseline < 1) || !(minDetectableLift > 0)) return null;
  const effect = baseline * minDetectableLift;
  return Math.ceil((15.7 * baseline * (1 - baseline)) / (effect * effect));
}

export function targetFor(baseline: number | null, minDetectableLift: number | null, direction: "higher" | "lower"): number | null {
  if (baseline == null || minDetectableLift == null) return null;
  const target = direction === "higher" ? baseline * (1 + minDetectableLift) : baseline * (1 - minDetectableLift);
  return Math.round(target * 1_000_000) / 1_000_000;
}

function fmt(value: number | null): string {
  if (value == null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** Pure, deterministic evaluation of one card against a snapshot. */
export function evaluateExperiment(card: ExperimentCard, snapshot: MetricSource, now: Date, minN: number): Evaluation {
  const evaluatedAt = now.toISOString();
  const metric = card.primaryMetricKey ? METRIC_KEYS[card.primaryMetricKey] : undefined;
  if (!metric) {
    return {
      decision: "not_measurable",
      observedValue: null,
      n: 0,
      baseline: card.baseline,
      target: null,
      requiredN: null,
      underpowered: false,
      reason: card.primaryMetricKey ? `unknown primary metric key "${card.primaryMetricKey}"` : "no primary metric key",
      evaluatedAt,
    };
  }
  const read = metric.read(snapshot, { segment: card.segment, variantKey: card.variantKey });
  const target = metric.unit === "rate" || metric.unit === "hours" || metric.unit === "cents" || metric.unit === "count"
    ? targetFor(card.baseline, card.minDetectableLift, metric.direction)
    : null;
  const requiredN = metric.unit === "rate" ? requiredSampleSize(card.baseline, card.minDetectableLift) : null;
  if (!read) {
    return {
      decision: "not_measurable",
      observedValue: null,
      n: 0,
      baseline: card.baseline,
      target,
      requiredN,
      underpowered: false,
      reason: `metric ${metric.key} has no data for scope ${scopeLabel(card)}`,
      evaluatedAt,
    };
  }
  const { value, n } = read;
  const underpowered = requiredN != null && n < requiredN;
  const numbers = `value ${fmt(value)}, n ${n}, baseline ${fmt(card.baseline)}, target ${fmt(target)}`;
  const base: Omit<Evaluation, "decision" | "reason"> = {
    observedValue: value,
    n,
    baseline: card.baseline,
    target,
    requiredN,
    underpowered,
    evaluatedAt,
  };

  if (
    card.killThreshold != null &&
    n >= minN &&
    (metric.direction === "higher" ? value <= card.killThreshold : value >= card.killThreshold)
  ) {
    return {
      ...base,
      decision: "kill",
      reason: `kill threshold ${fmt(card.killThreshold)} crossed (${metric.direction} is better): ${numbers}`,
    };
  }
  if (card.decisionDate == null || now.getTime() < card.decisionDate.getTime()) {
    return {
      ...base,
      decision: "continue",
      reason: `${card.decisionDate ? `decision date ${card.decisionDate.toISOString().slice(0, 10)} not reached` : "no decision date"}: ${numbers}${underpowered ? ` (underpowered: need n ${requiredN})` : ""}`,
    };
  }
  if (n < minN) {
    return { ...base, decision: "inconclusive", reason: `n ${n} below GROWTH_EXPERIMENT_MIN_N (${minN}) at the decision date: ${numbers}` };
  }
  if (target == null || card.baseline == null) {
    return { ...base, decision: "inconclusive", reason: `no baseline/lift to compare against: ${numbers}` };
  }
  if (target === card.baseline) {
    // A baseline of 0 (or a rate already at its bound) makes the target equal
    // the baseline, so "no change" would read as a win.
    return { ...base, decision: "inconclusive", reason: `the target equals the baseline, so a lift cannot be measured: ${numbers}` };
  }
  // A win needs a strict improvement over the baseline as well as the target.
  const won =
    metric.direction === "higher" ? value >= target && value > card.baseline : value <= target && value < card.baseline;
  if (won) return { ...base, decision: "win", reason: `reached target (${metric.direction} is better): ${numbers}` };
  const worse = metric.direction === "higher" ? value < card.baseline : value > card.baseline;
  if (worse) return { ...base, decision: "kill", reason: `moved against the baseline (${metric.direction} is better): ${numbers}` };
  return { ...base, decision: "inconclusive", reason: `between baseline and target at the decision date: ${numbers}` };
}

function scopeLabel(card: Pick<ExperimentCard, "segment" | "variantKey">): string {
  const parts = [card.segment ? `segment ${card.segment}` : null, card.variantKey ? `variant ${card.variantKey}` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "whole business";
}

/* ————— Validation shared by the agent tool and the operator route ————— */

export interface ExperimentCardInput {
  name: string;
  hypothesis: string;
  metric: string;
  primaryMetricKey: string;
  segment?: string | null;
  variantKey?: string | null;
  baseline?: number | null;
  minDetectableLift: number;
  killThreshold?: number | null;
  decisionDate: string | Date;
  assignments?: Record<string, unknown> | null;
  variants?: Record<string, unknown> | null;
  startNow?: boolean;
}

export class ExperimentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentValidationError";
  }
}

function parseDecisionDate(raw: string | Date, now: Date, minDays: number, maxDays: number): Date {
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) throw new ExperimentValidationError("decisionDate must be an ISO date.");
  const daysAhead = (date.getTime() - now.getTime()) / DAY_MS;
  if (daysAhead < minDays || daysAhead > maxDays) {
    throw new ExperimentValidationError(`decisionDate must be ${minDays}-${maxDays} days ahead (got ${daysAhead.toFixed(1)} days).`);
  }
  return date;
}

export function validateScope(primaryMetricKey: string, segment: string | null | undefined, variantKey: string | null | undefined): void {
  const metric = METRIC_KEYS[primaryMetricKey];
  if (!metric) {
    throw new ExperimentValidationError(`Unknown primaryMetricKey "${primaryMetricKey}". Known keys: ${Object.keys(METRIC_KEYS).join(", ")}.`);
  }
  if (segment) {
    if (!metric.supportsSegment) throw new ExperimentValidationError(`${metric.key} cannot be scoped to a segment.`);
    if (!parseSegment(segment)) throw new ExperimentValidationError(`segment must look like "region:Hill Country" or "venue_type:barn_farm".`);
  }
  if (variantKey && !metric.supportsVariant) throw new ExperimentValidationError(`${metric.key} cannot be scoped to a copy variant.`);
  if (segment && variantKey) throw new ExperimentValidationError("An experiment is scoped to a segment or a variant, not both.");
}

/**
 * Loaders limited to what happened since the experiment started: emails sent
 * (or drafted) and organizations created at or after startedAt, ledger and
 * legacy sends from then on. Prospects stay whole (attribution needs them).
 */
export function loadersSince(base: GrowthLoaders, startedAt: Date): GrowthLoaders {
  const from = (since: Date) => (since.getTime() > startedAt.getTime() ? since : startedAt);
  return {
    ...base,
    orgs: async () => (await base.orgs()).filter((org) => org.createdAt.getTime() >= startedAt.getTime()),
    emails: async (since) =>
      (await base.emails(from(since))).filter((email) => (email.sentAt ?? email.createdAt).getTime() >= startedAt.getTime()),
    legacySends: (since) => base.legacySends(from(since)),
    ledger: (since) => base.ledger(from(since)),
    venueCreatedAts: async (since) => (await base.venueCreatedAts(since)).filter((at) => at.getTime() >= startedAt.getTime()),
  };
}

/**
 * The readout for one card covers data since the card started (not the
 * rolling all-time / 30-day figures, which are mostly pre-experiment). Live
 * session metrics are not windowed and come from the snapshot. Falls back to
 * the snapshot when the card has not started or the scoped load fails.
 */
async function sourceForCard(row: Pick<ControlExperiment, "id" | "startedAt">, snapshot: MetricSource, now: Date): Promise<MetricSource> {
  if (!row.startedAt) return snapshot;
  try {
    const minPhotos = activationMinPhotos();
    const growth = await computeGrowthKpis(loadersSince(defaultGrowthLoaders(minPhotos), row.startedAt), now, {
      minPhotos,
      trialDays: trialDays(),
      minSendsForGuard: guardMinSends(),
    });
    return { growth, sessions: snapshot.sessions };
  } catch (err) {
    logger.warn({ err, experimentId: row.id }, "Scoped experiment readout failed; using the latest snapshot");
    return snapshot;
  }
}

async function latestSource(): Promise<MetricSource | null> {
  const snapshot = await latestGrowthSnapshot();
  return snapshot ? { growth: snapshot.growth, sessions: snapshot.metrics.sessions } : null;
}

async function readBaseline(primaryMetricKey: string, segment: string | null, variantKey: string | null): Promise<number> {
  let source = await latestSource();
  if (!source) {
    const snap = await snapshotMetrics();
    source = snap.metrics.growth ? { growth: snap.metrics.growth, sessions: snap.metrics.sessions } : null;
  }
  const metric = METRIC_KEYS[primaryMetricKey];
  const read = source && metric ? metric.read(source, { segment, variantKey }) : null;
  if (!read) throw new ExperimentValidationError(`${primaryMetricKey} has no data for this scope yet; pass an explicit baseline or widen the scope.`);
  return read.value;
}

export type CreateExperimentOutcome =
  | { created: true; experiment: ControlExperiment }
  | { created: false; reason: "portfolio_full" | "duplicate_experiment"; existingExperimentId?: number; open?: number };

export async function createExperimentCard(input: ExperimentCardInput, createdBy: string, now = new Date()): Promise<CreateExperimentOutcome> {
  const name = input.name.trim();
  const hypothesis = input.hypothesis.trim();
  const metricText = input.metric.trim();
  if (name.length < 3 || hypothesis.length < 10 || metricText.length < 3) {
    throw new ExperimentValidationError("name (3+ chars), hypothesis (10+ chars) and metric (3+ chars) are required.");
  }
  if (!(input.minDetectableLift > 0 && input.minDetectableLift <= 5)) {
    throw new ExperimentValidationError("minDetectableLift must be in (0, 5] (0.25 = +25%).");
  }
  const segment = input.segment?.trim() || null;
  const variantKey = input.variantKey?.trim() || null;
  validateScope(input.primaryMetricKey, segment, variantKey);
  const decisionDate = parseDecisionDate(input.decisionDate, now, MIN_DECISION_DAYS, MAX_DECISION_DAYS);

  const [duplicate] = await db
    .select({ id: controlExperimentsTable.id })
    .from(controlExperimentsTable)
    .where(and(eq(controlExperimentsTable.name, name), inArray(controlExperimentsTable.status, ["proposed", "running"])))
    .limit(1);
  if (duplicate) return { created: false, reason: "duplicate_experiment", existingExperimentId: duplicate.id };

  const [open] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(controlExperimentsTable)
    .where(inArray(controlExperimentsTable.status, ["proposed", "running"]));
  if ((open?.total ?? 0) >= MAX_OPEN_EXPERIMENTS) return { created: false, reason: "portfolio_full", open: open?.total ?? 0 };

  const baseline = input.baseline != null && Number.isFinite(input.baseline) ? input.baseline : await readBaseline(input.primaryMetricKey, segment, variantKey);

  const [experiment] = await db
    .insert(controlExperimentsTable)
    .values({
      name,
      hypothesis,
      metric: metricText,
      variants: input.variants ?? null,
      status: input.startNow ? "running" : "proposed",
      startedAt: input.startNow ? now : null,
      createdByAgent: createdBy,
      primaryMetricKey: input.primaryMetricKey,
      baseline,
      minDetectableLift: input.minDetectableLift,
      killThreshold: input.killThreshold ?? null,
      decisionDate,
      segment,
      variantKey,
      assignments: input.assignments ?? null,
      updatedAt: now,
    })
    .returning();
  if (!experiment) throw new Error("Failed to create the experiment.");
  await recordAuditEvent({
    actorType: createdBy.startsWith("operator:") ? "operator" : "agent",
    actor: createdBy,
    eventType: "experiment_created",
    subjectType: "experiment",
    subjectId: experiment.id,
    detail: { name, primaryMetricKey: input.primaryMetricKey, baseline, minDetectableLift: input.minDetectableLift, decisionDate: decisionDate.toISOString(), segment, variantKey, startNow: Boolean(input.startNow) },
  });
  return { created: true, experiment };
}

export interface ExperimentCardPatch {
  hypothesis?: string;
  segment?: string | null;
  variantKey?: string | null;
  baseline?: number | null;
  minDetectableLift?: number;
  killThreshold?: number | null;
  decisionDate?: string | Date;
  assignments?: Record<string, unknown> | null;
  /** "running" starts a proposed card; "aborted" (agents) stops it with a result. */
  status?: "running" | "aborted";
  result?: string | null;
}

export class ExperimentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentStateError";
  }
}

export async function updateExperimentCard(experimentId: number, patch: ExperimentCardPatch, actor: string, now = new Date()): Promise<ControlExperiment> {
  const [existing] = await db.select().from(controlExperimentsTable).where(eq(controlExperimentsTable.id, experimentId)).limit(1);
  if (!existing) throw new ExperimentStateError(`Experiment ${experimentId} not found.`);
  if (existing.status !== "proposed" && existing.status !== "running") {
    throw new ExperimentStateError(`Experiment ${experimentId} is ${existing.status}; only proposed or running cards can be edited.`);
  }
  const set: Partial<typeof controlExperimentsTable.$inferInsert> = { updatedAt: now };
  if (patch.hypothesis !== undefined) {
    const hypothesis = patch.hypothesis.trim();
    if (hypothesis.length < 10) throw new ExperimentValidationError("hypothesis must be at least 10 characters.");
    set.hypothesis = hypothesis;
  }
  const segment = patch.segment !== undefined ? patch.segment?.trim() || null : existing.segment;
  const variantKey = patch.variantKey !== undefined ? patch.variantKey?.trim() || null : existing.variantKey;
  if (patch.segment !== undefined || patch.variantKey !== undefined) {
    if (existing.primaryMetricKey) validateScope(existing.primaryMetricKey, segment, variantKey);
    set.segment = segment;
    set.variantKey = variantKey;
  }
  if (patch.baseline !== undefined) set.baseline = patch.baseline;
  if (patch.minDetectableLift !== undefined) {
    if (!(patch.minDetectableLift > 0 && patch.minDetectableLift <= 5)) throw new ExperimentValidationError("minDetectableLift must be in (0, 5].");
    set.minDetectableLift = patch.minDetectableLift;
  }
  if (patch.killThreshold !== undefined) set.killThreshold = patch.killThreshold;
  if (patch.decisionDate !== undefined) set.decisionDate = parseDecisionDate(patch.decisionDate, now, 1, MAX_DECISION_DAYS);
  if (patch.assignments !== undefined) set.assignments = patch.assignments;

  if (patch.status === "running") {
    if (existing.status !== "proposed") throw new ExperimentStateError(`Experiment ${experimentId} is already ${existing.status}.`);
    set.status = "running";
    set.startedAt = now;
    const baselineNow = set.baseline !== undefined ? set.baseline : existing.baseline;
    if (baselineNow == null && existing.primaryMetricKey) {
      set.baseline = await readBaseline(existing.primaryMetricKey, segment, variantKey);
    }
  } else if (patch.status === "aborted") {
    const result = patch.result?.trim();
    if (!result) throw new ExperimentValidationError("result is required when aborting an experiment.");
    set.status = "aborted";
    set.endedAt = now;
    set.result = result;
    set.decision = "kill";
    set.decidedBy = actor;
    set.decidedAt = now;
  } else if (patch.result !== undefined) {
    set.result = patch.result;
  }

  const [updated] = await db.update(controlExperimentsTable).set(set).where(eq(controlExperimentsTable.id, experimentId)).returning();
  if (!updated) throw new ExperimentStateError(`Experiment ${experimentId} not found.`);
  await recordAuditEvent({
    actorType: actor.startsWith("operator:") ? "operator" : actor.startsWith("system:") ? "system" : "agent",
    actor,
    eventType: "experiment_updated",
    subjectType: "experiment",
    subjectId: experimentId,
    detail: { status: updated.status, changed: Object.keys(set).filter((k) => k !== "updatedAt") },
  });
  return updated;
}

/* ————— Evaluation and decisions ————— */

function evaluationRecord(evaluation: Evaluation): Record<string, unknown> {
  return { ...evaluation };
}

/**
 * Evaluate one card against the latest snapshot (taking one when none exists).
 * Persists the readout (evaluation / observedValue / observedN) unless
 * `persist` is false; never changes the status.
 */
export async function evaluateExperimentById(
  experimentId: number,
  now = new Date(),
  options: { persist?: boolean } = {},
): Promise<{ experiment: ControlExperiment; evaluation: Evaluation }> {
  const [row] = await db.select().from(controlExperimentsTable).where(eq(controlExperimentsTable.id, experimentId)).limit(1);
  if (!row) throw new ExperimentStateError(`Experiment ${experimentId} not found.`);
  let source = await latestSource();
  if (!source) {
    const snap = await snapshotMetrics();
    source = snap.metrics.growth ? { growth: snap.metrics.growth, sessions: snap.metrics.sessions } : null;
  }
  const evaluation = source
    ? evaluateExperiment(toExperimentCard(row), await sourceForCard(row, source, now), now, experimentMinN())
    : {
        decision: "not_measurable" as const,
        observedValue: null,
        n: 0,
        baseline: row.baseline,
        target: null,
        requiredN: null,
        underpowered: false,
        reason: "no KPI snapshot available yet",
        evaluatedAt: now.toISOString(),
      };
  if (options.persist === false) return { experiment: row, evaluation };
  const [updated] = await db
    .update(controlExperimentsTable)
    .set({ evaluation: evaluationRecord(evaluation), observedValue: evaluation.observedValue, observedN: evaluation.n, updatedAt: now })
    .where(eq(controlExperimentsTable.id, experimentId))
    .returning();
  return { experiment: updated ?? row, evaluation };
}

async function ensureTask(agentKey: string, title: string, detail: string, priority: "low" | "medium" | "high" | "critical", category: string): Promise<void> {
  const [existing] = await db
    .select({ id: agentTasksTable.id })
    .from(agentTasksTable)
    .where(and(eq(agentTasksTable.title, title), sql`${agentTasksTable.status} in ('open', 'in_progress')`))
    .limit(1);
  if (existing) return;
  await db.insert(agentTasksTable).values({ agentKey, title, detail, category, priority });
}

export type FinalDecision = "win" | "kill" | "inconclusive" | "extended";

export async function applyExperimentDecision(
  experimentId: number,
  decision: FinalDecision,
  actor: string,
  note: string | null,
  options: { newDecisionDate?: Date; evaluation?: Evaluation; now?: Date } = {},
): Promise<ControlExperiment> {
  const now = options.now ?? new Date();
  const [existing] = await db.select().from(controlExperimentsTable).where(eq(controlExperimentsTable.id, experimentId)).limit(1);
  if (!existing) throw new ExperimentStateError(`Experiment ${experimentId} not found.`);
  if (existing.status !== "running") {
    throw new ExperimentStateError(`Experiment ${experimentId} is ${existing.status}; only running experiments can be decided.`);
  }
  const set: Partial<typeof controlExperimentsTable.$inferInsert> = {
    decision,
    decidedBy: actor,
    decidedAt: now,
    result: note?.trim() || options.evaluation?.reason || existing.result || null,
    updatedAt: now,
  };
  if (options.evaluation) {
    set.evaluation = evaluationRecord(options.evaluation);
    set.observedValue = options.evaluation.observedValue;
    set.observedN = options.evaluation.n;
  }
  if (decision === "extended") {
    const next = options.newDecisionDate;
    if (!next || Number.isNaN(next.getTime())) throw new ExperimentValidationError("newDecisionDate is required to extend an experiment.");
    const daysAhead = (next.getTime() - now.getTime()) / DAY_MS;
    if (daysAhead <= 0 || daysAhead > MAX_DECISION_DAYS) {
      throw new ExperimentValidationError(`newDecisionDate must be in the future and at most ${MAX_DECISION_DAYS} days ahead.`);
    }
    set.decisionDate = next;
  } else {
    set.status = decision === "kill" ? "aborted" : "completed";
    set.endedAt = now;
  }
  const [updated] = await db.update(controlExperimentsTable).set(set).where(eq(controlExperimentsTable.id, experimentId)).returning();
  if (!updated) throw new ExperimentStateError(`Experiment ${experimentId} not found.`);

  await recordAuditEvent({
    actorType: actor.startsWith("operator:") ? "operator" : "system",
    actor,
    eventType: "experiment_decided",
    subjectType: "experiment",
    subjectId: experimentId,
    detail: {
      decision,
      observedValue: options.evaluation?.observedValue ?? existing.observedValue ?? null,
      n: options.evaluation?.n ?? existing.observedN ?? null,
      baseline: existing.baseline,
      target: options.evaluation?.target ?? null,
      note: note ?? null,
      newDecisionDate: options.newDecisionDate?.toISOString() ?? null,
    },
  });

  if (decision === "win" || decision === "kill") {
    try {
      await ensureTask(
        "growth",
        `Act on experiment #${experimentId}: ${decision} — ${existing.name}`,
        `${set.result ?? "No readout recorded."}\n\nIf this was a segment/variant test, the adaptation rules will pick it up on the next snapshot; confirm the campaign/variant change in /control -> Growth.`,
        decision === "win" ? "high" : "medium",
        "growth",
      );
    } catch (err) {
      logger.warn({ err, experimentId }, "Could not create the experiment follow-up task");
    }
  }
  return updated;
}

/** Scheduler step: evaluate every running card against a fresh snapshot and apply final decisions. */
export async function runExperimentDecisions(snapshot: ExperimentSnapshot, snapshotId: number, now = new Date()): Promise<{ evaluated: number; decided: number }> {
  const running = await db.select().from(controlExperimentsTable).where(eq(controlExperimentsTable.status, "running"));
  const minN = experimentMinN();
  const source: MetricSource = { growth: snapshot.growth, sessions: snapshot.sessions };
  let decided = 0;
  for (const row of running) {
    try {
      const evaluation = evaluateExperiment(toExperimentCard(row), await sourceForCard(row, source, now), now, minN);
      await db
        .update(controlExperimentsTable)
        .set({ evaluation: { ...evaluationRecord(evaluation), snapshotId }, observedValue: evaluation.observedValue, observedN: evaluation.n, updatedAt: now })
        .where(eq(controlExperimentsTable.id, row.id));
      if (evaluation.decision === "win" || evaluation.decision === "kill" || evaluation.decision === "inconclusive") {
        await applyExperimentDecision(row.id, evaluation.decision, "system:evaluator", null, { evaluation, now });
        decided += 1;
      } else if (evaluation.decision === "not_measurable") {
        await ensureTask(
          "growth",
          `Experiment #${row.id} is not measurable`,
          `${evaluation.reason}. Fix the metric key or scope, or abort the experiment.`,
          "medium",
          "growth",
        );
      }
    } catch (err) {
      logger.error({ err, experimentId: row.id }, "Experiment evaluation failed");
    }
  }
  return { evaluated: running.length, decided };
}
