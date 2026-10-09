import { z } from "zod";
import {
  db,
  venuesTable,
  organizationsTable,
  coupleSessionsTable,
  controlAgentsTable,
  agentActionsTable,
  controlProspectsTable,
  controlCampaignsTable,
  creditTransactionsTable,
  type AgentAction,
  type ActionRiskLevel,
} from "@workspace/db";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { grantCreditsToOrg } from "../lib/credits.js";
import { sendRawEmail } from "../lib/emailService.js";
import { logger } from "../lib/logger.js";
import { recordAuditEvent } from "./audit.js";
import { startOfUtcDay } from "./actionCounts.js";
import { getAgentDefinition } from "./agents.js";
import { growthActions } from "./growth/actions.js";
import { getPolicyBoolean, getPolicyNumber, setPolicy, validatePolicyUpdate } from "./policies.js";
import { outreachPostalAddress, outreachReplyTo, outreachUnsubscribeMailbox } from "./outreach/config.js";
import { isDeferredSendError } from "./outreach/sendErrors.js";
import { defaultSendDeps, sendOutreachEmail } from "./outreach/sender.js";
import { markEmailsRejectedForAction } from "./outreach/studio.js";
import { isSuppressed } from "./outreach/unsubscribe.js";
import { renderVenueEmail } from "./outreach/venueEmail.js";

/**
 * The only way agents touch the business is through this catalog. Every
 * action type declares its risk level and a strict parameter schema; medium
 * and high risk actions always wait for an operator approval, low risk
 * actions auto-execute when governance policy allows it.
 */
export interface ActionDefinition {
  type: string;
  riskLevel: ActionRiskLevel;
  description: string;
  paramsSchema: z.ZodType<Record<string, unknown>>;
  /** ctx.actionId is the row being executed (already claimed as "executing"). */
  execute: (params: Record<string, unknown>, ctx?: { actionId: number }) => Promise<Record<string, unknown>>;
  /** Retired types stay in the catalog so historical rows render; proposing or approving them is refused. */
  retired?: boolean;
  /** Low-risk actions may still demand approval (e.g. until a policy flag is flipped). */
  requiresApproval?: () => Promise<boolean>;
}

/**
 * Pure: low risk auto-executes only when the policy allows AND the
 * definition does not override. Medium/high risk always needs approval.
 */
export function computeRequiresApproval(
  definition: Pick<ActionDefinition, "riskLevel">,
  autoLowRisk: boolean,
  override: boolean,
): boolean {
  return definition.riskLevel !== "low" || !autoLowRisk || override;
}

