import { Router, type IRouter, type Request, type Response } from "express";
import { db, controlExperimentsTable, EXPERIMENT_STATUSES, type ControlAdaptation, type ControlDigest } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  CreateControlExperimentBody,
  UpdateControlExperimentBody,
  DecideControlExperimentBody,
  UpdateControlCopyVariantBody,
  ResetControlDeliverabilityGuardBody,
  GenerateControlDigestBody,
} from "@workspace/api-zod";
import { requireOperator } from "../control-plane/operatorAuth.js";
import { requireOwnerMutationOrigin } from "../lib/orgAuth.js";
import { recordAuditEvent } from "../control-plane/audit.js";
import { latestGrowthSnapshot, snapshotMetrics, type GrowthSnapshot } from "../control-plane/metrics.js";
import { listRecentAdaptations, recordOperatorGuardReset, runAdaptationRules } from "../control-plane/growth/adaptation.js";
import { growthLoopEnabled } from "../control-plane/growth/config.js";
import { generateWeeklyDigest, latestDigest } from "../control-plane/growth/digest.js";
import {
  ExperimentStateError,
  ExperimentValidationError,
  applyExperimentDecision,
  createExperimentCard,
  evaluateExperimentById,
  runExperimentDecisions,
  updateExperimentCard,
  type ExperimentSnapshot,
} from "../control-plane/growth/experiments.js";
import { loadGrowthGuidance, type GrowthGuidance } from "../control-plane/growth/guidance.js";
import type { GrowthKpis } from "../control-plane/growth/kpiTypes.js";
import { mondayOf } from "../control-plane/growth/kpiMath.js";
import { listMetricKeys } from "../control-plane/growth/metricKeys.js";
import { updateVariant } from "../control-plane/growth/variants.js";
import { effectiveDailyCap, loadGuard, resetGuard } from "../control-plane/outreach/sendingHealth.js";
import { logger } from "../lib/logger.js";

/**
 * Growth-loop operator routes (growth-loop.md 12.3): the experiment
 * portfolio (typed cards, deterministic evaluator, operator decisions) and
 * the growth dashboard (KPIs, adaptation state, copy variants, deliverability
 * guard reset, weekly digest). Every mutation needs an operator session and
 * the owner-mutation origin check; nothing here calls a model.
 */

const router: IRouter = Router();

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseId(raw: string, res: Response, label: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: `Invalid ${label} id`, code: "invalid_id" });
    return null;
  }
  return id;
}

async function operatorMutation(req: Request, res: Response): Promise<{ email: string } | null> {
  if (!requireOwnerMutationOrigin(req, res)) return null;
  return requireOperator(req, res);
}

/** Map experiment-module errors onto the documented status codes. */
function experimentError(res: Response, err: unknown): void {
  if (err instanceof ExperimentValidationError) {
    res.status(400).json({ error: err.message, code: "invalid_experiment" });
    return;
  }
  if (err instanceof ExperimentStateError) {
    const notFound = /not found/i.test(err.message);
    res.status(notFound ? 404 : 409).json({ error: err.message, code: notFound ? "not_found" : "invalid_state" });
    return;
  }
  logger.error({ err }, "Experiment route failed");
  res.status(500).json({ error: "Experiment operation failed", code: "internal_error" });
}

/**
 * The GET /control/growth body (OpenAPI ControlGrowthResponse). Date columns
 * are returned as Date objects and serialized to ISO strings by Express, the
 * same convention every other control route uses.
 */
interface GrowthResponsePayload {
  snapshotId: number | null;
  computedAt: string;
  kpis: GrowthKpis;
  guidance: GrowthGuidance["segmentGuidance"];
  variants: GrowthGuidance["variants"];
  adaptations: ControlAdaptation[];
  metricKeys: ReturnType<typeof listMetricKeys>;
  loopEnabled: boolean;
  latestDigest: ControlDigest | null;
}

async function currentSnapshot(): Promise<GrowthSnapshot | null> {
  const latest = await latestGrowthSnapshot();
  if (latest) return latest;
  const taken = await snapshotMetrics();
  if (!taken.metrics.growth) return null;
  return {
    snapshotId: taken.snapshotId,
    createdAt: taken.createdAt,
    metrics: taken.metrics as GrowthSnapshot["metrics"],
    growth: taken.metrics.growth,
  };
}

/** The GET /control/growth payload (also returned by recompute and guard reset). */
async function buildGrowthResponse(snapshot: GrowthSnapshot | null): Promise<GrowthResponsePayload | null> {
  if (!snapshot) return null;
  const [guidance, adaptations, digest] = await Promise.all([
    loadGrowthGuidance({ kpis: snapshot.growth, adaptationLimit: 10 }),
    listRecentAdaptations(20),
    latestDigest(),
  ]);
  return {
    snapshotId: snapshot.snapshotId,
    computedAt: snapshot.growth.computedAt,
    kpis: snapshot.growth,
    guidance: guidance.segmentGuidance,
    variants: guidance.variants,
    adaptations,
    metricKeys: listMetricKeys(),
    loopEnabled: growthLoopEnabled(),
    latestDigest: digest,
  };
}

