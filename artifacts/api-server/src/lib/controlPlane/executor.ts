import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  coupleSessionsTable,
  generatedAssetsTable,
  organizationsTable,
  venuesTable,
  creditTransactionsTable,
  controlPlaneAgentsTable,
  controlPlaneAuditTable,
  controlPlaneExperimentsTable,
  controlPlaneLeadsTable,
  controlPlaneMemoryTable,
  controlPlaneMetricsTable,
  controlPlaneTicketsTable,
  controlPlaneWorkItemsTable,
} from "@workspace/db";
import type { DecisionEffect } from "@workspace/control-plane";
import { canExecuteNow, type ControlPlanePolicy } from "@workspace/control-plane";
import { logger } from "../logger.js";
import { sendPlainNotification } from "../emailService.js";
import { getAppBaseUrl } from "../appUrl.js";
import { ObjectStorageService } from "../objectStorage.js";
import { grantCreditsToOrg } from "../credits.js";

const objectStorageService = new ObjectStorageService();

export interface ExecutionContext {
  organizationId: number;
  actor: string;
  actorType: "agent" | "human" | "system";
  policy: ControlPlanePolicy;
  decisionId: number | null;
}

export interface ExecutionResult {
  ok: boolean;
  detail: Record<string, unknown>;
  error?: string;
}

function ok(detail: Record<string, unknown> = {}): ExecutionResult {
  return { ok: true, detail };
}

function fail(error: string, detail: Record<string, unknown> = {}): ExecutionResult {
  return { ok: false, detail, error };
}

/** Where operator alerts land. Falls back to the oldest venue's owner. */
async function operatorEmail(organizationId: number): Promise<string | null> {
  const configured = process.env.CONTROL_PLANE_OPERATOR_EMAIL?.trim();
  if (configured) return configured;
  const [venue] = await db
    .select({ ownerEmail: venuesTable.ownerEmail })
    .from(venuesTable)
    .where(eq(venuesTable.organizationId, organizationId))
    .orderBy(venuesTable.createdAt)
    .limit(1);
  return venue?.ownerEmail ?? null;
}

async function audit(
  ctx: ExecutionContext,
  action: string,
  subjectType: string,
  subjectId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db.insert(controlPlaneAuditTable).values({
    organizationId: ctx.organizationId,
    actorType: ctx.actorType,
    actor: ctx.actor,
    action,
    subjectType,
    subjectId,
    detail: { ...detail, decisionId: ctx.decisionId },
  });
}

/** A venue is only reachable through the org that owns it. */
async function venueForOrg(organizationId: number, venueId: number) {
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(and(eq(venuesTable.id, venueId), eq(venuesTable.organizationId, organizationId)));
  return venue ?? null;
}

async function ticketForOrg(organizationId: number, ticketId: number) {
  const [ticket] = await db
    .select()
    .from(controlPlaneTicketsTable)
    .where(
      and(
        eq(controlPlaneTicketsTable.id, ticketId),
        eq(controlPlaneTicketsTable.organizationId, organizationId),
      ),
    );
  return ticket ?? null;
}

async function leadForOrg(organizationId: number, leadId: number) {
  const [lead] = await db
    .select()
    .from(controlPlaneLeadsTable)
    .where(
      and(
        eq(controlPlaneLeadsTable.id, leadId),
        eq(controlPlaneLeadsTable.organizationId, organizationId),
      ),
    );
  return lead ?? null;
}

/**
 * Re-queue a failed gallery. The credit was refunded when it failed, so a
 * retry has to buy it back — otherwise a retry loop would generate galleries
 * the organisation never paid for.
 */