async function creditsGrantedToday(): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum((${agentActionsTable.params} ->> 'amount')::int), 0)::int`,
    })
    .from(agentActionsTable)
    .where(
      and(
        eq(agentActionsTable.actionType, "grant_promo_credits"),
        eq(agentActionsTable.status, "executed"),
        gte(agentActionsTable.executedAt, startOfUtcDay()),
      ),
    );
  return row?.total ?? 0;
}

const sendVenueEmailSchema = z
  .object({
    venueSlug: z.string().min(1),
    subject: z.string().min(3).max(140),
    message: z
      .string()
      .min(20)
      .max(4000)
      .describe("Plain-text body. Paragraphs separated by blank lines."),
  })
  .strict();

const grantPromoCreditsSchema = z
  .object({
    organizationId: z.number().int().positive(),
    amount: z.number().int().positive(),
    note: z.string().min(5).max(400),
  })
  .strict();

const requeueFailedSessionSchema = z.object({ sessionId: z.number().int().positive() }).strict();

const agentKeySchema = z.object({ agentKey: z.string().min(1) }).strict();

const updatePolicySchema = z
  .object({
    key: z.string().min(1),
    value: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])),
    note: z.string().min(5).max(400),
  })
  .strict();

const sendProspectEmailSchema = z
  .object({
    prospectId: z.number().int().positive(),
    subject: z.string().min(3).max(140),
    message: z
      .string()
      .min(20)
      .max(4000)
      .describe("Plain-text body. Paragraphs separated by blank lines."),
    campaignId: z.number().int().positive().optional(),
    step: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const enrollProspectsSchema = z
  .object({
    campaignId: z.number().int().positive(),
    prospectIds: z.array(z.number().int().positive()).min(1).max(25),
  })
  .strict();

const campaignIdSchema = z.object({ campaignId: z.number().int().positive() }).strict();

const sendOutreachEmailSchema = z
  .object({
    emailId: z.number().int().positive().describe("control_outreach_emails.id created by draft_outreach_email."),
  })
  .strict();

/** Shown (and thrown) for the retired plain-text prospect email. */
export const SEND_PROSPECT_EMAIL_RETIRED =
  "send_prospect_email is retired: prospects are emailed only through the outreach studio (draft_outreach_email → send_outreach_email). Reject this action and draft through the studio.";

/**
 * send_venue_email rows that count toward today's cap: executed today, and
 * executing (claimed today) with a lower id than the caller, so the earlier
 * claim wins and later ones see it while it is still in flight.
 */
export function venueEmailCapWhere(selfActionId: number | null, since: Date = startOfUtcDay()) {
  return and(
    eq(agentActionsTable.actionType, "send_venue_email"),
    gte(agentActionsTable.executedAt, since),
    selfActionId == null
      ? sql`${agentActionsTable.status} in ('executed', 'executing')`
      : sql`(${agentActionsTable.status} = 'executed' or (${agentActionsTable.status} = 'executing' and ${agentActionsTable.id} < ${selfActionId}))`,
  );
}

async function venueEmailsCountedToday(selfActionId: number | null): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentActionsTable)
    .where(venueEmailCapWhere(selfActionId));
  return row?.total ?? 0;
}

const CORE_ACTIONS: Record<string, ActionDefinition> = {
  send_venue_email: {
    type: "send_venue_email",
    riskLevel: "high",
    description:
      "Send an operational/outreach email to a venue owner (activation nudge, low-credit reminder, support follow-up).",
    paramsSchema: sendVenueEmailSchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams, ctx) {
      const params = sendVenueEmailSchema.parse(rawParams);
      const cap = await getPolicyNumber("max_outbound_emails_per_day", "emails", 25);
      // Completed sends plus sends already in flight that were claimed first
      // (lower id): concurrent approvals cannot all pass on the same count.
      const sentToday = await venueEmailsCountedToday(ctx?.actionId ?? null);
      if (sentToday >= cap) {
        throw new Error(`Daily outbound email cap reached (${sentToday}/${cap}).`);
      }
      const [venue] = await db
        .select({ id: venuesTable.id, name: venuesTable.name, ownerEmail: venuesTable.ownerEmail })
        .from(venuesTable)
        .where(eq(venuesTable.slug, params.venueSlug));
      if (!venue) throw new Error(`Venue "${params.venueSlug}" not found.`);
      if (!venue.ownerEmail) throw new Error(`Venue "${params.venueSlug}" has no owner email.`);
      if (await isSuppressed(venue.ownerEmail)) {
        throw new Error(`${venue.ownerEmail} is on the suppression list (unsubscribed, bounced, or complained) and must not be emailed.`);
      }
      const replyTo = outreachReplyTo();
      const rendered = renderVenueEmail({
        subject: params.subject,
        paragraphs: params.message.split(/\n\s*\n/),
        venueName: venue.name,
        postalAddress: outreachPostalAddress(),
        unsubscribeMailbox: outreachUnsubscribeMailbox() ?? replyTo,
      });
      const delivery = await sendRawEmail({
        to: venue.ownerEmail,
        subject: params.subject,
        html: rendered.html,
        text: rendered.text,
        headers: rendered.headers,
        replyTo,
      });
      if (!delivery.sent) throw new Error(delivery.reason);
      return { sent: true, to: venue.ownerEmail, venueId: venue.id, providerId: delivery.id };
    },
  },
  send_prospect_email: {
    type: "send_prospect_email",
    riskLevel: "high",
    retired: true,
    description:
      "RETIRED. Plain-text prospect email that bypassed the outreach studio and vetting. New proposals are refused and pending ones cannot be approved; use draft_outreach_email, which produces a vetted, reviewed studio email.",
    // Kept so historical rows still parse for display.
    paramsSchema: sendProspectEmailSchema as z.ZodType<Record<string, unknown>>,
    async execute() {
      throw new Error(SEND_PROSPECT_EMAIL_RETIRED);
    },
  },
  send_outreach_email: {
    type: "send_outreach_email",
    riskLevel: "high",
    description:
      "Send a studio outreach email (venue photos + personal copy) that was drafted with draft_outreach_email and reviewed by an operator in /control. Re-checks consent, suppression list, contact gaps, lifetime caps, and the daily cap at send time.",
    paramsSchema: sendOutreachEmailSchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = sendOutreachEmailSchema.parse(rawParams);
      const result = await sendOutreachEmail(params.emailId, defaultSendDeps());
      return { ...result };
    },
  },
  enroll_prospects_in_campaign: {
    type: "enroll_prospects_in_campaign",
    riskLevel: "medium",
    description:
      "Enroll qualified prospects into an outreach campaign (max 25 per action). Enrollment stages future sends; each email still needs its own approval.",
    paramsSchema: enrollProspectsSchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = enrollProspectsSchema.parse(rawParams);
      const [campaign] = await db
        .select()
        .from(controlCampaignsTable)
        .where(eq(controlCampaignsTable.id, params.campaignId));
      if (!campaign) throw new Error(`Campaign ${params.campaignId} not found.`);
      if (campaign.status !== "draft" && campaign.status !== "active") {
        throw new Error(`Campaign ${campaign.id} is "${campaign.status}" and cannot take enrollments.`);
      }

      const prospects = await db
        .select({
          id: controlProspectsTable.id,
          status: controlProspectsTable.status,
          campaignId: controlProspectsTable.campaignId,
        })
        .from(controlProspectsTable)
        .where(inArray(controlProspectsTable.id, params.prospectIds));
      const foundIds = new Set(prospects.map((p) => p.id));

      const enrolled: number[] = [];
      const skipped: Array<{ prospectId: number; reason: string }> = [];
      for (const id of params.prospectIds) {
        if (!foundIds.has(id)) {
          skipped.push({ prospectId: id, reason: "not_found" });
          continue;
        }
        const prospect = prospects.find((p) => p.id === id)!;
        if (prospect.campaignId != null && prospect.campaignId !== campaign.id) {
          skipped.push({ prospectId: id, reason: "already_in_another_campaign" });
          continue;
        }
        if (prospect.status !== "new" && prospect.status !== "qualified") {
          skipped.push({ prospectId: id, reason: `status_${prospect.status}` });
          continue;
        }
        enrolled.push(id);
      }

      if (enrolled.length > 0) {
        await db
          .update(controlProspectsTable)
          .set({ campaignId: campaign.id, campaignStep: 0, updatedAt: new Date() })
          .where(inArray(controlProspectsTable.id, enrolled));
      }
      return { campaignId: campaign.id, enrolledCount: enrolled.length, enrolled, skipped };
    },
  },
  launch_campaign: {
    type: "launch_campaign",
    riskLevel: "high",
    description:
      "Activate a draft or paused outreach campaign so its enrolled prospects become eligible for sends (each send still individually approved).",
    paramsSchema: campaignIdSchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = campaignIdSchema.parse(rawParams);
      const [updated] = await db
        .update(controlCampaignsTable)
        .set({
          status: "active",
          launchedAt: sql`coalesce(${controlCampaignsTable.launchedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(controlCampaignsTable.id, params.campaignId),
            inArray(controlCampaignsTable.status, ["draft", "paused"]),
          ),
        )
        .returning({ id: controlCampaignsTable.id, status: controlCampaignsTable.status });
      if (!updated) {
        throw new Error(`Campaign ${params.campaignId} is not in a launchable state (or does not exist).`);
      }
      return { campaignId: updated.id, status: updated.status };
    },
  },
  pause_campaign: {
    type: "pause_campaign",
    riskLevel: "medium",
    description: "Pause an active outreach campaign; no further sends may reference it until relaunched.",
    paramsSchema: campaignIdSchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = campaignIdSchema.parse(rawParams);
      const [updated] = await db
        .update(controlCampaignsTable)
        .set({ status: "paused", updatedAt: new Date() })
        .where(
          and(eq(controlCampaignsTable.id, params.campaignId), eq(controlCampaignsTable.status, "active")),
        )
        .returning({ id: controlCampaignsTable.id });
      if (!updated) {
        throw new Error(`Campaign ${params.campaignId} is not active (or does not exist).`);
      }
      return { campaignId: updated.id, status: "paused" };
    },
  },
  complete_campaign: {
    type: "complete_campaign",
    riskLevel: "medium",
    description: "Mark a campaign completed and stop all further activity under it.",
    paramsSchema: campaignIdSchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = campaignIdSchema.parse(rawParams);
      const [updated] = await db
        .update(controlCampaignsTable)
        .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(controlCampaignsTable.id, params.campaignId),
            inArray(controlCampaignsTable.status, ["draft", "active", "paused"]),
          ),
        )
        .returning({ id: controlCampaignsTable.id });
      if (!updated) {
        throw new Error(`Campaign ${params.campaignId} is already completed (or does not exist).`);
      }
      return { campaignId: updated.id, status: "completed" };
    },
  },
  grant_promo_credits: {
    type: "grant_promo_credits",
    riskLevel: "high",
    description:
      "Grant promotional/goodwill credits to an organization (retention save, incident compensation).",
    paramsSchema: grantPromoCreditsSchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = grantPromoCreditsSchema.parse(rawParams);
      const perAction = await getPolicyNumber("max_credit_grant_per_action", "credits", 10);
      if (params.amount > perAction) {
        throw new Error(`Grant of ${params.amount} exceeds per-action policy cap of ${perAction}.`);
      }
      const dailyCap = await getPolicyNumber("max_credit_grants_per_day", "credits", 30);
      const grantedToday = await creditsGrantedToday();
      if (grantedToday + params.amount > dailyCap) {
        throw new Error(
          `Grant would exceed daily policy cap (${grantedToday} + ${params.amount} > ${dailyCap}).`,
        );
      }
      const [org] = await db
        .select({ id: organizationsTable.id, name: organizationsTable.name })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, params.organizationId));
      if (!org) throw new Error(`Organization ${params.organizationId} not found.`);
      const newBalance = await grantCreditsToOrg(org.id, params.amount, "admin_adjust");
      return { granted: params.amount, organizationId: org.id, newBalance, note: params.note };
    },
  },
  requeue_failed_session: {
    type: "requeue_failed_session",
    riskLevel: "medium",
    description:
      "Requeue a failed couple session so the generation pipeline retries it (no extra credit charge).",
    paramsSchema: requeueFailedSessionSchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = requeueFailedSessionSchema.parse(rawParams);
      return db.transaction(async (tx) => {
        const [updated] = await tx
          .update(coupleSessionsTable)
          .set({ status: "pending", errorMessage: null, completedAt: null })
          .where(
            and(
              eq(coupleSessionsTable.id, params.sessionId),
              eq(coupleSessionsTable.status, "failed"),
              // Past retention the couple's photos are gone; there is nothing to rerun.
              isNull(coupleSessionsTable.sourcePhotosDeletedAt),
            ),
          )
          .returning({ id: coupleSessionsTable.id, venueId: coupleSessionsTable.venueId });
        if (!updated) {
          throw new Error(
            `Session ${params.sessionId} is not in a failed state, its photos were deleted after the retention window, or it does not exist.`,
          );
        }
        const [venue] = await tx
          .select({ organizationId: venuesTable.organizationId })
          .from(venuesTable)
          .where(eq(venuesTable.id, updated.venueId));
        // The rerun is free (the failure was refunded); the zero-delta ledger row
        // keeps the credit history truthful about which sessions ran twice.
        await tx.insert(creditTransactionsTable).values({
          organizationId: venue?.organizationId ?? null,
          venueId: updated.venueId,
          sessionId: updated.id,
          delta: 0,
          reason: "requeue_grant",
        });
        return { requeued: true, sessionId: updated.id, ledger: "requeue_grant" };
      });
    },
  },
  pause_agent: {
    type: "pause_agent",
    riskLevel: "medium",
    description: "Pause a control-plane agent so the scheduler stops running it.",
    paramsSchema: agentKeySchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = agentKeySchema.parse(rawParams);
      const [updated] = await db
        .update(controlAgentsTable)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(controlAgentsTable.key, params.agentKey))
        .returning({ key: controlAgentsTable.key });
      if (!updated) throw new Error(`Agent "${params.agentKey}" not found.`);
      return { paused: true, agentKey: updated.key };
    },
  },
  resume_agent: {
    type: "resume_agent",
    riskLevel: "medium",
    retired: true,
    description:
      "RETIRED. Agents no longer resume agents; operators resume a paused agent from /control → Overview agent cards (POST /control/agents/{key}/status).",
    paramsSchema: agentKeySchema as z.ZodType<Record<string, unknown>>,
    async execute() {
      throw new Error("resume_agent is retired: an operator resumes paused agents from /control → Overview (agent cards).");
    },
  },
  update_policy: {
    type: "update_policy",
    riskLevel: "high",
    description: "Change a governance policy value (spend caps, email caps, auto-execution).",
    paramsSchema: updatePolicySchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = updatePolicySchema.parse(rawParams);
      const validated = validatePolicyUpdate(params.key, params.value);
      if (!validated.ok) throw new Error(validated.error);
      const updated = await setPolicy(params.key, validated.value);
      if (!updated) throw new Error(`Failed to update policy "${params.key}".`);
      return { key: updated.key, value: updated.value, note: params.note };
    },
  },
};