function noSnapshot(res: Response): void {
  res.status(503).json({
    error: "The growth KPI document could not be computed; check the server logs for the failing loader.",
    code: "growth_unavailable",
  });
}

/* ————— Experiments ————— */

// GET /control/experiments — the experiment portfolio, optionally filtered by status.
router.get("/control/experiments", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 50, 200);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status && !EXPERIMENT_STATUSES.includes(status as (typeof EXPERIMENT_STATUSES)[number])) {
    res.status(400).json({ error: `status must be one of ${EXPERIMENT_STATUSES.join(", ")}` });
    return;
  }
  const rows = await db
    .select()
    .from(controlExperimentsTable)
    .where(status ? eq(controlExperimentsTable.status, status) : undefined)
    .orderBy(desc(controlExperimentsTable.createdAt))
    .limit(limit);
  res.json({ experiments: rows });
});

// POST /control/experiments — operator creates an experiment card (same validation as the agent tool).
router.post("/control/experiments", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const parsed = CreateControlExperimentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "invalid_body" });
    return;
  }
  try {
    const outcome = await createExperimentCard(
      {
        name: parsed.data.name,
        hypothesis: parsed.data.hypothesis,
        metric: parsed.data.metric,
        primaryMetricKey: parsed.data.primaryMetricKey,
        segment: parsed.data.segment ?? null,
        variantKey: parsed.data.variantKey ?? null,
        baseline: parsed.data.baseline ?? null,
        minDetectableLift: parsed.data.minDetectableLift,
        killThreshold: parsed.data.killThreshold ?? null,
        decisionDate: parsed.data.decisionDate,
        assignments: parsed.data.assignments ?? null,
        startNow: parsed.data.startNow ?? false,
      },
      `operator:${operator.email}`,
    );
    if (!outcome.created) {
      res.status(409).json({
        error:
          outcome.reason === "portfolio_full"
            ? `At most 3 experiments may be proposed or running at once (${outcome.open ?? 3} open). Decide or abort one first.`
            : `An experiment named "${parsed.data.name}" is already proposed or running (#${outcome.existingExperimentId}).`,
        code: outcome.reason,
      });
      return;
    }
    res.status(201).json({ experiment: outcome.experiment });
  } catch (err) {
    experimentError(res, err);
  }
});

// POST /control/experiments/{id} — edit card fields while proposed/running; status running starts it.
router.post("/control/experiments/:id", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "experiment");
  if (id === null) return;
  const parsed = UpdateControlExperimentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "invalid_body" });
    return;
  }
  const body = parsed.data;
  try {
    const experiment = await updateExperimentCard(
      id,
      {
        ...(body.hypothesis !== undefined ? { hypothesis: body.hypothesis } : {}),
        ...(body.segment !== undefined ? { segment: body.segment } : {}),
        ...(body.variantKey !== undefined ? { variantKey: body.variantKey } : {}),
        ...(body.baseline !== undefined ? { baseline: body.baseline } : {}),
        ...(body.minDetectableLift !== undefined ? { minDetectableLift: body.minDetectableLift } : {}),
        ...(body.killThreshold !== undefined ? { killThreshold: body.killThreshold } : {}),
        ...(body.decisionDate !== undefined ? { decisionDate: body.decisionDate } : {}),
        ...(body.assignments !== undefined ? { assignments: body.assignments } : {}),
        ...(body.status === "running" ? { status: "running" as const } : {}),
      },
      `operator:${operator.email}`,
    );
    res.json({ experiment });
  } catch (err) {
    experimentError(res, err);
  }
});

// POST /control/experiments/{id}/evaluate — run the deterministic evaluator now (readout persisted, status untouched).
router.post("/control/experiments/:id/evaluate", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "experiment");
  if (id === null) return;
  try {
    const { experiment, evaluation } = await evaluateExperimentById(id);
    res.json({ experiment, evaluation });
  } catch (err) {
    experimentError(res, err);
  }
});

// POST /control/experiments/{id}/decision — operator decides win/kill/inconclusive or extends the decision date.
router.post("/control/experiments/:id/decision", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "experiment");
  if (id === null) return;
  const parsed = DecideControlExperimentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "invalid_body" });
    return;
  }
  try {
    const experiment = await applyExperimentDecision(id, parsed.data.decision, `operator:${operator.email}`, parsed.data.note ?? null, {
      newDecisionDate: parsed.data.newDecisionDate,
    });
    res.json({ experiment });
  } catch (err) {
    experimentError(res, err);
  }
});

/* ————— Growth dashboard ————— */

// GET /control/growth — outcome KPIs, adaptation state, variants, recent rule firings, latest digest.
router.get("/control/growth", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  try {
    const payload = await buildGrowthResponse(await currentSnapshot());
    if (!payload) {
      noSnapshot(res);
      return;
    }
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "GET /control/growth failed");
    res.status(500).json({ error: "Failed to load the growth dashboard", code: "internal_error" });
  }
});

