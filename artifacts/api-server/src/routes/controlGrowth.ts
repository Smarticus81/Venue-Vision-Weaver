import { Router, type IRouter, type Request, type Response } from "express";
import { db, controlExperimentsTable, EXPERIMENT_STATUSES } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireOperator } from "../control-plane/operatorAuth.js";
import { requireOwnerMutationOrigin } from "../lib/orgAuth.js";

/**
 * Growth-loop operator routes: the experiment portfolio plus the growth
 * dashboard (KPIs, adaptation state, copy variants, deliverability guard
 * reset, weekly digest). Step 0 moves the existing experiments listing here
 * and declares every other operation the OpenAPI spec defines as a 501
 * ErrorEnvelope stub; the growth workstream fills them (growth-loop.md 12.3).
 */

const router: IRouter = Router();

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function notImplemented(res: Response, operation: string): void {
  res.status(501).json({
    error: `${operation} is not available yet; the growth workstream has not landed.`,
    code: "not_implemented",
  });
}

async function operatorMutation(req: Request, res: Response): Promise<boolean> {
  if (!requireOwnerMutationOrigin(req, res)) return false;
  const operator = await requireOperator(req, res);
  return Boolean(operator);
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

// POST /control/experiments — operator creates an experiment card.
router.post("/control/experiments", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  notImplemented(res, "Creating experiments from /control");
});

// POST /control/experiments/{id} — edit card fields / start a proposed experiment.
router.post("/control/experiments/:id", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  notImplemented(res, "Updating experiments from /control");
});

// POST /control/experiments/{id}/evaluate — run the deterministic evaluator now.
router.post("/control/experiments/:id/evaluate", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  notImplemented(res, "Evaluating experiments");
});

// POST /control/experiments/{id}/decision — operator decides win/kill/inconclusive/extended.
router.post("/control/experiments/:id/decision", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  notImplemented(res, "Experiment decisions");
});

/* ————— Growth dashboard ————— */

// GET /control/growth — outcome KPIs, adaptation state, variants, recent rule firings.
router.get("/control/growth", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  notImplemented(res, "The growth dashboard");
});

// POST /control/growth/recompute — fresh KPI snapshot + evaluator + adaptation rules.
router.post("/control/growth/recompute", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  notImplemented(res, "Growth recompute");
});

// POST /control/growth/variants/{key} — edit a copy variant (weight, active, angle, name).
router.post("/control/growth/variants/:key", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  notImplemented(res, "Copy variant updates");
});

// POST /control/growth/guard/reset — operator resets the deliverability guard.
router.post("/control/growth/guard/reset", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  notImplemented(res, "Deliverability guard reset from the growth tab");
});

// POST /control/digest/generate — build this week's operator digest now.
router.post("/control/digest/generate", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  notImplemented(res, "Digest generation");
});

export default router;