/** The full catalog: core actions plus the growth workstream's (lifecycle emails, digest). */
export const ACTION_CATALOG: Record<string, ActionDefinition> = { ...CORE_ACTIONS, ...growthActions };

/** Action types agents may still propose (retired types are listed for display only). */
export function proposableActionTypes(): string[] {
  return Object.values(ACTION_CATALOG)
    .filter((a) => !a.retired)
    .map((a) => a.type);
}

export function describeActionCatalog(): Array<{
  type: string;
  riskLevel: ActionRiskLevel;
  description: string;
  retired: boolean;
}> {
  return Object.values(ACTION_CATALOG).map((a) => ({
    type: a.type,
    riskLevel: a.riskLevel,
    description: a.description,
    retired: Boolean(a.retired),
  }));
}

/**
 * Pure: may this actor propose this action type? Agents are bound to the
 * `actions` allowlist on their AgentDefinition; actors without a definition
 * (operator:*, system:*) and agents that declare no allowlist are unrestricted.
 */
export function agentMayPropose(agentKey: string, actionType: string): { allowed: true } | { allowed: false; reason: string } {
  const definition = getAgentDefinition(agentKey);
  if (!definition || definition.actions === undefined) return { allowed: true };
  if (definition.actions.includes(actionType)) return { allowed: true };
  return {
    allowed: false,
    reason:
      definition.actions.length === 0
        ? `Agent "${agentKey}" may not propose governed actions.`
        : `Agent "${agentKey}" may only propose: ${definition.actions.join(", ")}.`,
  };
}