// POST /control/growth/recompute — fresh KPI snapshot + evaluator + adaptation rules (same as a scheduler tick).
router.post("/control/growth/recompute", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  try {
    const taken = await snapshotMetrics();
    if (!taken.metrics.growth) {
      noSnapshot(res);
      return;
    }
    const snapshot: GrowthSnapshot = {
      snapshotId: taken.snapshotId,
      createdAt: taken.createdAt,
      metrics: taken.metrics as GrowthSnapshot["metrics"],
      growth: taken.metrics.growth,
    };
    const now = new Date();
    const decisions = await runExperimentDecisions(snapshot.metrics as ExperimentSnapshot, snapshot.snapshotId, now).catch((err) => {
      logger.error({ err }, "Experiment decisions failed during recompute");
      return { evaluated: 0, decided: 0 };
    });
    const changes = growthLoopEnabled()
      ? await runAdaptationRules(snapshot.growth, snapshot.snapshotId, now).catch((err) => {
          logger.error({ err }, "Adaptation rules failed during recompute");
          return [];
        })
      : [];
    await recordAuditEvent({
      actorType: "operator",
      actor: operator.email,
      eventType: "growth_recomputed",
      subjectType: "snapshot",
      subjectId: snapshot.snapshotId,
      detail: { experimentsEvaluated: decisions.evaluated, experimentsDecided: decisions.decided, adaptations: changes.map((c) => `${c.ruleKey}:${c.action}`) },
    });
    const payload = await buildGrowthResponse(snapshot);
    if (!payload) {
      noSnapshot(res);
      return;
    }
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "POST /control/growth/recompute failed");
    res.status(500).json({ error: "Growth recompute failed", code: "internal_error" });
  }
});

// POST /control/growth/variants/{key} — edit a copy variant (weight, active, angle, name); the control cannot be deactivated.
router.post("/control/growth/variants/:key", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const key = String(req.params.key ?? "").trim();
  if (!key) {
    res.status(400).json({ error: "Variant key is required", code: "invalid_key" });
    return;
  }
  const parsed = UpdateControlCopyVariantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "invalid_body" });
    return;
  }
  try {
    const variant = await updateVariant(
      key,
      {
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        ...(parsed.data.weight !== undefined ? { weight: parsed.data.weight } : {}),
        ...(parsed.data.angle !== undefined ? { angle: parsed.data.angle } : {}),
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.active === false ? { pausedReason: `paused by operator ${operator.email}` } : {}),
      },
      `operator:${operator.email}`,
    );
    res.json({ variant });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Variant update failed";
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message, code: "not_found" });
      return;
    }
    if (/control variant cannot be deactivated/i.test(message)) {
      res.status(409).json({ error: message, code: "control_variant" });
      return;
    }
    res.status(400).json({ error: message, code: "invalid_variant" });
  }
});

// POST /control/growth/guard/reset — operator resets the deliverability guard to ok and restores the base daily cap.
router.post("/control/growth/guard/reset", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const parsed = ResetControlDeliverabilityGuardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "invalid_body" });
    return;
  }
  try {
    const before = await loadGuard();
    const after = await resetGuard(parsed.data.note, operator.email);
    const cap = await effectiveDailyCap();
    await recordOperatorGuardReset(before, after, parsed.data.note, operator.email, cap);
    // The guard state rides in the snapshot; take a fresh one so the tab shows ok immediately.
    const taken = await snapshotMetrics();
    const snapshot: GrowthSnapshot | null = taken.metrics.growth
      ? { snapshotId: taken.snapshotId, createdAt: taken.createdAt, metrics: taken.metrics as GrowthSnapshot["metrics"], growth: taken.metrics.growth }
      : await currentSnapshot();
    const payload = await buildGrowthResponse(snapshot);
    if (!payload) {
      noSnapshot(res);
      return;
    }
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "POST /control/growth/guard/reset failed");
    res.status(500).json({ error: "Guard reset failed", code: "internal_error" });
  }
});

// POST /control/digest/generate — build (or rebuild) this week's digest now and queue the send action.
router.post("/control/digest/generate", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const parsed = GenerateControlDigestBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "invalid_body" });
    return;
  }
  try {
    const now = new Date();
    const digest = await generateWeeklyDigest({
      weekStart: mondayOf(now),
      createdBy: `operator:${operator.email}`,
      force: parsed.data.force === true,
      now,
    });
    await recordAuditEvent({
      actorType: "operator",
      actor: operator.email,
      eventType: "digest_generated",
      subjectType: "digest",
      subjectId: digest.id,
      detail: { weekStart: digest.weekStart.toISOString(), force: parsed.data.force === true, actionId: digest.actionId },
    });
    res.status(201).json({ digest });
  } catch (err) {
    logger.error({ err }, "POST /control/digest/generate failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Digest generation failed", code: "internal_error" });
  }
});

export default router;