async function retrySession(
  ctx: ExecutionContext,
  sessionId: number,
  note: string,
): Promise<ExecutionResult> {
  const [session] = await db
    .select({
      id: coupleSessionsTable.id,
      status: coupleSessionsTable.status,
      venueId: coupleSessionsTable.venueId,
      organizationId: venuesTable.organizationId,
    })
    .from(coupleSessionsTable)
    .innerJoin(venuesTable, eq(venuesTable.id, coupleSessionsTable.venueId))
    .where(eq(coupleSessionsTable.id, sessionId));

  if (!session || session.organizationId !== ctx.organizationId) {
    return fail("Session does not belong to this organization", { sessionId });
  }
  if (session.status !== "failed") {
    return fail(`Session is ${session.status}, not failed — nothing to retry`, {
      sessionId,
      status: session.status,
    });
  }

  // Partial assets from the failed attempt would collide with the unique
  // (session, asset_type, display_order) slots on the second run.
  const stale = await db
    .select({ objectKey: generatedAssetsTable.objectKey })
    .from(generatedAssetsTable)
    .where(eq(generatedAssetsTable.sessionId, sessionId));
  await db.delete(generatedAssetsTable).where(eq(generatedAssetsTable.sessionId, sessionId));
  for (const asset of stale) {
    try {
      await objectStorageService.deleteObjectEntity(asset.objectKey);
    } catch (err) {
      logger.warn({ err, sessionId, objectKey: asset.objectKey }, "Could not delete stale asset on retry");
    }
  }

  const requeued = await db.transaction(async (tx) => {
    const [org] = await tx
      .select({ creditsBalance: organizationsTable.creditsBalance })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, ctx.organizationId));
    if (!org || org.creditsBalance < 1) return null;

    await tx
      .update(organizationsTable)
      .set({ creditsBalance: sql`${organizationsTable.creditsBalance} - 1` })
      .where(eq(organizationsTable.id, ctx.organizationId));

    await tx.insert(creditTransactionsTable).values({
      organizationId: ctx.organizationId,
      venueId: session.venueId,
      delta: -1,
      reason: "session_debit",
      sessionId,
    });

    const [updated] = await tx
      .update(coupleSessionsTable)
      .set({
        status: "pending",
        errorMessage: null,
        completedAt: null,
        creditsCharged: 1,
      })
      .where(and(eq(coupleSessionsTable.id, sessionId), eq(coupleSessionsTable.status, "failed")))
      .returning({ id: coupleSessionsTable.id });
    return updated ?? null;
  });

  if (!requeued) {
    return fail("Not enough credits to retry, or the session changed state first", { sessionId });
  }

  await audit(ctx, "session.retried", "session", String(sessionId), { note });
  logger.info({ sessionId, organizationId: ctx.organizationId }, "Control plane re-queued a failed session");
  return ok({ sessionId, requeued: true });
}

/**
 * Apply one decision's effect. Every branch is scoped to the organisation on
 * the context — an effect can never reach another tenant's data, even if an
 * agent proposes an id it should not have seen.
 */