/**
 * Create a governed action proposal. Low-risk actions execute inline when
 * the auto_execute_low_risk policy allows; everything else waits in the
 * approval queue for a human operator.
 */
export async function proposeAction(input: {
  agentKey: string;
  runId: number | null;
  actionType: string;
  title: string;
  reasoning?: string;
  params: Record<string, unknown>;
}): Promise<AgentAction> {
  const definition = ACTION_CATALOG[input.actionType];
  if (!definition) {
    throw new Error(
      `Unknown action type "${input.actionType}". Valid types: ${proposableActionTypes().join(", ")}.`,
    );
  }
  if (definition.retired) {
    throw new Error(
      `${input.actionType} is retired and cannot be proposed. Valid types: ${proposableActionTypes().join(", ")}.`,
    );
  }
  const permission = agentMayPropose(input.agentKey, input.actionType);
  if (!permission.allowed) throw new Error(permission.reason);
  const parsed = definition.paramsSchema.safeParse(input.params);
  if (!parsed.success) {
    throw new Error(`Invalid params for ${input.actionType}: ${parsed.error.message}`);
  }

  const autoLowRisk = await getPolicyBoolean("auto_execute_low_risk", "enabled", true);
  const overrideNeedsApproval = definition.requiresApproval ? await definition.requiresApproval() : false;
  const requiresApproval = computeRequiresApproval(definition, autoLowRisk, overrideNeedsApproval);

  const [action] = await db
    .insert(agentActionsTable)
    .values({
      agentKey: input.agentKey,
      runId: input.runId,
      actionType: input.actionType,
      title: input.title,
      reasoning: input.reasoning ?? null,
      params: parsed.data,
      riskLevel: definition.riskLevel,
      requiresApproval,
      status: requiresApproval ? "pending" : "approved",
    })
    .returning();
  if (!action) throw new Error("Failed to persist action proposal.");

  await recordAuditEvent({
    actorType: "agent",
    actor: input.agentKey,
    eventType: "action_proposed",
    subjectType: "action",
    subjectId: action.id,
    detail: {
      actionType: input.actionType,
      riskLevel: definition.riskLevel,
      requiresApproval,
      title: input.title,
    },
  });

  if (!requiresApproval) {
    return executeAction(action.id, "system:auto");
  }
  return action;
}

