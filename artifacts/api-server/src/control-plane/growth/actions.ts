import { z } from "zod";
import { db, agentActionsTable, controlDigestsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { sendTransactionalEmail } from "../../lib/emailService.js";
import { logger } from "../../lib/logger.js";
import { executedTodayCount } from "../actionCounts.js";
import type { ActionDefinition } from "../actions.js";
import { operatorEmails } from "../operatorAuth.js";
import { isSuppressed } from "../outreach/unsubscribe.js";
import { getPolicyBoolean, getPolicyNumber } from "../policies.js";
import { controlUrl } from "./config.js";
import { escapeHtml, growthCtaButton, growthEmailLayout, paragraphsHtml, plainText } from "./emailRender.js";
import { LIFECYCLE_TEMPLATES, renderLifecycleMessage } from "./lifecycleEmails.js";
import { resolveLifecycleRecipient } from "./lifecycleRecipient.js";

/*
 * Growth-owned governed actions, merged into ACTION_CATALOG by actions.ts.
 *
 * All three are low risk because no model writes their text and the
 * recipients are either an existing customer's own contact address (trial
 * lifecycle) or the internal operator list (digest, nudge). They are still
 * governed actions with an audit row each; the lifecycle email additionally
 * waits for per-email operator approval until the lifecycle_email_auto_send
 * policy is deliberately flipped, and the internal emails honour the
 * auto_execute_low_risk switch. Daily counters come from ../actionCounts.js
 * (never ../actions.js) to avoid an import cycle.
 */

const lifecycleContextSchema = z
  .object({
    orgName: z.string().min(1),
    venueName: z.string().nullable(),
    creditsBalance: z.number().int().min(0),
    trialEndsAt: z.string().nullable(),
    galleriesReady: z.number().int().min(0),
    firstGalleryShareUrl: z.string().url().nullable(),
  })
  .strict();

export const sendLifecycleEmailSchema = z
  .object({
    organizationId: z.number().int().positive(),
    template: z.enum(LIFECYCLE_TEMPLATES),
    context: lifecycleContextSchema,
  })
  .strict();

export const sendOperatorDigestSchema = z.object({ digestId: z.number().int().positive() }).strict();

export const sendOperatorNudgeSchema = z
  .object({
    kind: z.literal("aging_approvals"),
    pendingCount: z.number().int().min(0),
    oldestHours: z.number().min(0),
    failedRuns24h: z.number().int().min(0),
    items: z
      .array(
        z
          .object({
            id: z.number().int().positive(),
            actionType: z.string().min(1),
            title: z.string().min(1).max(200),
            agentKey: z.string().min(1),
            ageHours: z.number().min(0),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export type SendOperatorNudgeParams = z.infer<typeof sendOperatorNudgeSchema>;

async function alreadySent(organizationId: number, template: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agentActionsTable.id })
    .from(agentActionsTable)
    .where(
      and(
        eq(agentActionsTable.actionType, "send_lifecycle_email"),
        eq(agentActionsTable.status, "executed"),
        sql`${agentActionsTable.params} ->> 'organizationId' = ${String(organizationId)}`,
        sql`${agentActionsTable.params} ->> 'template' = ${template}`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Internal operator email gate: honours the auto_execute_low_risk switch explicitly. */
async function internalEmailNeedsApproval(): Promise<boolean> {
  return !(await getPolicyBoolean("auto_execute_low_risk", "enabled", true));
}

async function sendToOperators(subject: string, html: string, text: string, tag: string): Promise<{ sent: number; to: string[] }> {
  const recipients = operatorEmails();
  if (recipients.length === 0) {
    throw new Error("CONTROL_PLANE_OPERATOR_EMAILS is empty; nobody to send the operator email to.");
  }
  const delivered: string[] = [];
  for (const to of recipients) {
    const result = await sendTransactionalEmail({ to, subject, html, text, tags: [{ name: "kind", value: tag }] });
    if (result) delivered.push(to);
  }
  if (delivered.length === 0) {
    throw new Error("No operator email was delivered (RESEND_API_KEY unset or the provider rejected every send).");
  }
  return { sent: delivered.length, to: delivered };
}

function hoursLabel(hours: number): string {
  if (hours >= 48) return `${Math.round(hours / 24)} days`;
  return `${Math.round(hours)} h`;
}

export function renderOperatorNudge(params: SendOperatorNudgeParams): { subject: string; html: string; text: string } {
  const approvalsUrl = controlUrl("approvals");
  const runsUrl = controlUrl("runs");
  const subject = `${params.pendingCount} approval${params.pendingCount === 1 ? "" : "s"} waiting in /control (oldest ${hoursLabel(params.oldestHours)})`;
  const intro = [
    `${params.pendingCount} governed action${params.pendingCount === 1 ? "" : "s"} ${params.pendingCount === 1 ? "has" : "have"} been waiting for a decision; the oldest for ${hoursLabel(params.oldestHours)}.`,
    params.failedRuns24h > 0
      ? `${params.failedRuns24h} agent run${params.failedRuns24h === 1 ? "" : "s"} failed in the last 24 hours.`
      : "No agent run failed in the last 24 hours.",
  ];
  const rows = params.items
    .map(
      (item) =>
        `<tr><td>#${item.id}</td><td>${escapeHtml(item.actionType)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.agentKey)}</td><td>${escapeHtml(hoursLabel(item.ageHours))}</td></tr>`,
    )
    .join("");
  const table = params.items.length
    ? `<table class="kpi" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 16px;border-collapse:collapse;">
        <tr><td><strong>Id</strong></td><td><strong>Type</strong></td><td><strong>Title</strong></td><td><strong>Agent</strong></td><td><strong>Waiting</strong></td></tr>
        ${rows}
      </table>`
    : "";
  const html = growthEmailLayout(
    "Approvals are waiting",
    `${paragraphsHtml(intro)}${table}${growthCtaButton(approvalsUrl, "Open the approvals queue")}<p style="margin:16px 0 0;font-size:13px;">Failed runs: <a href="${escapeHtml(runsUrl)}">${escapeHtml(runsUrl)}</a></p>`,
    { preheader: intro[0] },
  );
  const textLines = [
    ...intro,
    ...params.items.map((item) => `#${item.id} ${item.actionType} — ${item.title} (${item.agentKey}, waiting ${hoursLabel(item.ageHours)})`),
    `Failed runs: ${runsUrl}`,
  ];
  return { subject, html, text: plainText(textLines, { label: "Open the approvals queue", href: approvalsUrl }) };
}

export const growthActions: Record<string, ActionDefinition> = {
  send_lifecycle_email: {
    type: "send_lifecycle_email",
    riskLevel: "low",
    description:
      "Fixed-template trial lifecycle email (gallery 3, day 10, credits out, trial ended) to an existing customer's own contact address. No model-written text; one send per template per organization; daily cap max_lifecycle_emails_per_day. Waits for operator approval until policy lifecycle_email_auto_send.enabled is true.",
    paramsSchema: sendLifecycleEmailSchema as z.ZodType<Record<string, unknown>>,
    requiresApproval: async () => !(await getPolicyBoolean("lifecycle_email_auto_send", "enabled", false)),
    async execute(raw) {
      const params = sendLifecycleEmailSchema.parse(raw);
      const cap = await getPolicyNumber("max_lifecycle_emails_per_day", "emails", 50);
      const sentToday = await executedTodayCount("send_lifecycle_email");
      if (sentToday >= cap) {
        throw new Error(`Daily lifecycle email cap reached (${sentToday}/${cap}).`);
      }
      if (await alreadySent(params.organizationId, params.template)) {
        throw new Error(`Lifecycle email "${params.template}" was already sent to organization ${params.organizationId}.`);
      }
      const recipient = await resolveLifecycleRecipient(params.organizationId);
      if (!recipient) {
        throw new Error(`Organization ${params.organizationId} has no contact email or venue owner email.`);
      }
      if (await isSuppressed(recipient)) {
        throw new Error(`${recipient} is on the suppression list; lifecycle email not sent.`);
      }
      const message = renderLifecycleMessage(params.template, params.context);
      const delivery = await sendTransactionalEmail({
        to: recipient,
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [
          { name: "kind", value: "lifecycle" },
          { name: "template", value: params.template },
        ],
      });
      if (!delivery) {
        throw new Error("The lifecycle email was not delivered (RESEND_API_KEY unset or the provider rejected the send).");
      }
      logger.info({ organizationId: params.organizationId, template: params.template }, "Lifecycle email sent");
      return { sent: true, to: recipient, template: params.template, providerMessageId: delivery.id };
    },
  },

  send_operator_digest: {
    type: "send_operator_digest",
    riskLevel: "low",
    description:
      "Email the weekly growth digest to the internal operator list (CONTROL_PLANE_OPERATOR_EMAILS). Internal recipients only; auto-executes under auto_execute_low_risk.",
    paramsSchema: sendOperatorDigestSchema as z.ZodType<Record<string, unknown>>,
    requiresApproval: internalEmailNeedsApproval,
    async execute(raw) {
      const { digestId } = sendOperatorDigestSchema.parse(raw);
      const [digest] = await db.select().from(controlDigestsTable).where(eq(controlDigestsTable.id, digestId)).limit(1);
      if (!digest) throw new Error(`Digest ${digestId} not found.`);
      const weekLabel = digest.weekStart.toISOString().slice(0, 10);
      const outcome = await sendToOperators(`Dreemer growth digest — week of ${weekLabel}`, digest.html, digest.text, "digest");
      await db
        .update(controlDigestsTable)
        .set({ sentTo: outcome.to, sentAt: new Date() })
        .where(eq(controlDigestsTable.id, digestId));
      return { sent: outcome.sent, to: outcome.to, digestId };
    },
  },

  send_operator_nudge: {
    type: "send_operator_nudge",
    riskLevel: "low",
    description:
      "Daily reminder to the internal operator list when governed actions have waited for approval for more than two days (lists the queue and failed runs with links into /control). Internal recipients only; auto-executes under auto_execute_low_risk.",
    paramsSchema: sendOperatorNudgeSchema as z.ZodType<Record<string, unknown>>,
    requiresApproval: internalEmailNeedsApproval,
    async execute(raw) {
      const params = sendOperatorNudgeSchema.parse(raw);
      const message = renderOperatorNudge(params);
      const outcome = await sendToOperators(message.subject, message.html, message.text, "operator_nudge");
      return { sent: outcome.sent, to: outcome.to, pendingCount: params.pendingCount };
    },
  },
};
