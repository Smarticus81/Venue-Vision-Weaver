import { z } from "zod";
import {
  db,
  venuesTable,
  organizationsTable,
  coupleSessionsTable,
  controlAgentsTable,
  agentActionsTable,
  type AgentAction,
  type ActionRiskLevel,
} from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { grantCreditsToOrg } from "../lib/credits.js";
import { sendControlPlaneEmail } from "../lib/emailService.js";
import { logger } from "../lib/logger.js";
import { recordAuditEvent } from "./audit.js";
import { getPolicyBoolean, getPolicyNumber, setPolicy } from "./policies.js";

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
  execute: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function executedTodayCount(actionType: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentActionsTable)
    .where(
      and(
        eq(agentActionsTable.actionType, actionType),
        eq(agentActionsTable.status, "executed"),
        gte(agentActionsTable.executedAt, startOfUtcDay()),
      ),
    );
  return row?.total ?? 0;
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

export const ACTION_CATALOG: Record<string, ActionDefinition> = {
  send_venue_email: {
    type: "send_venue_email",
    riskLevel: "high",
    description:
      "Send an operational/outreach email to a venue owner (activation nudge, low-credit reminder, support follow-up).",
    paramsSchema: sendVenueEmailSchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = sendVenueEmailSchema.parse(rawParams);
      const cap = await getPolicyNumber("max_outbound_emails_per_day", "emails", 25);
      const sentToday = await executedTodayCount("send_venue_email");
      if (sentToday >= cap) {
        throw new Error(`Daily outbound email cap reached (${sentToday}/${cap}).`);
      }
      const [venue] = await db
        .select({ id: venuesTable.id, name: venuesTable.name, ownerEmail: venuesTable.ownerEmail })
        .from(venuesTable)
        .where(eq(venuesTable.slug, params.venueSlug));
      if (!venue) throw new Error(`Venue "${params.venueSlug}" not found.`);
      if (!venue.ownerEmail) throw new Error(`Venue "${params.venueSlug}" has no owner email.`);
      const sent = await sendControlPlaneEmail(
        venue.ownerEmail,
        params.subject,
        params.message.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
      );
      if (!sent) throw new Error("Email provider rejected or is not configured (RESEND_API_KEY).");
      return { sent: true, to: venue.ownerEmail, venueId: venue.id };
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
      const [updated] = await db
        .update(coupleSessionsTable)
        .set({ status: "pending", errorMessage: null, completedAt: null })
        .where(
          and(
            eq(coupleSessionsTable.id, params.sessionId),
            eq(coupleSessionsTable.status, "failed"),
          ),
        )
        .returning({ id: coupleSessionsTable.id });
      if (!updated) {
        throw new Error(`Session ${params.sessionId} is not in a failed state (or does not exist).`);
      }
      return { requeued: true, sessionId: updated.id };
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
    description: "Resume a paused control-plane agent.",
    paramsSchema: agentKeySchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = agentKeySchema.parse(rawParams);
      const [updated] = await db
        .update(controlAgentsTable)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(controlAgentsTable.key, params.agentKey))
        .returning({ key: controlAgentsTable.key });
      if (!updated) throw new Error(`Agent "${params.agentKey}" not found.`);
      return { resumed: true, agentKey: updated.key };
    },
  },
  update_policy: {
    type: "update_policy",
    riskLevel: "high",
    description: "Change a governance policy value (spend caps, email caps, auto-execution).",
    paramsSchema: updatePolicySchema as z.ZodType<Record<string, unknown>>,
    async execute(rawParams) {
      const params = updatePolicySchema.parse(rawParams);
      const updated = await setPolicy(params.key, params.value);
      if (!updated) throw new Error(`Failed to update policy "${params.key}".`);
      return { key: updated.key, value: updated.value, note: params.note };
    },
  },
};

export function describeActionCatalog(): Array<{
  type: string;
  riskLevel: ActionRiskLevel;
  description: string;
}> {
  return Object.values(ACTION_CATALOG).map((a) => ({
    type: a.type,
    riskLevel: a.riskLevel,
    description: a.description,
  }));
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
      `Unknown action type "${input.actionType}". Valid types: ${Object.keys(ACTION_CATALOG).join(", ")}.`,
    );
  }
  const parsed = definition.paramsSchema.safeParse(input.params);
  if (!parsed.success) {
    throw new Error(`Invalid params for ${input.actionType}: ${parsed.error.message}`);
  }

  const autoLowRisk = await getPolicyBoolean("auto_execute_low_risk", "enabled", true);
  const requiresApproval = definition.riskLevel !== "low" || !autoLowRisk;

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

/** Execute an approved action and persist the outcome + audit trail. */
export async function executeAction(actionId: number, executor: string): Promise<AgentAction> {
  const [action] = await db
    .select()
    .from(agentActionsTable)
    .where(eq(agentActionsTable.id, actionId));
  if (!action) throw new Error(`Action ${actionId} not found.`);
  if (action.status !== "approved") {
    throw new Error(`Action ${actionId} is "${action.status}", expected "approved".`);
  }

  const definition = ACTION_CATALOG[action.actionType];
  if (!definition) throw new Error(`Action type "${action.actionType}" is no longer supported.`);

  try {
    const result = await definition.execute(action.params);
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
  return updated;
}