/**
 * Execute an approved action exactly once and persist the outcome + audit
 * trail. The executor first claims the row atomically (approved → executing);
 * a second executor (the scheduler drain racing an inline approval) finds
 * nothing to claim and gets the current row back without running anything.
 * A DeferredSendError (fixable precondition) returns the action to "pending"
 * with the reason, so the reviewed draft waits instead of failing.
 */
export async function executeAction(actionId: number, executor: string): Promise<AgentAction> {
  const [claimed] = await db
    .update(agentActionsTable)
    // executedAt marks when execution started until the outcome overwrites
    // it; the stale-executing sweep measures from it.
    .set({ status: "executing", executedAt: new Date() })
    .where(and(eq(agentActionsTable.id, actionId), eq(agentActionsTable.status, "approved")))
    .returning();
  if (!claimed) {
    const [current] = await db.select().from(agentActionsTable).where(eq(agentActionsTable.id, actionId));
    if (!current) throw new Error(`Action ${actionId} not found.`);
    if (current.status === "executing" || current.status === "executed") return current;
    throw new Error(`Action ${actionId} is "${current.status}", expected "approved".`);
  }
  const action = claimed;

  const definition = ACTION_CATALOG[action.actionType];
  if (!definition || definition.retired) {
    const message = definition
      ? `Action type "${action.actionType}" is retired and is never executed.`
      : `Action type "${action.actionType}" is no longer supported.`;
    const [updated] = await db
      .update(agentActionsTable)
      .set({ status: "failed", executedAt: new Date(), error: message })
      .where(eq(agentActionsTable.id, actionId))
      .returning();
    return updated ?? action;
  }

  try {
    const result = await definition.execute(action.params, { actionId });
    const [updated] = await db
      .update(agentActionsTable)
      .set({ status: "executed", executedAt: new Date(), result, error: null })
      .where(eq(agentActionsTable.id, actionId))
      .returning();
    await recordAuditEvent({
      actorType: "system",
      actor: executor,
      eventType: "action_executed",
      subjectType: "action",
      subjectId: actionId,
      detail: { actionType: action.actionType, result },
    });
    return updated ?? action;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isDeferredSendError(err)) {
      logger.warn({ actionId, actionType: action.actionType, reason: message }, "Control-plane action deferred");
      const [updated] = await db
        .update(agentActionsTable)
        .set({ status: "pending", decidedBy: null, decidedAt: null, error: message })
        .where(eq(agentActionsTable.id, actionId))
        .returning();
      await recordAuditEvent({
        actorType: "system",
        actor: executor,
        eventType: "action_deferred",
        subjectType: "action",
        subjectId: actionId,
        detail: { actionType: action.actionType, reason: message },
      });
      return updated ?? action;
    }
    logger.error({ err, actionId, actionType: action.actionType }, "Control-plane action failed");
    const [updated] = await db
      .update(agentActionsTable)
      .set({ status: "failed", executedAt: new Date(), error: message })
      .where(eq(agentActionsTable.id, actionId))
      .returning();
    await recordAuditEvent({
      actorType: "system",
      actor: executor,
      eventType: "action_failed",
      subjectType: "action",
      subjectId: actionId,
      detail: { actionType: action.actionType, error: message },
    });
    return updated ?? action;
  }
}

