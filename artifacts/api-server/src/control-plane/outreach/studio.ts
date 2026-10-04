import {
  db,
  agentActionsTable,
  controlCampaignsTable,
  controlOutreachEmailsTable,
  controlProspectAssetsTable,
  controlProspectResearchTable,
  controlProspectsTable,
  type ControlOutreachEmail,
  type ControlProspect,
  type ControlProspectAsset,
  type ControlProspectResearch,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { recordAuditEvent } from "../audit.js";
import { proposeAction } from "../actions.js";
import { assertProspectContactableNow } from "./contactGuards.js";
import {
  RESEARCH_STALE_DAYS,
  outreachDefaultCtaUrl,
  outreachPostalAddress,
  outreachUnsubscribeMailbox,
  postalAddressIsPlaceholder,
  publicObjectUrl,
  samplePreviewsEnabled,
} from "./config.js";
import { writeCopy, type CopyResult } from "./copywriter.js";
import { renderEmailRow } from "./sender.js";
import { newUnsubscribeToken } from "./unsubscribe.js";
import { defaultResearchDeps, researchVenue, type ResearchDeps, type VenueFacts } from "./venueResearch.js";

/**
 * Studio orchestration: research a prospect's venue, write the personal
 * draft, persist it, and raise the governed send action. Operators review,
 * edit, regenerate, and approve from /control; sending is the action's job.
 */

export const SEND_OUTREACH_ACTION = "send_outreach_email";

export interface StudioWarnings {
  research: string[];
  config: string[];
}

export async function loadProspectById(prospectId: number): Promise<ControlProspect | null> {
  const [row] = await db.select().from(controlProspectsTable).where(eq(controlProspectsTable.id, prospectId));
  return row ?? null;
}

export async function loadResearch(prospectId: number): Promise<ControlProspectResearch | null> {
  const [row] = await db
    .select()
    .from(controlProspectResearchTable)
    .where(eq(controlProspectResearchTable.prospectId, prospectId));
  return row ?? null;
}

export async function loadProspectAssets(prospectId: number): Promise<ControlProspectAsset[]> {
  return db
    .select()
    .from(controlProspectAssetsTable)
    .where(eq(controlProspectAssetsTable.prospectId, prospectId))
    .orderBy(desc(controlProspectAssetsTable.selected), desc(controlProspectAssetsTable.score), desc(controlProspectAssetsTable.createdAt));
}

function researchIsFresh(research: ControlProspectResearch): boolean {
  const ageMs = Date.now() - research.fetchedAt.getTime();
  return research.status === "ok" && ageMs < RESEARCH_STALE_DAYS * 24 * 60 * 60 * 1000;
}

export async function ensureResearch(
  prospect: ControlProspect,
  options: { force?: boolean; actor: string; deps?: ResearchDeps },
): Promise<{ research: ControlProspectResearch; assets: ControlProspectAsset[]; refreshed: boolean }> {
  const existing = await loadResearch(prospect.id);
  if (existing && !options.force && researchIsFresh(existing)) {
    return { research: existing, assets: await loadProspectAssets(prospect.id), refreshed: false };
  }

  const result = await researchVenue(
    { prospectId: prospect.id, name: prospect.name, website: prospect.website, region: prospect.region },
    options.deps ?? defaultResearchDeps(),
  );
  const now = new Date();

  const [research] = await db
    .insert(controlProspectResearchTable)
    .values({
      prospectId: prospect.id,
      status: result.status,
      sourceUrls: result.sourceUrls,
      facts: result.facts as unknown as Record<string, unknown>,
      warnings: result.warnings,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: controlProspectResearchTable.prospectId,
      set: {
        status: result.status,
        sourceUrls: result.sourceUrls,
        facts: result.facts as unknown as Record<string, unknown>,
        warnings: result.warnings,
        fetchedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  if (!research) throw new Error("Failed to persist venue research.");

  // Previous research picks step aside; operators can still swap them back in.
  await db
    .update(controlProspectAssetsTable)
    .set({ selected: false })
    .where(and(eq(controlProspectAssetsTable.prospectId, prospect.id), eq(controlProspectAssetsTable.kind, "venue_image")));

  const existingAssets = await loadProspectAssets(prospect.id);
  const byKey = new Map(existingAssets.map((asset) => [asset.objectKey, asset]));
  for (const image of result.images) {
    const known = byKey.get(image.objectKey);
    if (known) {
      await db
        .update(controlProspectAssetsTable)
        .set({ selected: image.selected, score: image.score, altText: image.altText })
        .where(eq(controlProspectAssetsTable.id, known.id));
      continue;
    }
    await db.insert(controlProspectAssetsTable).values({
      prospectId: prospect.id,
      kind: "venue_image",
      objectKey: image.objectKey,
      sourceUrl: image.sourceUrl,
      pageUrl: image.pageUrl,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      altText: image.altText,
      score: image.score,
      selected: image.selected,
      createdBy: "research",
    });
  }

  await recordAuditEvent({
    actorType: options.actor.startsWith("operator:") ? "operator" : "agent",
    actor: options.actor,
    eventType: "prospect_researched",
    subjectType: "prospect",
    subjectId: prospect.id,
    detail: { status: result.status, images: result.images.length, pages: result.sourceUrls.length, warnings: result.warnings },
  });

  return { research, assets: await loadProspectAssets(prospect.id), refreshed: true };
}

function factsFromResearch(research: ControlProspectResearch | null, prospect: ControlProspect): VenueFacts {
  const raw = (research?.facts ?? {}) as Partial<VenueFacts>;
  return {
    name: typeof raw.name === "string" && raw.name ? raw.name : prospect.name,
    location: typeof raw.location === "string" && raw.location ? raw.location : prospect.region,
    spaces: Array.isArray(raw.spaces) ? raw.spaces.filter((s): s is string => typeof s === "string") : [],
    style: typeof raw.style === "string" ? raw.style : null,
    capacity: typeof raw.capacity === "number" ? raw.capacity : null,
    summary: typeof raw.summary === "string" ? raw.summary : null,
  };
}

async function stepGuidanceFor(campaignId: number | null, step: number | null): Promise<string | null> {
  if (!campaignId || !step) return null;
  const [campaign] = await db
    .select({ steps: controlCampaignsTable.steps })
    .from(controlCampaignsTable)
    .where(eq(controlCampaignsTable.id, campaignId));
  const match = campaign?.steps.find((entry) => Number(entry.step) === step);
  return typeof match?.guidance === "string" ? match.guidance : null;
}

export function configWarnings(): string[] {
  const warnings: string[] = [];
  if (postalAddressIsPlaceholder()) {
    warnings.push("OUTREACH_POSTAL_ADDRESS is not set; the footer shows a placeholder address (CAN-SPAM requires a real one before sending).");
  }
  if (!process.env.RESEND_API_KEY?.trim()) {
    warnings.push("RESEND_API_KEY is not set; approving will fail until email delivery is configured.");
  }
  return warnings;
}

export interface CreateDraftInput {
  prospectId: number;
  campaignId?: number | null;
  step?: number | null;
  ask?: "call" | "preview";
  agentKey: string;
  runId: number | null;
  /** Audit actor: the agent key or operator:<email>. */
  actor: string;
  forceResearch?: boolean;
  researchDeps?: ResearchDeps;
}

export async function createDraft(input: CreateDraftInput): Promise<{
  email: ControlOutreachEmail;
  actionId: number | null;
  actionStatus: string;
  copy: CopyResult["notes"];
  warnings: StudioWarnings;
}> {
  const prospect = await loadProspectById(input.prospectId);
  if (!prospect) throw new Error(`Prospect ${input.prospectId} not found.`);
  // Fail fast on consent/cadence so no research or model spend happens for a blocked target.
  await assertProspectContactableNow(prospect);

  const [pendingExisting] = await db
    .select({ id: controlOutreachEmailsTable.id, actionId: controlOutreachEmailsTable.actionId })
    .from(controlOutreachEmailsTable)
    .innerJoin(agentActionsTable, eq(controlOutreachEmailsTable.actionId, agentActionsTable.id))
    .where(and(eq(controlOutreachEmailsTable.prospectId, prospect.id), eq(agentActionsTable.status, "pending")))
    .limit(1);
  if (pendingExisting) {
    throw new Error(
      `Prospect ${prospect.id} already has outreach email #${pendingExisting.id} waiting for approval (action #${pendingExisting.actionId}); review that one instead of drafting another.`,
    );
  }

  const { research, assets } = await ensureResearch(prospect, {
    force: input.forceResearch,
    actor: input.actor,
    deps: input.researchDeps,
  });
  const facts = factsFromResearch(research, prospect);
  const campaignId = input.campaignId ?? prospect.campaignId ?? null;
  const step = input.step ?? null;
  const copy = await writeCopy({
    facts,
    prospectName: prospect.name,
    contactName: prospect.contactName,
    ask: input.ask ?? (prospect.contactCount > 0 ? "call" : "preview"),
    contactCount: prospect.contactCount,
    stepGuidance: await stepGuidanceFor(campaignId, step),
  });

  const selectedImageIds = assets.filter((asset) => asset.selected && asset.kind === "venue_image").map((asset) => asset.id);
  const [email] = await db
    .insert(controlOutreachEmailsTable)
    .values({
      prospectId: prospect.id,
      campaignId,
      step,
      status: "draft",
      subjectOptions: copy.subjects,
      subject: copy.subjects[0],
      body: copy.body,
      greeting: copy.greeting,
      signOff: copy.signOff,
      ctaLabel: copy.ctaLabel,
      ctaUrl: outreachDefaultCtaUrl(facts.name ?? prospect.name),
      imageAssetIds: selectedImageIds,
      draftNotes: { ...copy.notes, research: { status: research.status, warnings: research.warnings } },
      unsubscribeToken: newUnsubscribeToken(),
      createdByAgent: input.agentKey,
    })
    .returning();
  if (!email) throw new Error("Failed to persist outreach draft.");

  const warnings: StudioWarnings = { research: research.warnings, config: configWarnings() };
  const action = await proposeAction({
    agentKey: input.agentKey,
    runId: input.runId,
    actionType: SEND_OUTREACH_ACTION,
    title: `Email ${prospect.name}: “${email.subject}”`,
    reasoning: [
      `Studio draft #${email.id} for ${prospect.email} (${prospect.status}, ${prospect.contactCount} prior emails).`,
      `Copy source: ${copy.notes.source}; ${copy.notes.wordCount} words; ${selectedImageIds.length} venue photo(s) from ${research.sourceUrls[0] ?? "no site"}.`,
      ...research.warnings.map((warning) => `Research: ${warning}`),
    ].join("\n"),
    params: { emailId: email.id },
  });
  const [linked] = await db
    .update(controlOutreachEmailsTable)
    .set({ actionId: action.id, updatedAt: new Date() })
    .where(eq(controlOutreachEmailsTable.id, email.id))
    .returning();

  await recordAuditEvent({
    actorType: input.actor.startsWith("operator:") ? "operator" : "agent",
    actor: input.actor,
    eventType: "outreach_email_drafted",
    subjectType: "outreach_email",
    subjectId: email.id,
    detail: { prospectId: prospect.id, actionId: action.id, copySource: copy.notes.source, images: selectedImageIds.length },
  });

  return { email: linked ?? email, actionId: action.id, actionStatus: action.status, copy: copy.notes, warnings };
}

/* ————— Operator views ————— */

export interface EmailListRow {
  email: ControlOutreachEmail;
  prospect: Pick<ControlProspect, "id" | "name" | "email" | "contactName" | "status" | "website" | "region">;
  actionStatus: string | null;
  imageCount: number;
}

export async function listEmails(filter: { status?: string | null; prospectId?: number | null; limit: number }): Promise<EmailListRow[]> {
  const conditions = [];
  if (filter.status) conditions.push(eq(controlOutreachEmailsTable.status, filter.status));
  if (filter.prospectId) conditions.push(eq(controlOutreachEmailsTable.prospectId, filter.prospectId));
  const rows = await db
    .select({
      email: controlOutreachEmailsTable,
      prospect: {
        id: controlProspectsTable.id,
        name: controlProspectsTable.name,
        email: controlProspectsTable.email,
        contactName: controlProspectsTable.contactName,
        status: controlProspectsTable.status,
        website: controlProspectsTable.website,
        region: controlProspectsTable.region,
      },
      actionStatus: agentActionsTable.status,
    })
    .from(controlOutreachEmailsTable)
    .innerJoin(controlProspectsTable, eq(controlOutreachEmailsTable.prospectId, controlProspectsTable.id))
    .leftJoin(agentActionsTable, eq(controlOutreachEmailsTable.actionId, agentActionsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(controlOutreachEmailsTable.updatedAt))
    .limit(filter.limit);
  return rows.map((row) => ({
    email: row.email,
    prospect: row.prospect,
    actionStatus: row.actionStatus ?? null,
    imageCount: row.email.imageAssetIds.length,
  }));
}

export interface AssetView {
  id: number;
  kind: string;
  url: string;
  sourceUrl: string | null;
  pageUrl: string | null;
  width: number;
  height: number;
  bytes: number;
  altText: string;
  score: number;
  selected: boolean;
  inEmail: boolean;
  createdAt: Date;
}

export interface EmailDetail {
  email: ControlOutreachEmail;
  prospect: ControlProspect;
  action: { id: number; status: string; decidedBy: string | null; decisionNote: string | null; error: string | null } | null;
  research: { status: string; facts: VenueFacts; sourceUrls: string[]; warnings: string[]; fetchedAt: Date } | null;
  assets: AssetView[];
  preview: { html: string; htmlDark: string; text: string; headers: Record<string, string> };
  warnings: StudioWarnings;
  editable: boolean;
  samplePreviewsEnabled: boolean;
}

export async function getEmailDetail(emailId: number): Promise<EmailDetail | null> {
  const [email] = await db.select().from(controlOutreachEmailsTable).where(eq(controlOutreachEmailsTable.id, emailId));
  if (!email) return null;
  const prospect = await loadProspectById(email.prospectId);
  if (!prospect) return null;
  const [research, assets, actionRow] = await Promise.all([
    loadResearch(prospect.id),
    loadProspectAssets(prospect.id),
    email.actionId
      ? db
          .select({
            id: agentActionsTable.id,
            status: agentActionsTable.status,
            decidedBy: agentActionsTable.decidedBy,
            decisionNote: agentActionsTable.decisionNote,
            error: agentActionsTable.error,
          })
          .from(agentActionsTable)
          .where(eq(agentActionsTable.id, email.actionId))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const options = {
    postalAddress: outreachPostalAddress(),
    unsubscribeMailbox: outreachUnsubscribeMailbox(),
    imageUrl: publicObjectUrl,
  };
  const light = renderEmailRow(email, prospect, assets, options);
  const dark = renderEmailRow(email, prospect, assets, { ...options, forceScheme: "dark" });
  const inEmail = new Set(email.imageAssetIds);
  return {
    email,
    prospect,
    action: actionRow,
    research: research
      ? {
          status: research.status,
          facts: factsFromResearch(research, prospect),
          sourceUrls: research.sourceUrls,
          warnings: research.warnings,
          fetchedAt: research.fetchedAt,
        }
      : null,
    assets: assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      url: publicObjectUrl(asset.objectKey),
      sourceUrl: asset.sourceUrl,
      pageUrl: asset.pageUrl,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
      altText: asset.altText,
      score: asset.score,
      selected: asset.selected,
      inEmail: inEmail.has(asset.id),
      createdAt: asset.createdAt,
    })),
    preview: { html: light.html, htmlDark: dark.html, text: light.text, headers: light.headers },
    warnings: { research: research?.warnings ?? [], config: configWarnings() },
    editable: email.status === "draft" && (actionRow === null || actionRow.status === "pending"),
    samplePreviewsEnabled: samplePreviewsEnabled(),
  };
}

export interface EmailPatch {
  subject?: string;
  body?: string;
  greeting?: string;
  signOff?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  imageAssetIds?: number[];
}

export async function updateEmail(emailId: number, patch: EmailPatch, operatorEmail: string): Promise<EmailDetail> {
  const detail = await getEmailDetail(emailId);
  if (!detail) throw new Error(`Outreach email ${emailId} not found.`);
  if (!detail.editable) {
    throw new Error(`Outreach email ${emailId} is no longer editable (status ${detail.email.status}, action ${detail.action?.status ?? "none"}).`);
  }
  if (patch.imageAssetIds) {
    const owned = new Set(detail.assets.map((asset) => asset.id));
    for (const id of patch.imageAssetIds) {
      if (!owned.has(id)) throw new Error(`Image ${id} does not belong to this prospect.`);
    }
    if (patch.imageAssetIds.length > 3) throw new Error("An email carries at most three images.");
  }
  if (patch.ctaUrl !== undefined && !/^(https?:\/\/|mailto:)/i.test(patch.ctaUrl.trim())) {
    throw new Error("The call-to-action link must be an http(s) or mailto URL.");
  }
  const subject = patch.subject?.trim();
  const subjectOptions = subject && !detail.email.subjectOptions.includes(subject)
    ? [...detail.email.subjectOptions.slice(0, 2), subject].slice(-3)
    : detail.email.subjectOptions;

  await db
    .update(controlOutreachEmailsTable)
    .set({
      ...(subject !== undefined ? { subject, subjectOptions } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
      ...(patch.greeting !== undefined ? { greeting: patch.greeting.trim() } : {}),
      ...(patch.signOff !== undefined ? { signOff: patch.signOff.trim() } : {}),
      ...(patch.ctaLabel !== undefined ? { ctaLabel: patch.ctaLabel.trim() } : {}),
      ...(patch.ctaUrl !== undefined ? { ctaUrl: patch.ctaUrl.trim() } : {}),
      ...(patch.imageAssetIds !== undefined ? { imageAssetIds: patch.imageAssetIds } : {}),
      editedBy: operatorEmail,
      updatedAt: new Date(),
    })
    .where(eq(controlOutreachEmailsTable.id, emailId));

  if (subject && detail.action) {
    await db
      .update(agentActionsTable)
      .set({ title: `Email ${detail.prospect.name}: “${subject}”` })
      .where(eq(agentActionsTable.id, detail.action.id));
  }
  await recordAuditEvent({
    actorType: "operator",
    actor: operatorEmail,
    eventType: "outreach_email_edited",
    subjectType: "outreach_email",
    subjectId: emailId,
    detail: { fields: Object.keys(patch) },
  });
  const updated = await getEmailDetail(emailId);
  if (!updated) throw new Error("Email vanished during update.");
  return updated;
}

export async function regenerateEmail(
  emailId: number,
  mode: "copy" | "research" | "both",
  operatorEmail: string,
  options: { ask?: "call" | "preview"; researchDeps?: ResearchDeps } = {},
): Promise<EmailDetail> {
  const detail = await getEmailDetail(emailId);
  if (!detail) throw new Error(`Outreach email ${emailId} not found.`);
  if (!detail.editable) throw new Error(`Outreach email ${emailId} is no longer editable.`);
  const prospect = detail.prospect;

  let assets = await loadProspectAssets(prospect.id);
  let research = await loadResearch(prospect.id);
  if (mode === "research" || mode === "both") {
    const refreshed = await ensureResearch(prospect, { force: true, actor: `operator:${operatorEmail}`, deps: options.researchDeps });
    research = refreshed.research;
    assets = refreshed.assets;
    const selected = assets.filter((asset) => asset.selected && asset.kind === "venue_image").map((asset) => asset.id);
    await db
      .update(controlOutreachEmailsTable)
      .set({ imageAssetIds: selected, updatedAt: new Date() })
      .where(eq(controlOutreachEmailsTable.id, emailId));
  }
  if (mode === "copy" || mode === "both") {
    const facts = factsFromResearch(research, prospect);
    const copy = await writeCopy({
      facts,
      prospectName: prospect.name,
      contactName: prospect.contactName,
      ask: options.ask ?? (prospect.contactCount > 0 ? "call" : "preview"),
      contactCount: prospect.contactCount,
      stepGuidance: await stepGuidanceFor(detail.email.campaignId, detail.email.step),
    });
    await db
      .update(controlOutreachEmailsTable)
      .set({
        subjectOptions: copy.subjects,
        subject: copy.subjects[0],
        body: copy.body,
        greeting: copy.greeting,
        signOff: copy.signOff,
        ctaLabel: copy.ctaLabel,
        draftNotes: { ...copy.notes, regeneratedBy: operatorEmail, research: { status: research?.status ?? null, warnings: research?.warnings ?? [] } },
        editedBy: operatorEmail,
        updatedAt: new Date(),
      })
      .where(eq(controlOutreachEmailsTable.id, emailId));
    if (detail.action) {
      await db
        .update(agentActionsTable)
        .set({ title: `Email ${prospect.name}: “${copy.subjects[0]}”` })
        .where(eq(agentActionsTable.id, detail.action.id));
    }
  }
  await recordAuditEvent({
    actorType: "operator",
    actor: operatorEmail,
    eventType: "outreach_email_regenerated",
    subjectType: "outreach_email",
    subjectId: emailId,
    detail: { mode },
  });
  const updated = await getEmailDetail(emailId);
  if (!updated) throw new Error("Email vanished during regeneration.");
  return updated;
}

/** Mark studio emails whose action was rejected; called from the decision path. */
export async function markEmailsRejectedForAction(actionId: number): Promise<void> {
  try {
    await db
      .update(controlOutreachEmailsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(controlOutreachEmailsTable.actionId, actionId), eq(controlOutreachEmailsTable.status, "draft")));
  } catch (err) {
    logger.warn({ err, actionId }, "Could not sync outreach email status after rejection");
  }
}

/** Record a bounce/complaint/delivery from the provider against the email. */
export async function recordDeliveryEvent(input: {
  providerMessageId: string;
  eventType: "sent" | "delivered" | "bounced" | "complained" | "delivery_delayed";
  reason?: string | null;
  at: Date;
}): Promise<ControlOutreachEmail | null> {
  const [email] = await db
    .select()
    .from(controlOutreachEmailsTable)
    .where(eq(controlOutreachEmailsTable.providerMessageId, input.providerMessageId))
    .limit(1);
  if (!email) return null;
  const set: Partial<typeof controlOutreachEmailsTable.$inferInsert> = { updatedAt: input.at };
  if (input.eventType === "delivered") {
    set.status = "delivered";
    set.deliveredAt = input.at;
  } else if (input.eventType === "bounced") {
    set.status = "bounced";
    set.bouncedAt = input.at;
    set.bounceReason = input.reason ?? "bounced";
  } else if (input.eventType === "complained") {
    set.status = "complained";
  }
  const [updated] = await db
    .update(controlOutreachEmailsTable)
    .set(set)
    .where(eq(controlOutreachEmailsTable.id, email.id))
    .returning();
  return updated ?? email;
}

export async function loadAssetsByIds(ids: number[]): Promise<ControlProspectAsset[]> {
  if (ids.length === 0) return [];
  return db.select().from(controlProspectAssetsTable).where(inArray(controlProspectAssetsTable.id, ids));
}
