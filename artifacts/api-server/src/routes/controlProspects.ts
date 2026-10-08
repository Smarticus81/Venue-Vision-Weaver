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
} from "@workspace/api-zod";
import { requireOperator } from "../control-plane/operatorAuth.js";
import { requireOwnerMutationOrigin } from "../lib/orgAuth.js";
import { controlPlaneAiConfigured } from "../control-plane/grok.js";
import { recordAuditEvent } from "../control-plane/audit.js";
import {
  createDraft,
  getEmailDetail,
  listEmails,
  regenerateEmail,
  updateEmail,
} from "../control-plane/outreach/studio.js";

/**
 * Prospect pipeline and outreach studio routes for /control: prospects,
 * operator-recorded outcomes, studio emails, drafts, plus the vetting,
 * evidence and sending-state operations the OpenAPI spec defines. Step 0
 * moves the existing handlers here and declares the new ones as 501
 * ErrorEnvelope stubs; the vetting workstream fills them (vetting.md 7).
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

function notImplemented(res: Response, operation: string): void {
  res.status(501).json({
    error: `${operation} is not available yet; the vetting workstream has not landed.`,
    code: "not_implemented",
  });
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

  const [prospect] = await db
    .update(controlProspectsTable)
    .set(patch)
    .where(eq(controlProspectsTable.id, id))
    .returning();
  if (!prospect) {
    res.status(404).json({ error: "Prospect not found" });
    return;
  }

  await recordAuditEvent({
    actorType: "operator",
    actor: operator.email,
    eventType: "prospect_status_changed",
    subjectType: "prospect",
    subjectId: id,
    detail: {
      status,
      replySentiment: parsed.data.replySentiment ?? null,
      organizationId: parsed.data.organizationId ?? null,
      note: parsed.data.note ?? null,
    },
  });
  res.json({ prospect });
});

/* ————— Vetting and evidence (vetting.md 7; 501 until the vetting workstream lands) ————— */

// GET /control/prospects/{id}/evidence — vetting verdict, checks, facts, research.
router.get("/control/prospects/:id/evidence", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  if (!parseId(req.params.id, res, "prospect")) return;
  notImplemented(res, "Prospect evidence");
});

// POST /control/prospects/{id}/vet — run (or re-run) legitimacy vetting.
router.post("/control/prospects/:id/vet", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  if (!parseId(req.params.id, res, "prospect")) return;
  notImplemented(res, "Prospect vetting");
});

// POST /control/prospects/{id}/vetting/override — operator pass/fail decision.
router.post("/control/prospects/:id/vetting/override", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  if (!parseId(req.params.id, res, "prospect")) return;
  notImplemented(res, "Vetting overrides");
});

// POST /control/prospects/{id}/facts — operator adds a sourced fact.
router.post("/control/prospects/:id/facts", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  if (!parseId(req.params.id, res, "prospect")) return;
  notImplemented(res, "Adding prospect facts");
});

// DELETE /control/prospects/{id}/facts/{factId} — operator removes a fact.
router.delete("/control/prospects/:id/facts/:factId", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  if (!parseId(req.params.id, res, "prospect")) return;
  if (!parseId(req.params.factId, res, "fact")) return;
  notImplemented(res, "Removing prospect facts");
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
    limit,
  });
  res.json({ emails });
});

// GET /control/outreach/sending — deliverability guard, daily cap, 14-day health.
router.get("/control/outreach/sending", async (req, res): Promise<void> => {
  const operator = await requireOperator(req, res);
  if (!operator) return;
  notImplemented(res, "The outreach sending state");
});

// POST /control/outreach/sending — pause or reset the deliverability guard.
router.post("/control/outreach/sending", async (req, res): Promise<void> => {
  if (!(await operatorMutation(req, res))) return;
  notImplemented(res, "Pausing or resetting outreach sending");
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
