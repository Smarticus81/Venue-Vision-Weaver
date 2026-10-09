import {
  db,
  agentActionsTable,
  controlCampaignsTable,
  controlOutreachEmailsTable,
  controlProspectAssetsTable,
  controlProspectResearchTable,
  controlProspectsTable,
  type ControlCampaign,
  type ControlOutreachEmail,
  type ControlProspect,
  type ControlProspectAsset,
  type ControlProspectFact,
  type ControlProspectResearch,
  type ControlProspectVetting,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { recordAuditEvent } from "../audit.js";
import { proposeAction } from "../actions.js";
import { getPolicyBoolean } from "../policies.js";
import { afterResearch, beforeDraft } from "../growth/studioHooks.js";
import { isFreeMail, splitEmail } from "../vetting/domain.js";
import { attributeFacts, citableFacts, citedFactsIn, loadFacts, upsertFacts } from "../vetting/facts.js";
import type { VettingDeps } from "../vetting/deps.js";
import type { CitableFact } from "../vetting/types.js";
import { assertVettingAllowsOutreach, ensureVetted, loadVetting, vettingIsFresh } from "../vetting/vet.js";
import { newClaimToken } from "./claim.js";
import { assertProspectContactableNow } from "./contactGuards.js";
import {
  RESEARCH_FAILED_RETRY_HOURS,
  RESEARCH_STALE_DAYS,
  outreachDefaultCtaUrl,
  outreachPostalAddress,
  outreachReplyTo,
  outreachUnsubscribeMailbox,
  postalAddressIsPlaceholder,
  publicObjectUrl,
  senderIsSandbox,
} from "./config.js";
import { COPY_RULES, writeCopy, type CopyResult } from "./copywriter.js";
import { renderEmailRow } from "./sender.js";
import { loadGuard, type GuardState } from "./sendingHealth.js";
import { newUnsubscribeToken } from "./unsubscribe.js";
import { defaultResearchDeps, researchVenue, type ResearchDeps, type VenueFacts } from "./venueResearch.js";

/**
 * Studio orchestration: vet the prospect, research the venue's own site,
 * write a personal draft that cites verified facts, persist it with a claim
 * link, and raise the governed send action. Operators review, edit,
 * regenerate, and approve from /control; sending is the action's job and
 * sender.ts re-checks every gate at send time.
 */

export const SEND_OUTREACH_ACTION = "send_outreach_email";

export interface StudioWarnings {
  research: string[];
  config: string[];
  vetting: string[];
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

/**
 * Pure: successful research is reused for RESEARCH_STALE_DAYS; a failed
 * crawl is not retried on every draft but waits RESEARCH_FAILED_RETRY_HOURS
 * (a forced refresh always re-runs).
 */
export function researchIsFresh(research: Pick<ControlProspectResearch, "status" | "fetchedAt">, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - research.fetchedAt.getTime();
  if (research.status === "fetch_failed") return ageMs < RESEARCH_FAILED_RETRY_HOURS * 60 * 60 * 1000;
  return ageMs < RESEARCH_STALE_DAYS * 24 * 60 * 60 * 1000;
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

  // Attribution runs on what the site said (result.facts + its pages), never on
  // the merged view that defaults location to the agent-typed region.
  try {
    await upsertFacts(prospect.id, attributeFacts(result.facts, result.pages), options.actor);
  } catch (err) {
    logger.error({ err, prospectId: prospect.id }, "Outreach research: failed to persist attributed facts");
  }
  // Growth hook: re-classify the venue type from what the site actually says.
  await afterResearch(prospect.id, result.facts);

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

export function factsFromResearch(research: ControlProspectResearch | null, prospect: ControlProspect): VenueFacts {
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

/* ————— Campaign rules ————— */

/**
 * Pure: which campaign and step a draft belongs to. An explicit campaign must
 * be active, the prospect must be enrolled in it, and the step must be the
 * next one in the sequence. A campaign inherited from the prospect's
 * enrollment is used only while it is active (otherwise the note is a
 * standalone touch).
 */
export function resolveCampaignTouch(input: {
  requestedCampaignId: number | null;
  requestedStep: number | null;
  prospect: Pick<ControlProspect, "id" | "campaignId" | "campaignStep">;
  campaign: Pick<ControlCampaign, "id" | "status" | "steps"> | null;
}): { campaignId: number | null; step: number | null } {
  const { prospect, campaign } = input;
  const explicit = input.requestedCampaignId != null;
  const campaignId = input.requestedCampaignId ?? prospect.campaignId ?? null;
  if (campaignId == null) return { campaignId: null, step: input.requestedStep };
  if (!campaign || campaign.id !== campaignId) {
    if (explicit) throw new Error(`Campaign ${campaignId} not found.`);
    return { campaignId: null, step: input.requestedStep };
  }
  if (campaign.status !== "active") {
    if (explicit) throw new Error(`Campaign ${campaign.id} is "${campaign.status}"; only active campaigns may draft or send.`);
    return { campaignId: null, step: input.requestedStep };
  }
  if (prospect.campaignId !== campaign.id) {
    throw new Error(`Prospect ${prospect.id} is not enrolled in campaign ${campaign.id}; enroll it first.`);
  }
  const expected = prospect.campaignStep + 1;
  const step = input.requestedStep ?? expected;
  if (step !== expected) {
    throw new Error(`Campaign ${campaign.id}: prospect ${prospect.id} is due step ${expected}, not step ${step}.`);
  }
  if (step > campaign.steps.length) {
    throw new Error(`Campaign ${campaign.id} has ${campaign.steps.length} step(s); prospect ${prospect.id} has completed the sequence.`);
  }
  return { campaignId: campaign.id, step };
}

async function loadCampaign(campaignId: number | null): Promise<ControlCampaign | null> {
  if (!campaignId) return null;
  const [row] = await db.select().from(controlCampaignsTable).where(eq(controlCampaignsTable.id, campaignId));
  return row ?? null;
}

/* ————— Readiness: config, guard and vetting warnings, approvability ————— */

export interface SendReadiness {
  postalPlaceholder: boolean;
  resendConfigured: boolean;
  replyTo: string | null;
  replyToFreeMail: boolean;
  sandboxSender: boolean;
  sendsEnabled: boolean;
  requireReplyTo: boolean;
  guard: GuardState;
}

export async function loadSendReadiness(): Promise<SendReadiness> {
  const replyTo = outreachReplyTo();
  const [guard, sendsEnabled, requireReplyTo] = await Promise.all([
    loadGuard(),
    getPolicyBoolean("outreach_sends_enabled", "enabled", true),
    getPolicyBoolean("outreach_require_reply_to", "enabled", true),
  ]);
  return {
    postalPlaceholder: postalAddressIsPlaceholder(),
    resendConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
    replyTo,
    replyToFreeMail: replyTo ? isFreeMail(splitEmail(replyTo)?.domain ?? "") : false,
    sandboxSender: senderIsSandbox(),
    sendsEnabled,
    requireReplyTo,
    guard,
  };
}

/** Pure: operator-facing configuration warnings (vetting.md 6.4). */
export function configWarningsFor(state: SendReadiness): string[] {
  const warnings: string[] = [];
  if (state.postalPlaceholder) {
    warnings.push("OUTREACH_POSTAL_ADDRESS is not set; the footer shows a placeholder address and sends are refused until a real one is configured (CAN-SPAM).");
  }
  if (!state.resendConfigured) {
    warnings.push("RESEND_API_KEY is not set; approving will fail until email delivery is configured.");
  }
  if (state.sandboxSender) {
    warnings.push("EMAIL_FROM is unset or the Resend sandbox sender; sends are refused until a sender on a verified domain is configured.");
  }
  if (!state.replyTo) {
    warnings.push("OUTREACH_REPLY_TO is not set; sends are refused until a monitored mailbox is configured.");
  } else if (state.replyToFreeMail) {
    warnings.push("OUTREACH_REPLY_TO is a free-mail address; mailbox providers treat a company From with a Gmail Reply-To as spam.");
  }
  if (!state.sendsEnabled) {
    warnings.push("Outbound prospect email is frozen (policy outreach_sends_enabled = false); approvals wait until it is turned back on.");
  }
  if (state.guard.status === "paused") {
    warnings.push(
      `Outreach sending is paused by the deliverability guard${state.guard.reason ? `: ${state.guard.reason}` : ""}. Reset it in /control → Outreach once the cause is understood.`,
    );
  } else if (state.guard.status === "warn" || state.guard.status === "throttled") {
    warnings.push(`Deliverability guard (${state.guard.status})${state.guard.reason ? `: ${state.guard.reason}` : ""}.`);
  }
  return warnings;
}

/** Pure: why the vetting state would stop (or delay) this email. */
export function vettingWarningsFor(
  vetting: Pick<ControlProspectVetting, "status" | "score" | "expiresAt" | "summary"> | null,
  now: Date = new Date(),
): string[] {
  if (!vetting) return ["Vetting has not run for this venue; it runs before drafting and again on approve."];
  const warnings: string[] = [];
  if (vetting.status === "review") warnings.push(`Legitimacy ${vetting.score}/100 needs an operator decision (Pipeline → Evidence → Override).`);
  if (vetting.status === "failed") warnings.push(`Vetting failed: ${vetting.summary}`);
  if (vetting.status === "error") warnings.push(`Vetting could not complete (${vetting.summary}); re-run it from Pipeline → Evidence.`);
  if (vetting.status === "passed" && vetting.expiresAt.getTime() <= now.getTime()) {
    const days = Math.max(1, Math.round((now.getTime() - vetting.expiresAt.getTime()) / 86_400_000));
    warnings.push(`Vetting expired ${days} day${days === 1 ? "" : "s"} ago; it will re-run on approve.`);
  }
  return warnings;
}

/**
 * Pure: can an operator approve this email right now and expect it to send?
 * (vetting.md 3.6, plus the sender's hard blocks: sandbox sender, frozen
 * sends.) The UI disables Approve with the warnings as the reason.
 */
export function computeApprovable(input: {
  editable: boolean;
  vetting: Pick<ControlProspectVetting, "status" | "expiresAt"> | null;
  citedFacts: number;
  readiness: Pick<SendReadiness, "postalPlaceholder" | "replyTo" | "sandboxSender" | "sendsEnabled" | "requireReplyTo" | "guard">;
  now?: Date;
}): boolean {
  const { readiness } = input;
  return (
    input.editable &&
    input.vetting?.status === "passed" &&
    vettingIsFresh(input.vetting, input.now ?? new Date()) &&
    input.citedFacts >= COPY_RULES.minCitedFacts &&
    readiness.guard.status !== "paused" &&
    readiness.sendsEnabled &&
    !readiness.postalPlaceholder &&
    !readiness.sandboxSender &&
    (Boolean(readiness.replyTo) || !readiness.requireReplyTo)
  );
}

function tooFewFactsMessage(prospectId: number, count: number): string {
  return `Prospect ${prospectId} has ${count} verified venue fact(s) (need ${COPY_RULES.minCitedFacts}: named space, location, capacity, or a published owner name). Re-run research, or add a fact with its source in Pipeline → Evidence.`;
}

/* ————— Drafting ————— */

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
  vettingDeps?: VettingDeps;
  /** Force a control_copy_variants key; null/omitted lets the growth hook choose. */
  variantKey?: string | null;
}

/** Advisory-lock namespace (first int4 key) serializing draft creation per prospect. */
const DRAFT_LOCK_NAMESPACE = 7_270_302;
/** A draft inserted this recently without its action yet is still being proposed. */
const UNLINKED_DRAFT_WINDOW_MS = 15 * 60_000;

/**
 * An open outreach email for the prospect: one whose send action is pending,
 * approved or executing, or a draft inserted moments ago whose action is not
 * linked yet (another createDraft is between its insert and its proposal).
 */
export function openDraftWhere(prospectId: number, now: Date = new Date()) {
  const unlinkedSince = new Date(now.getTime() - UNLINKED_DRAFT_WINDOW_MS);
  return and(
    eq(controlOutreachEmailsTable.prospectId, prospectId),
    sql`(${agentActionsTable.status} in ('pending', 'approved', 'executing') or (${controlOutreachEmailsTable.actionId} is null and ${controlOutreachEmailsTable.status} = 'draft' and ${controlOutreachEmailsTable.createdAt} >= ${unlinkedSince}))`,
  );
}

async function findOpenDraft(executor: Pick<typeof db, "select">, prospectId: number) {
  const [row] = await executor
    .select({ id: controlOutreachEmailsTable.id, actionId: controlOutreachEmailsTable.actionId })
    .from(controlOutreachEmailsTable)
    .leftJoin(agentActionsTable, eq(controlOutreachEmailsTable.actionId, agentActionsTable.id))
    .where(openDraftWhere(prospectId))
    .limit(1);
  return row ?? null;
}

function openDraftMessage(prospectId: number, existing: { id: number; actionId: number | null }): string {
  return `Prospect ${prospectId} already has outreach email #${existing.id} waiting for approval${
    existing.actionId != null ? ` (action #${existing.actionId})` : ""
  }; review that one instead of drafting another.`;
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

  // Cheap early refusal; repeated under a per-prospect lock right before the insert.
  const pendingExisting = await findOpenDraft(db, prospect.id);
  if (pendingExisting) throw new Error(openDraftMessage(prospect.id, pendingExisting));

  // Campaign membership and step order before any spend.
  const requestedCampaignId = input.campaignId ?? null;
  const campaign = await loadCampaign(requestedCampaignId ?? prospect.campaignId ?? null);
  const touch = resolveCampaignTouch({
    requestedCampaignId,
    requestedStep: input.step ?? null,
    prospect,
    campaign,
  });

  // Legitimacy gate: refresh when missing/expired, then refuse anything but "passed".
  const { vetting } = await ensureVetted(prospect, { requestedBy: input.actor, deps: input.vettingDeps });
  assertVettingAllowsOutreach(vetting, prospect.id);

  const { research, assets } = await ensureResearch(prospect, {
    force: input.forceResearch,
    actor: input.actor,
    deps: input.researchDeps,
  });
  const factRows = await loadFacts(prospect.id);
  if (research.status === "fetch_failed" && !factRows.some((row) => row.sourceKind === "operator")) {
    throw new Error(
      `The website for prospect ${prospect.id} could not be loaded (${research.warnings[0] ?? "fetch failed"}); a generic note will not be drafted. Retry research later, or add verified facts with their sources in Pipeline → Evidence.`,
    );
  }
  const facts = factsFromResearch(research, prospect);
  const citable = citableFacts(factRows);
  if (citable.length < COPY_RULES.minCitedFacts) throw new Error(tooFewFactsMessage(prospect.id, citable.length));
  const verifiedOwner = citable.find((fact) => fact.kind === "owner_name")?.value ?? null;

  // Growth hook: copy-variant choice (and the max_campaign_steps refusal once growth lands).
  const growth = await beforeDraft({
    prospect,
    campaignId: touch.campaignId,
    step: touch.step,
    requestedVariantKey: input.variantKey ?? null,
  });
  const copy = await writeCopy({
    facts,
    verifiedFacts: citable,
    prospectName: prospect.name,
    contactName: verifiedOwner,
    ask: input.ask ?? (prospect.contactCount > 0 ? "call" : "preview"),
    contactCount: prospect.contactCount,
    stepGuidance: await stepGuidanceFor(touch.campaignId, touch.step),
    variantAngle: growth.variantAngle,
  });
  const cited = citedFactsIn(copy, citable);
  if (cited.length < COPY_RULES.minCitedFacts) {
    throw new Error(
      `The draft for prospect ${prospect.id} cites ${cited.length} verified venue fact(s); at least ${COPY_RULES.minCitedFacts} are required. Add a fact with its source in Pipeline → Evidence and draft again.`,
    );
  }

  const claimToken = newClaimToken();
  const selectedImageIds = assets.filter((asset) => asset.selected && asset.kind === "venue_image").map((asset) => asset.id);
  // Research and copy take seconds; a concurrent createDraft (agent and
  // operator, or two runs) may have inserted meanwhile. Re-check and insert
  // under a per-prospect advisory lock so only one sendable draft exists.
  const email = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DRAFT_LOCK_NAMESPACE}, ${prospect.id})`);
    const raced = await findOpenDraft(tx, prospect.id);
    if (raced) throw new Error(openDraftMessage(prospect.id, raced));
    const [inserted] = await tx
      .insert(controlOutreachEmailsTable)
      .values({
        prospectId: prospect.id,
        campaignId: touch.campaignId,
        step: touch.step,
        variantKey: growth.variantKey,
        status: "draft",
        subjectOptions: copy.subjects,
        subject: copy.subjects[0],
        body: copy.body,
        greeting: copy.greeting,
        signOff: copy.signOff,
        ctaLabel: copy.ctaLabel,
        ctaUrl: outreachDefaultCtaUrl(facts.name ?? prospect.name, {
          token: claimToken,
          campaignId: touch.campaignId,
          variantKey: growth.variantKey,
          step: touch.step,
        }),
        imageAssetIds: selectedImageIds,
        draftNotes: { ...copy.notes, research: { status: research.status, warnings: research.warnings } },
        citedFacts: cited,
        vettingSnapshot: { status: vetting.status, score: vetting.score, vettedAt: vetting.vettedAt.toISOString() },
        unsubscribeToken: newUnsubscribeToken(),
        claimToken,
        createdByAgent: input.agentKey,
      })
      .returning();
    return inserted;
  });
  if (!email) throw new Error("Failed to persist outreach draft.");

  const readiness = await loadSendReadiness();
  const warnings: StudioWarnings = {
    research: research.warnings,
    config: configWarningsFor(readiness),
    vetting: vettingWarningsFor(vetting),
  };
  const action = await proposeAction({
    agentKey: input.agentKey,
    runId: input.runId,
    actionType: SEND_OUTREACH_ACTION,
    title: `Email ${prospect.name}: “${email.subject}”`,
    reasoning: [
      `Studio draft #${email.id} for ${prospect.email} (${prospect.status}, ${prospect.contactCount} prior emails).`,
      `Copy source: ${copy.notes.source}; ${copy.notes.wordCount} words; ${selectedImageIds.length} venue photo(s) from ${research.sourceUrls[0] ?? "no site"}.`,
      `Variant: ${growth.variantKey ?? "none"}`,
      `Vetting: ${vetting.summary}`,
      `Cites: ${cited.map((fact) => `${fact.kind}=${fact.value}`).join(", ")}`,
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
    detail: {
      prospectId: prospect.id,
      actionId: action.id,
      copySource: copy.notes.source,
      images: selectedImageIds.length,
      citedFacts: cited.length,
      campaignId: touch.campaignId,
      step: touch.step,
    },
  });

  return { email: linked ?? email, actionId: action.id, actionStatus: action.status, copy: copy.notes, warnings };
}

/* ————— Operator views ————— */

export interface EmailListRow {
  email: ControlOutreachEmail;
  prospect: Pick<ControlProspect, "id" | "name" | "email" | "contactName" | "status" | "vettingStatus" | "website" | "region">;
  actionStatus: string | null;
  imageCount: number;
}

export async function listEmails(filter: {
  status?: string | null;
  prospectId?: number | null;
  /** Only drafts whose send action is still waiting for an operator. */
  awaiting?: boolean;
  limit: number;
  offset?: number;
}): Promise<EmailListRow[]> {
  const conditions = [];
  if (filter.status) conditions.push(eq(controlOutreachEmailsTable.status, filter.status));
  if (filter.prospectId) conditions.push(eq(controlOutreachEmailsTable.prospectId, filter.prospectId));
  if (filter.awaiting) {
    conditions.push(eq(controlOutreachEmailsTable.status, "draft"), eq(agentActionsTable.status, "pending"));
  }
  const rows = await db
    .select({
      email: controlOutreachEmailsTable,
      prospect: {
        id: controlProspectsTable.id,
        name: controlProspectsTable.name,
        email: controlProspectsTable.email,
        contactName: controlProspectsTable.contactName,
        status: controlProspectsTable.status,
        vettingStatus: controlProspectsTable.vettingStatus,
        website: controlProspectsTable.website,
        region: controlProspectsTable.region,
      },
      actionStatus: agentActionsTable.status,
    })
    .from(controlOutreachEmailsTable)
    .innerJoin(controlProspectsTable, eq(controlOutreachEmailsTable.prospectId, controlProspectsTable.id))
    .leftJoin(agentActionsTable, eq(controlOutreachEmailsTable.actionId, agentActionsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(controlOutreachEmailsTable.updatedAt), desc(controlOutreachEmailsTable.id))
    .limit(filter.limit)
    .offset(filter.offset ?? 0);
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

export function toAssetView(asset: ControlProspectAsset, inEmail: Set<number>): AssetView {
  return {
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
  };
}

export interface EmailDetail {
  email: ControlOutreachEmail;
  prospect: ControlProspect;
  action: { id: number; status: string; decidedBy: string | null; decisionNote: string | null; error: string | null } | null;
  research: { status: string; facts: VenueFacts; sourceUrls: string[]; warnings: string[]; fetchedAt: Date } | null;
  vetting: ControlProspectVetting | null;
  facts: ControlProspectFact[];
  assets: AssetView[];
  preview: { html: string; htmlDark: string; text: string; headers: Record<string, string> };
  warnings: StudioWarnings;
  editable: boolean;
  approvable: boolean;
}

export async function getEmailDetail(emailId: number): Promise<EmailDetail | null> {
  const [email] = await db.select().from(controlOutreachEmailsTable).where(eq(controlOutreachEmailsTable.id, emailId));
  if (!email) return null;
  const prospect = await loadProspectById(email.prospectId);
  if (!prospect) return null;
  const [research, assets, actionRow, vetting, facts, readiness] = await Promise.all([
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
    loadVetting(prospect.id),
    loadFacts(prospect.id),
    loadSendReadiness(),
  ]);

  const options = {
    postalAddress: outreachPostalAddress(),
    unsubscribeMailbox: outreachUnsubscribeMailbox(),
    imageUrl: publicObjectUrl,
  };
  const light = renderEmailRow(email, prospect, assets, options);
  const dark = renderEmailRow(email, prospect, assets, { ...options, forceScheme: "dark" });
  const inEmail = new Set(email.imageAssetIds);
  const editable = email.status === "draft" && (actionRow === null || actionRow.status === "pending");
  const researchWarnings = [...(research?.warnings ?? [])];
  const notes = (email.draftNotes ?? {}) as { source?: unknown };
  if (notes.source === "fallback" && email.imageAssetIds.length === 0) {
    researchWarnings.push("Template copy with no venue photos: consider regenerating or adding photos before approving.");
  }
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
    vetting,
    facts,
    assets: assets.map((asset) => toAssetView(asset, inEmail)),
    preview: { html: light.html, htmlDark: dark.html, text: light.text, headers: light.headers },
    warnings: { research: researchWarnings, config: configWarningsFor(readiness), vetting: vettingWarningsFor(vetting) },
    editable,
    approvable: computeApprovable({ editable, vetting, citedFacts: email.citedFacts?.length ?? 0, readiness }),
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

export const EDIT_TOO_FEW_FACTS =
  "This edit leaves fewer than two verified venue facts in the email (named space, location, capacity, or published owner name). Keep at least two so the note is unmistakably about this venue.";

/**
 * Guard for operator edits: the row must still be a draft whose action (if
 * any) is still pending. Research and Grok take seconds; if the email was
 * approved and sent meanwhile, the sent record must keep what the venue got.
 */
export function editableEmailWhere(emailId: number) {
  return and(
    eq(controlOutreachEmailsTable.id, emailId),
    eq(controlOutreachEmailsTable.status, "draft"),
    sql`(${controlOutreachEmailsTable.actionId} is null or exists (select 1 from ${agentActionsTable} where ${agentActionsTable.id} = ${controlOutreachEmailsTable.actionId} and ${agentActionsTable.status} = 'pending'))`,
  );
}

function changedWhileEditing(emailId: number): Error {
  return new Error(`Outreach email ${emailId} was approved, sent or changed while you were editing; your edit was not applied.`);
}

/** Retitle the email's action only while it is still pending. */
async function retitlePendingAction(actionId: number, title: string): Promise<void> {
  await db
    .update(agentActionsTable)
    .set({ title })
    .where(and(eq(agentActionsTable.id, actionId), eq(agentActionsTable.status, "pending")));
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
  if (subject !== undefined && /^\s*(re|fwd?)\s*:/i.test(subject)) {
    throw new Error("Subject must not fake a reply or forward.");
  }
  const subjectOptions = subject && !detail.email.subjectOptions.includes(subject)
    ? [...detail.email.subjectOptions.slice(0, 2), subject].slice(-3)
    : detail.email.subjectOptions;

  let cited: CitableFact[] | undefined;
  if (patch.body !== undefined || patch.greeting !== undefined) {
    const nextBody = patch.body !== undefined ? patch.body.trim() : detail.email.body;
    const nextGreeting = patch.greeting !== undefined ? patch.greeting.trim() : detail.email.greeting;
    cited = citedFactsIn({ greeting: nextGreeting, body: nextBody }, citableFacts(detail.facts));
    if (cited.length < COPY_RULES.minCitedFacts) throw new Error(EDIT_TOO_FEW_FACTS);
  }

  const edited = await db
    .update(controlOutreachEmailsTable)
    .set({
      ...(subject !== undefined ? { subject, subjectOptions } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
      ...(patch.greeting !== undefined ? { greeting: patch.greeting.trim() } : {}),
      ...(patch.signOff !== undefined ? { signOff: patch.signOff.trim() } : {}),
      ...(patch.ctaLabel !== undefined ? { ctaLabel: patch.ctaLabel.trim() } : {}),
      ...(patch.ctaUrl !== undefined ? { ctaUrl: patch.ctaUrl.trim() } : {}),
      ...(patch.imageAssetIds !== undefined ? { imageAssetIds: patch.imageAssetIds } : {}),
      ...(cited !== undefined ? { citedFacts: cited } : {}),
      editedBy: operatorEmail,
      updatedAt: new Date(),
    })
    .where(editableEmailWhere(emailId))
    .returning({ id: controlOutreachEmailsTable.id });
  if (edited.length === 0) throw changedWhileEditing(emailId);

  if (subject && detail.action) {
    await retitlePendingAction(detail.action.id, `Email ${detail.prospect.name}: “${subject}”`);
  }
  await recordAuditEvent({
    actorType: "operator",
    actor: operatorEmail,
    eventType: "outreach_email_edited",
    subjectType: "outreach_email",
    subjectId: emailId,
    detail: { fields: Object.keys(patch), citedFacts: cited?.length ?? null },
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
    const reimaged = await db
      .update(controlOutreachEmailsTable)
      .set({ imageAssetIds: selected, updatedAt: new Date() })
      .where(editableEmailWhere(emailId))
      .returning({ id: controlOutreachEmailsTable.id });
    if (reimaged.length === 0) throw changedWhileEditing(emailId);
  }
  if (mode === "copy" || mode === "both") {
    const facts = factsFromResearch(research, prospect);
    const citable = citableFacts(await loadFacts(prospect.id));
    if (citable.length < COPY_RULES.minCitedFacts) throw new Error(tooFewFactsMessage(prospect.id, citable.length));
    const copy = await writeCopy({
      facts,
      verifiedFacts: citable,
      prospectName: prospect.name,
      contactName: citable.find((fact) => fact.kind === "owner_name")?.value ?? null,
      ask: options.ask ?? (prospect.contactCount > 0 ? "call" : "preview"),
      contactCount: prospect.contactCount,
      stepGuidance: await stepGuidanceFor(detail.email.campaignId, detail.email.step),
    });
    const cited = citedFactsIn(copy, citable);
    if (cited.length < COPY_RULES.minCitedFacts) {
      throw new Error(
        `The regenerated draft cites ${cited.length} verified venue fact(s); at least ${COPY_RULES.minCitedFacts} are required. The previous copy was kept.`,
      );
    }
    const rewritten = await db
      .update(controlOutreachEmailsTable)
      .set({
        subjectOptions: copy.subjects,
        subject: copy.subjects[0],
        body: copy.body,
        greeting: copy.greeting,
        signOff: copy.signOff,
        ctaLabel: copy.ctaLabel,
        citedFacts: cited,
        draftNotes: { ...copy.notes, regeneratedBy: operatorEmail, research: { status: research?.status ?? null, warnings: research?.warnings ?? [] } },
        editedBy: operatorEmail,
        updatedAt: new Date(),
      })
      .where(editableEmailWhere(emailId))
      .returning({ id: controlOutreachEmailsTable.id });
    if (rewritten.length === 0) throw changedWhileEditing(emailId);
    if (detail.action) {
      await retitlePendingAction(detail.action.id, `Email ${prospect.name}: “${copy.subjects[0]}”`);
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

/* ————— Provider events ————— */

export type DeliveryEventType = "sent" | "delivered" | "bounced" | "complained" | "delivery_delayed" | "opened" | "clicked";

/**
 * Pure: the column changes one provider event makes to an email. Status is
 * monotonic (draft < sent < delivered < bounced < complained): a late
 * "delivered" never overwrites a bounce or complaint, and opens/clicks only
 * stamp their first timestamp (a click implies an open).
 */
export function deliveryEventPatch(
  email: Pick<ControlOutreachEmail, "status" | "deliveredAt" | "openedAt" | "clickedAt">,
  event: { eventType: DeliveryEventType; reason?: string | null; at: Date },
): Partial<typeof controlOutreachEmailsTable.$inferInsert> {
  const rank: Record<string, number> = { draft: 0, failed: 0, rejected: 0, sent: 1, delivered: 2, bounced: 3, complained: 4 };
  const current = rank[email.status] ?? 0;
  const patch: Partial<typeof controlOutreachEmailsTable.$inferInsert> = {};
  switch (event.eventType) {
    case "delivered":
      if (!email.deliveredAt) patch.deliveredAt = event.at;
      if (current < rank.delivered!) patch.status = "delivered";
      break;
    case "bounced":
      if (current < rank.bounced!) {
        patch.status = "bounced";
        patch.bouncedAt = event.at;
        patch.bounceReason = event.reason ?? "bounced";
      }
      break;
    case "complained":
      if (current < rank.complained!) patch.status = "complained";
      break;
    case "opened":
      if (!email.openedAt) patch.openedAt = event.at;
      break;
    case "clicked":
      if (!email.openedAt) patch.openedAt = event.at;
      if (!email.clickedAt) patch.clickedAt = event.at;
      break;
    case "sent":
    case "delivery_delayed":
      break;
  }
  return patch;
}

/** Record a delivery or engagement event from the provider against the studio email it belongs to. */
export async function recordDeliveryEvent(input: {
  providerMessageId: string;
  eventType: DeliveryEventType;
  reason?: string | null;
  at: Date;
}): Promise<ControlOutreachEmail | null> {
  const [email] = await db
    .select()
    .from(controlOutreachEmailsTable)
    .where(eq(controlOutreachEmailsTable.providerMessageId, input.providerMessageId))
    .limit(1);
  if (!email) return null;
  const patch = deliveryEventPatch(email, input);
  if (Object.keys(patch).length === 0) return email;
  const [updated] = await db
    .update(controlOutreachEmailsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(controlOutreachEmailsTable.id, email.id))
    .returning();
  return updated ?? email;
}
