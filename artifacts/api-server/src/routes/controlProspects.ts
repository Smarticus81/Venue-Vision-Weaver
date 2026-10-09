import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  controlProspectsTable,
  OUTREACH_EMAIL_STATUSES,
  PROSPECT_STATUSES,
  VETTING_STATUSES,
} from "@workspace/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  SetControlProspectStatusBody,
  UpdateControlOutreachEmailBody,
  RegenerateControlOutreachEmailBody,
  DraftControlOutreachEmailBody,
  VetControlProspectBody,
  OverrideControlProspectVettingBody,
  AddControlProspectFactBody,
  SetControlOutreachSendingBody,
} from "@workspace/api-zod";
import { requireOperator } from "../control-plane/operatorAuth.js";
import { requireOwnerMutationOrigin } from "../lib/orgAuth.js";
import { controlPlaneAiConfigured } from "../control-plane/grok.js";
import { recordAuditEvent } from "../control-plane/audit.js";
import { checkProspectTransition } from "../control-plane/outreach/prospectTransitions.js";
import { getSendingState, pauseGuard, resetGuard } from "../control-plane/outreach/sendingHealth.js";
import {
  createDraft,
  getEmailDetail,
  listEmails,
  loadProspectById,
  regenerateEmail,
  updateEmail,
} from "../control-plane/outreach/studio.js";
import { suppressEmail } from "../control-plane/outreach/unsubscribe.js";
import { buildEvidence } from "../control-plane/vetting/evidence.js";
import { addOperatorFact, removeFact } from "../control-plane/vetting/facts.js";
import { ensureVetted, overrideVetting } from "../control-plane/vetting/vet.js";
import { logger } from "../lib/logger.js";

/**
 * Prospect pipeline and outreach studio routes for /control: prospects,
 * operator-recorded outcomes (status moves follow PROSPECT_TRANSITIONS;
 * qualifying needs a passed vetting; an unsubscribe suppresses the address),
 * legitimacy vetting with its evidence, operator overrides and sourced facts,
 * the deliverability guard, and the studio's emails and drafts.
 */

const router: IRouter = Router();

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseOffset(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function parseId(raw: string, res: Response, label: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: `Invalid ${label} id` });
    return null;
  }
  return id;
}

function studioError(res: Response, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : fallback;
  const status = /not found/i.test(message) ? 404 : 409;
  res.status(status).json({ error: message });
}

async function sendEvidence(res: Response, prospectId: number, status = 200): Promise<void> {
  const evidence = await buildEvidence(prospectId);
  if (!evidence) {
    res.status(404).json({ error: "Prospect not found" });
    return;
  }
  res.status(status).json(evidence);
}

async function operatorMutation(req: Request, res: Response): Promise<{ email: string } | null> {
  if (!requireOwnerMutationOrigin(req, res)) return null;
  return requireOperator(req, res);
}

/* ————— Prospect pipeline ————— */

// GET /control/prospects — the prospect pipeline, filterable by status/campaign/vetting, searchable, pageable.
router.get("/control/prospects", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;

  const limit = parseLimit(req.query.limit, 50, 200);
  const offset = parseOffset(req.query.offset);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status && !PROSPECT_STATUSES.includes(status as (typeof PROSPECT_STATUSES)[number])) {
    res.status(400).json({ error: `status must be one of ${PROSPECT_STATUSES.join(", ")}` });
    return;
  }
  const vettingStatus = typeof req.query.vettingStatus === "string" ? req.query.vettingStatus : null;
  if (vettingStatus && !VETTING_STATUSES.includes(vettingStatus as (typeof VETTING_STATUSES)[number])) {
    res.status(400).json({ error: `vettingStatus must be one of ${VETTING_STATUSES.join(", ")}` });
    return;
  }
  const campaignId = Number(req.query.campaignId);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  const sort = typeof req.query.sort === "string" ? req.query.sort : "updated";

  const conditions = [];
  if (status) conditions.push(eq(controlProspectsTable.status, status));
  if (vettingStatus) conditions.push(eq(controlProspectsTable.vettingStatus, vettingStatus));
  if (Number.isInteger(campaignId) && campaignId > 0) {
    conditions.push(eq(controlProspectsTable.campaignId, campaignId));
  }
  if (q) {
    const needle = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    conditions.push(
      or(
        sql`${controlProspectsTable.name} ilike ${needle}`,
        sql`${controlProspectsTable.email} ilike ${needle}`,
        sql`${controlProspectsTable.website} ilike ${needle}`,
        sql`${controlProspectsTable.region} ilike ${needle}`,
      )!,
    );
  }
  const orderBy =
    sort === "newest"
      ? [desc(controlProspectsTable.createdAt)]
      : sort === "score"
        ? [desc(controlProspectsTable.score), desc(controlProspectsTable.updatedAt)]
        : [desc(controlProspectsTable.updatedAt)];

  const rows = await db
    .select()
    .from(controlProspectsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
  res.json({ prospects: rows });
});