/**
 * Rows left in "executing" by a crashed process are never re-run (the side
 * effect may have happened); they are failed with an explanation so an
 * operator can check and re-propose. Age is measured from when execution
 * started (executedAt, stamped at claim), so the scheduler runs this on
 * every tick: a quick restart no longer leaves a row stuck forever.
 */
export function staleExecutingWhere(cutoff: Date) {
  return and(
    eq(agentActionsTable.status, "executing"),
    sql`coalesce(${agentActionsTable.executedAt}, ${agentActionsTable.decidedAt}, ${agentActionsTable.createdAt}) < ${cutoff}`,
  );
}

export async function recoverStaleExecutingActions(olderThanMinutes = 15, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000);
  const stale = await db
    .update(agentActionsTable)
    .set({
      status: "failed",
      executedAt: now,
      error: "Execution was interrupted (server restart); the outcome is unknown. Check the target before re-proposing.",
    })
    .where(staleExecutingWhere(cutoff))
    .returning({ id: agentActionsTable.id });
  for (const row of stale) {
    await recordAuditEvent({
      actorType: "system",
      actor: "system:recovery",
      eventType: "action_execution_interrupted",
      subjectType: "action",
      subjectId: row.id,
    });
  }
  return stale.length;
}

/** Operator decision on a pending action; approval triggers execution. */
export async function decideAction(
  actionId: number,
  decision: "approve" | "reject",
  operatorEmail: string,
  note?: string,
): Promise<AgentAction> {
  const [action] = await db
    .select()
    .from(agentActionsTable)
    .where(eq(agentActionsTable.id, actionId));
  if (!action) throw new Error(`Action ${actionId} not found.`);
  if (action.status !== "pending") {
    throw new Error(`Action ${actionId} is "${action.status}", only pending actions can be decided.`);
  }
  if (decision === "approve" && ACTION_CATALOG[action.actionType]?.retired) {
    throw new Error(
      `${action.actionType} is retired; reject it and use the outreach studio (Pipeline → Draft email).`,
    );
  }

  const [updated] = await db
    .update(agentActionsTable)
    .set({
      status: decision === "approve" ? "approved" : "rejected",
      decidedBy: operatorEmail,
      decisionNote: note ?? null,
      decidedAt: new Date(),
    })
    .where(and(eq(agentActionsTable.id, actionId), eq(agentActionsTable.status, "pending")))
    .returning();
  if (!updated) throw new Error(`Action ${actionId} was decided concurrently.`);

  await recordAuditEvent({
    actorType: "operator",
    actor: operatorEmail,
    eventType: decision === "approve" ? "action_approved" : "action_rejected",
    subjectType: "action",
    subjectId: actionId,
    detail: { actionType: action.actionType, note: note ?? null },
  });

  if (decision === "approve") {
    return executeAction(actionId, `operator:${operatorEmail}`);
  }
  if (action.actionType === "send_outreach_email") {
    await markEmailsRejectedForAction(actionId);
  }
  return updated;
}