export async function executeEffect(
  effect: DecisionEffect,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const gate = canExecuteNow(effect, ctx.policy);
  if (!gate.allowed) return fail(gate.reason ?? "Blocked by policy");

  switch (effect.type) {
    case "report.digest": {
      await audit(ctx, "report.published", "report", effect.title, {
        title: effect.title,
        audience: effect.audience,
        body: effect.body,
      });
      return ok({ published: true, title: effect.title });
    }

    case "notify.operator": {
      const to = await operatorEmail(ctx.organizationId);
      const sent = await sendPlainNotification(
        to,
        `[glimpse ops] ${effect.subject}`,
        effect.subject,
        effect.body,
        { href: `${getAppBaseUrl()}/ops`, label: "Open the control plane" },
      );
      await audit(ctx, "operator.notified", "operator", to ?? "unset", {
        subject: effect.subject,
        severity: effect.severity,
        delivered: sent,
      });
      // A missing mail provider must not fail the decision: the alert is
      // still recorded in the audit trail and shown in the console.
      return ok({ delivered: sent, to: to ?? null });
    }

    case "venue.nudge": {
      const venue = await venueForOrg(ctx.organizationId, effect.venueId);
      if (!venue) return fail("Venue not found in this organization", { venueId: effect.venueId });
      const to = venue.contactEmail ?? venue.ownerEmail;
      const sent = await sendPlainNotification(to, effect.subject, effect.subject, effect.body, {
        href: `${getAppBaseUrl()}/dashboard`,
        label: "Open your dashboard",
      });
      await audit(ctx, "venue.nudged", "venue", String(venue.id), {
        reason: effect.reason,
        subject: effect.subject,
        delivered: sent,
      });
      return sent
        ? ok({ delivered: true, venueId: venue.id })
        : fail("Email provider is not configured", { venueId: venue.id });
    }

    case "credits.grant": {
      const balance = await grantCreditsToOrg(ctx.organizationId, effect.amount, "admin_adjust");
      await audit(ctx, "credits.granted", "organization", String(ctx.organizationId), {
        amount: effect.amount,
        reason: effect.reason,
        note: effect.note,
        balance,
      });
      return ok({ amount: effect.amount, balance });
    }

    case "workItem.upsert": {
      const item = effect.workItem;
      const [row] = await db
        .insert(controlPlaneWorkItemsTable)
        .values({
          organizationId: ctx.organizationId,
          type: item.type,
          title: item.title,
          detail: item.detail,
          severity: item.severity,
          surface: item.surface,
          dedupeKey: item.dedupeKey,
          evidence: item.evidence ?? {},
          decisionId: ctx.decisionId,
        })
        .onConflictDoUpdate({
          target: [controlPlaneWorkItemsTable.organizationId, controlPlaneWorkItemsTable.dedupeKey],
          set: {
            title: item.title,
            detail: item.detail,
            severity: item.severity,
            evidence: item.evidence ?? {},
            status: sql`case when ${controlPlaneWorkItemsTable.status} in ('done','cancelled') then 'open' else ${controlPlaneWorkItemsTable.status} end`,
            closedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning({ id: controlPlaneWorkItemsTable.id });
      await audit(ctx, "workItem.upserted", "work_item", String(row?.id ?? item.dedupeKey), {
        title: item.title,
        severity: item.severity,
      });
      return ok({ workItemId: row?.id ?? null, dedupeKey: item.dedupeKey });
    }

    case "workItem.close": {
      const [row] = await db
        .update(controlPlaneWorkItemsTable)
        .set({ status: "done", closedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(controlPlaneWorkItemsTable.organizationId, ctx.organizationId),
            eq(controlPlaneWorkItemsTable.dedupeKey, effect.dedupeKey),
            inArray(controlPlaneWorkItemsTable.status, ["open", "in_progress", "blocked"]),
          ),
        )
        .returning({ id: controlPlaneWorkItemsTable.id });
      if (!row) return ok({ closed: false, reason: "No open work item with that key" });
      await audit(ctx, "workItem.closed", "work_item", String(row.id), { note: effect.note });
      return ok({ closed: true, workItemId: row.id });
    }

    case "session.retry":
      return retrySession(ctx, effect.sessionId, effect.note);

    case "ticket.triage": {
      const ticket = await ticketForOrg(ctx.organizationId, effect.ticketId);
      if (!ticket) return fail("Ticket not found", { ticketId: effect.ticketId });
      await db
        .update(controlPlaneTicketsTable)
        .set({
          category: effect.category,
          sentiment: effect.sentiment,
          priority: effect.priority,
          assignedTo: ctx.actor,
          updatedAt: new Date(),
        })
        .where(eq(controlPlaneTicketsTable.id, ticket.id));
      await audit(ctx, "ticket.triaged", "ticket", String(ticket.id), {
        category: effect.category,
        priority: effect.priority,
      });
      return ok({ ticketId: ticket.id });
    }

    case "ticket.draftReply": {
      const ticket = await ticketForOrg(ctx.organizationId, effect.ticketId);
      if (!ticket) return fail("Ticket not found", { ticketId: effect.ticketId });
      await db
        .update(controlPlaneTicketsTable)
        .set({ aiDraft: effect.message, updatedAt: new Date() })
        .where(eq(controlPlaneTicketsTable.id, ticket.id));
      await audit(ctx, "ticket.drafted", "ticket", String(ticket.id), {
        length: effect.message.length,
      });
      return ok({ ticketId: ticket.id, drafted: true });
    }

    case "ticket.resolve": {
      const ticket = await ticketForOrg(ctx.organizationId, effect.ticketId);
      if (!ticket) return fail("Ticket not found", { ticketId: effect.ticketId });
      const now = new Date();
      await db
        .update(controlPlaneTicketsTable)
        .set({
          status: "resolved",
          resolutionNote: effect.note,
          resolvedAt: now,
          firstResponseAt: ticket.firstResponseAt ?? now,
          updatedAt: now,
        })
        .where(eq(controlPlaneTicketsTable.id, ticket.id));
      await audit(ctx, "ticket.resolved", "ticket", String(ticket.id), { note: effect.note });
      return ok({ ticketId: ticket.id, resolved: true });
    }

    case "ticket.escalate": {
      const ticket = await ticketForOrg(ctx.organizationId, effect.ticketId);
      if (!ticket) return fail("Ticket not found", { ticketId: effect.ticketId });
      await db
        .update(controlPlaneTicketsTable)
        .set({ priority: effect.priority, status: "open", updatedAt: new Date() })
        .where(eq(controlPlaneTicketsTable.id, ticket.id));
      const to = await operatorEmail(ctx.organizationId);
      await sendPlainNotification(
        to,
        `[glimpse ops] Escalated ticket #${ticket.id}`,
        `Escalated: ${ticket.subject}`,
        `${effect.note}\n\n${ticket.body}`,
        { href: `${getAppBaseUrl()}/ops`, label: "Open the control plane" },
      );
      await audit(ctx, "ticket.escalated", "ticket", String(ticket.id), { note: effect.note });
      return ok({ ticketId: ticket.id, priority: effect.priority });
    }

    case "experiment.launch": {
      const weightTotal = effect.variants.reduce((sum, variant) => sum + variant.weight, 0);
      if (weightTotal <= 0) return fail("Experiment variant weights must sum above zero");
      const [row] = await db
        .insert(controlPlaneExperimentsTable)
        .values({
          organizationId: ctx.organizationId,
          key: effect.key,
          hypothesis: effect.hypothesis,
          surface: effect.surface,
          primaryMetric: effect.primaryMetric,
          variants: effect.variants,
          minimumSampleSize: effect.minimumSampleSize,
          status: "running",
          startedAt: new Date(),
          createdBy: ctx.actor,
        })
        .onConflictDoNothing({
          target: [controlPlaneExperimentsTable.organizationId, controlPlaneExperimentsTable.key],
        })
        .returning({ id: controlPlaneExperimentsTable.id });
      if (!row) return ok({ launched: false, reason: "An experiment with that key already exists" });
      await audit(ctx, "experiment.launched", "experiment", effect.key, {
        surface: effect.surface,
        primaryMetric: effect.primaryMetric,
      });
      return ok({ experimentId: row.id, key: effect.key });
    }

    case "experiment.conclude": {
      const [row] = await db
        .update(controlPlaneExperimentsTable)
        .set({
          status: "concluded",
          concludedAt: new Date(),
          result: { winner: effect.winner, note: effect.note },
        })
        .where(
          and(
            eq(controlPlaneExperimentsTable.organizationId, ctx.organizationId),
            eq(controlPlaneExperimentsTable.key, effect.key),
            eq(controlPlaneExperimentsTable.status, "running"),
          ),
        )
        .returning({ id: controlPlaneExperimentsTable.id });
      if (!row) return ok({ concluded: false, reason: "No running experiment with that key" });
      await audit(ctx, "experiment.concluded", "experiment", effect.key, {
        winner: effect.winner,
        note: effect.note,
      });
      return ok({ experimentId: row.id, winner: effect.winner });
    }

    case "experiment.abort": {
      const [row] = await db
        .update(controlPlaneExperimentsTable)
        .set({
          status: "aborted",
          concludedAt: new Date(),
          result: { winner: null, note: effect.note },
        })
        .where(
          and(
            eq(controlPlaneExperimentsTable.organizationId, ctx.organizationId),
            eq(controlPlaneExperimentsTable.key, effect.key),
            eq(controlPlaneExperimentsTable.status, "running"),
          ),
        )
        .returning({ id: controlPlaneExperimentsTable.id });
      if (!row) return ok({ aborted: false, reason: "No running experiment with that key" });
      await audit(ctx, "experiment.aborted", "experiment", effect.key, { note: effect.note });
      return ok({ experimentId: row.id });
    }

    case "lead.advance": {
      const lead = await leadForOrg(ctx.organizationId, effect.leadId);
      if (!lead) return fail("Lead not found", { leadId: effect.leadId });
      await db
        .update(controlPlaneLeadsTable)
        .set({
          stage: effect.stage,
          notes: effect.note,
          lastTouchAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(controlPlaneLeadsTable.id, lead.id));
      await audit(ctx, "lead.advanced", "lead", String(lead.id), {
        from: lead.stage,
        to: effect.stage,
        note: effect.note,
      });
      return ok({ leadId: lead.id, stage: effect.stage });
    }

    case "lead.score": {
      const lead = await leadForOrg(ctx.organizationId, effect.leadId);
      if (!lead) return fail("Lead not found", { leadId: effect.leadId });
      await db
        .update(controlPlaneLeadsTable)
        .set({ score: effect.score, updatedAt: new Date() })
        .where(eq(controlPlaneLeadsTable.id, lead.id));
      await audit(ctx, "lead.scored", "lead", String(lead.id), {
        from: lead.score,
        to: effect.score,
        note: effect.note,
      });
      return ok({ leadId: lead.id, score: effect.score });
    }

    case "lead.outreach": {
      const lead = await leadForOrg(ctx.organizationId, effect.leadId);
      if (!lead) return fail("Lead not found", { leadId: effect.leadId });
      if (!lead.contactEmail) return fail("Lead has no contact email", { leadId: lead.id });
      const sent = await sendPlainNotification(
        lead.contactEmail,
        effect.subject,
        effect.subject,
        effect.body,
      );
      if (sent) {
        await db
          .update(controlPlaneLeadsTable)
          .set({
            lastTouchAt: new Date(),
            nextActionAt: new Date(Date.now() + 5 * 24 * 3_600_000),
            stage: lead.stage === "new" || lead.stage === "qualified" ? "contacted" : lead.stage,
            updatedAt: new Date(),
          })
          .where(eq(controlPlaneLeadsTable.id, lead.id));
      }
      await audit(ctx, "lead.contacted", "lead", String(lead.id), {
        subject: effect.subject,
        delivered: sent,
      });
      return sent ? ok({ leadId: lead.id, delivered: true }) : fail("Email provider is not configured");
    }

    case "agent.setAutonomy": {
      const [row] = await db
        .update(controlPlaneAgentsTable)
        .set({ autonomy: effect.autonomy, updatedAt: new Date() })
        .where(
          and(
            eq(controlPlaneAgentsTable.organizationId, ctx.organizationId),
            eq(controlPlaneAgentsTable.agentKey, effect.targetAgentKey),
          ),
        )
        .returning({ id: controlPlaneAgentsTable.id });
      if (!row) return fail("Agent not found", { agentKey: effect.targetAgentKey });
      await audit(ctx, "agent.autonomy_changed", "agent", effect.targetAgentKey, {
        autonomy: effect.autonomy,
        note: effect.note,
      });
      return ok({ agentKey: effect.targetAgentKey, autonomy: effect.autonomy });
    }

    case "agent.pause":
    case "agent.resume": {
      const enabled = effect.type === "agent.resume";
      const [row] = await db
        .update(controlPlaneAgentsTable)
        .set({
          enabled,
          status: enabled ? "idle" : "paused",
          ...(enabled ? { nextRunAt: new Date(), lastError: null } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(controlPlaneAgentsTable.organizationId, ctx.organizationId),
            eq(controlPlaneAgentsTable.agentKey, effect.targetAgentKey),
          ),
        )
        .returning({ id: controlPlaneAgentsTable.id });
      if (!row) return fail("Agent not found", { agentKey: effect.targetAgentKey });
      await audit(ctx, enabled ? "agent.resumed" : "agent.paused", "agent", effect.targetAgentKey, {
        note: effect.note,
      });
      return ok({ agentKey: effect.targetAgentKey, enabled });
    }

    case "policy.set": {
      // Routed through the policy store by the caller so validation and the
      // audit entry stay in one place; executing it here would bypass both.
      return fail("Policy changes are applied through the policy endpoint, not the executor");
    }

    case "memory.write": {
      const [row] = await db
        .insert(controlPlaneMemoryTable)
        .values({
          organizationId: ctx.organizationId,
          agentKey: ctx.actor,
          kind: "insight",
          content: effect.content,
          importance: effect.importance,
          tags: effect.tags,
        })
        .returning({ id: controlPlaneMemoryTable.id });
      return ok({ memoryId: row?.id ?? null });
    }

    case "metric.record": {
      const today = new Date().toISOString().slice(0, 10);
      await db
        .insert(controlPlaneMetricsTable)
        .values({
          organizationId: ctx.organizationId,
          metricDate: today,
          metricKey: effect.metricKey,
          value: effect.value,
          dimensions: effect.dimensions ?? {},
        })
        .onConflictDoUpdate({
          target: [
            controlPlaneMetricsTable.organizationId,
            controlPlaneMetricsTable.metricDate,
            controlPlaneMetricsTable.metricKey,
          ],
          set: { value: effect.value, dimensions: effect.dimensions ?? {} },
        });
      return ok({ metricKey: effect.metricKey, value: effect.value });
    }

    default: {
      const exhaustive: never = effect;
      return fail(`Unsupported effect: ${JSON.stringify(exhaustive)}`);
    }
  }
}