// Operators record outcomes agents cannot observe (inbound email is human-read):
// replies, conversions, unsubscribes — plus re-staging. "contacted" is reserved
// for the governed send action so contact bookkeeping stays truthful.
const OPERATOR_PROSPECT_STATUSES = [
  "new",
  "qualified",
  "replied",
  "converted",
  "unsubscribed",
  "disqualified",
] as const;

// POST /control/prospects/{id}/status — record a prospect outcome.
router.post("/control/prospects/:id/status", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;

  const id = parseId(req.params.id, res, "prospect");
  if (!id) return;
  const parsed = SetControlProspectStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.status;
  if (!OPERATOR_PROSPECT_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of ${OPERATOR_PROSPECT_STATUSES.join(", ")}` });
    return;
  }
  const current = await loadProspectById(id);
  if (!current) {
    res.status(404).json({ error: "Prospect not found" });
    return;
  }
  const transition = checkProspectTransition({ from: current.status, to: status, vettingStatus: current.vettingStatus });
  if (!transition.ok) {
    res.status(409).json({ error: transition.error });
    return;
  }

  // Growth attribution bookkeeping (shared-contract D16): replies and
  // conversions keep their first timestamp and the campaign they came from.
  const now = new Date();
  const patch: Partial<typeof controlProspectsTable.$inferInsert> = {
    status,
    statusChangedBy: operator.email,
    updatedAt: now,
  };
  if (status === "replied") {
    patch.repliedAt = sql`coalesce(${controlProspectsTable.repliedAt}, ${now})` as unknown as Date;
    if (parsed.data.replySentiment !== undefined) patch.replySentiment = parsed.data.replySentiment;
  }
  if (status === "converted") {
    patch.convertedAt = sql`coalesce(${controlProspectsTable.convertedAt}, ${now})` as unknown as Date;
    patch.attributionMethod = "manual";
    if (parsed.data.organizationId != null) patch.convertedOrganizationId = parsed.data.organizationId;
    patch.convertedCampaignId = sql`coalesce(${controlProspectsTable.convertedCampaignId}, ${controlProspectsTable.campaignId})` as unknown as number;
  }

  const [updated] = await db
    .update(controlProspectsTable)
    .set(patch)
    .where(and(eq(controlProspectsTable.id, id), eq(controlProspectsTable.status, current.status)))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "The prospect changed while you were editing it; reload and try again." });
    return;
  }
  let prospect = updated;
  if (status === "unsubscribed") {
    // Consent is permanent: the address joins the suppression list every send checks.
    await suppressEmail({
      email: updated.email,
      reason: "operator",
      detail: parsed.data.note ?? "recorded by an operator in /control",
      prospectId: id,
      actor: `operator:${operator.email}`,
    });
    prospect = (await loadProspectById(id)) ?? updated;
  }

  await recordAuditEvent({
    actorType: "operator",
    actor: operator.email,
    eventType: "prospect_status_changed",
    subjectType: "prospect",
    subjectId: id,
    detail: {
      from: current.status,
      status,
      replySentiment: parsed.data.replySentiment ?? null,
      organizationId: parsed.data.organizationId ?? null,
      note: parsed.data.note ?? null,
    },
  });
  res.json({ prospect });
});

/* ————— Vetting and evidence (vetting.md 7) ————— */

// GET /control/prospects/{id}/evidence — vetting verdict, checks, facts, research.
router.get("/control/prospects/:id/evidence", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "prospect");
  if (!id) return;
  await sendEvidence(res, id);
});

// POST /control/prospects/{id}/vet — run (or re-run) legitimacy vetting.
// A venue's own network problems come back as vetting.status "error", never a 5xx.
router.post("/control/prospects/:id/vet", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "prospect");
  if (!id) return;
  const parsed = VetControlProspectBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const prospect = await loadProspectById(id);
  if (!prospect) {
    res.status(404).json({ error: "Prospect not found" });
    return;
  }
  if (parsed.data.refresh !== false) {
    try {
      await ensureVetted(prospect, { force: true, requestedBy: `operator:${operator.email}` });
    } catch (err) {
      logger.error({ err, prospectId: id }, "Operator vetting run failed");
      res.status(500).json({ error: "Vetting could not be saved; try again." });
      return;
    }
  }
  await sendEvidence(res, id);
});

// POST /control/prospects/{id}/vetting/override — operator pass/fail decision.
router.post("/control/prospects/:id/vetting/override", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "prospect");
  if (!id) return;
  const parsed = OverrideControlProspectVettingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    await overrideVetting(id, parsed.data.decision, parsed.data.note, operator.email);
  } catch (err) {
    studioError(res, err, "Override failed");
    return;
  }
  await sendEvidence(res, id);
});

// POST /control/prospects/{id}/facts — operator adds a sourced fact.
router.post("/control/prospects/:id/facts", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "prospect");
  if (!id) return;
  const parsed = AddControlProspectFactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await loadProspectById(id))) {
    res.status(404).json({ error: "Prospect not found" });
    return;
  }
  try {
    await addOperatorFact(id, parsed.data, operator.email);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid fact" });
    return;
  }
  await sendEvidence(res, id, 201);
});

// DELETE /control/prospects/{id}/facts/{factId} — operator removes a fact.
router.delete("/control/prospects/:id/facts/:factId", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "prospect");
  if (!id) return;
  const factId = parseId(req.params.factId, res, "fact");
  if (!factId) return;
  if (!(await removeFact(id, factId, operator.email))) {
    res.status(404).json({ error: "Prospect or fact not found" });
    return;
  }
  await sendEvidence(res, id);
});

/* ————— Outreach email studio ————— */

// GET /control/outreach/emails — studio emails with prospect + approval state.
router.get("/control/outreach/emails", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const limit = parseLimit(req.query.limit, 50, 200);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status && !OUTREACH_EMAIL_STATUSES.includes(status as (typeof OUTREACH_EMAIL_STATUSES)[number])) {
    res.status(400).json({ error: `status must be one of ${OUTREACH_EMAIL_STATUSES.join(", ")}` });
    return;
  }
  const prospectId = Number(req.query.prospectId);
  const emails = await listEmails({
    status,
    prospectId: Number.isInteger(prospectId) && prospectId > 0 ? prospectId : null,
    awaiting: req.query.awaiting === "true" || req.query.awaiting === "1",
    limit,
    offset: parseOffset(req.query.offset),
  });
  res.json({ emails });
});

// GET /control/outreach/sending — deliverability guard, daily cap, 14-day health.
router.get("/control/outreach/sending", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  res.json(await getSendingState());
});

// POST /control/outreach/sending — pause or reset the deliverability guard (a reset is always manual).
router.post("/control/outreach/sending", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const parsed = SetControlOutreachSendingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.paused) await pauseGuard(parsed.data.note, `operator:${operator.email}`);
  else await resetGuard(parsed.data.note, operator.email);
  res.json(await getSendingState());
});

// GET /control/outreach/emails/{id} — full review payload with rendered previews.
router.get("/control/outreach/emails/:id", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "email");
  if (!id) return;
  const detail = await getEmailDetail(id);
  if (!detail) {
    res.status(404).json({ error: "Outreach email not found" });
    return;
  }
  res.json({ detail });
});

// POST /control/outreach/emails/{id} — operator edits (subject, copy, images, CTA).
router.post("/control/outreach/emails/:id", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "email");
  if (!id) return;
  const parsed = UpdateControlOutreachEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const detail = await updateEmail(id, parsed.data, operator.email);
    res.json({ detail });
  } catch (err) {
    studioError(res, err, "Update failed");
  }
});

// POST /control/outreach/emails/{id}/regenerate — rewrite copy and/or re-run research.
router.post("/control/outreach/emails/:id/regenerate", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "email");
  if (!id) return;
  const parsed = RegenerateControlOutreachEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if ((parsed.data.mode === "copy" || parsed.data.mode === "both") && !controlPlaneAiConfigured()) {
    res.status(503).json({ error: "XAI_API_KEY is not configured; copy cannot be regenerated (research still can)." });
    return;
  }
  try {
    const detail = await regenerateEmail(id, parsed.data.mode, operator.email, { ask: parsed.data.ask });
    res.json({ detail });
  } catch (err) {
    studioError(res, err, "Regeneration failed");
  }
});

// POST /control/prospects/{id}/draft — operator-initiated studio draft (still gated by approval).
router.post("/control/prospects/:id/draft", async (req, res): Promise<void> => {
  const operator = await operatorMutation(req, res);
  if (!operator) return;
  const id = parseId(req.params.id, res, "prospect");
  if (!id) return;
  const parsed = DraftControlOutreachEmailBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await createDraft({
      prospectId: id,
      ask: parsed.data.ask,
      campaignId: parsed.data.campaignId ?? null,
      step: parsed.data.step ?? null,
      agentKey: "operator",
      runId: null,
      actor: `operator:${operator.email}`,
      forceResearch: parsed.data.refreshResearch === true,
      variantKey: parsed.data.variantKey ?? null,
    });
    const detail = await getEmailDetail(result.email.id);
    res.status(201).json({ detail });
  } catch (err) {
    studioError(res, err, "Draft failed");
  }
});

export default router;
