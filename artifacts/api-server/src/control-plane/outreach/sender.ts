import {
  db,
  agentActionsTable,
  controlCampaignsTable,
  controlOutreachEmailsTable,
  controlProspectAssetsTable,
  controlProspectsTable,
  type ControlOutreachEmail,
  type ControlProspect,
  type ControlProspectAsset,
  type ControlProspectFact,
  type ControlProspectVetting,
} from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { sendRawEmail } from "../../lib/emailService.js";
import { getPolicyBoolean, getPolicyNumber } from "../policies.js";
import { recordAuditEvent } from "../audit.js";
import { startOfUtcDay } from "../actionCounts.js";
import { isFreeMail, splitEmail } from "../vetting/domain.js";
import { citableFacts, citedFactsIn, loadFacts } from "../vetting/facts.js";
import { VettingGateError, assertVettingAllowsOutreach, ensureVetted, loadVetting, vettingIsFresh } from "../vetting/vet.js";
import {
  ContactGuardError,
  assertProspectContactable,
  existingCustomerSlug,
  loadContactPolicy,
  type ContactPolicy,
} from "./contactGuards.js";
import { isSuppressed } from "./unsubscribe.js";
import {
  outreachPostalAddress,
  outreachReplyTo,
  outreachUnsubscribeMailbox,
  postalAddressIsPlaceholder,
  publicObjectUrl,
  senderIsSandbox,
  unsubscribeUrl,
} from "./config.js";
import { COPY_RULES } from "./copywriter.js";
import { renderOutreachEmail, splitParagraphs, type TemplateImage } from "./emailTemplate.js";
import { DeferredSendError, isDeferredSendError } from "./sendErrors.js";
import { loadGuard, type GuardState } from "./sendingHealth.js";

/**
 * The only code path that delivers a studio email. It runs inside the
 * governed send_outreach_email action, and re-verifies on its own that the
 * email's action is approved, the prospect is still contactable and vetted,
 * the copy still cites two verified facts, compliance configuration is real,
 * the deliverability guard is not paused, and the daily cap holds (counted
 * under an advisory lock so concurrent approvals cannot exceed it). Fixable
 * preconditions keep the reviewed draft (DeferredSendError); blocked
 * recipients and provider rejections fail it. Dependencies are injectable.
 */

export const OUTREACH_SEND_ACTION_TYPES = ["send_prospect_email", "send_outreach_email"] as const;

/** Action statuses under which the sender may deliver (approved, or claimed by the executor). */
const SENDABLE_ACTION_STATUSES = new Set(["approved", "executing"]);

/** pg_advisory_xact_lock key serializing the cap check and delivery. */
const SEND_LOCK_KEY = 7_270_301;

export interface DeliverMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  replyTo: string | null;
  /** Resend tags; webhook events also match on the provider message id. */
  tags: Array<{ name: string; value: string }>;
}

export interface SendConfig {
  postalAddress: string;
  unsubscribeMailbox: string | null;
  replyTo: string | null;
  postalAddressIsPlaceholder: boolean;
  /** EMAIL_FROM unset or the Resend sandbox sender: delivers only to the account owner. */
  sandboxSender: boolean;
  resendConfigured: boolean;
}

export interface SendPolicyFlags {
  guard: GuardState;
  requireReplyTo: boolean;
  /** Kill switch: policy outreach_sends_enabled. */
  sendsEnabled: boolean;
}

export interface OutreachSendDeps {
  loadEmail(emailId: number): Promise<ControlOutreachEmail | null>;
  loadProspect(prospectId: number): Promise<ControlProspect | null>;
  loadActionStatus(actionId: number): Promise<string | null>;
  loadAssets(ids: number[]): Promise<ControlProspectAsset[]>;
  isSuppressed(email: string): Promise<boolean>;
  existingCustomerSlug(email: string): Promise<string | null>;
  loadPolicy(): Promise<ContactPolicy>;
  dailyCap(): Promise<{ cap: number; sentToday: number }>;
  loadVetting(prospectId: number): Promise<ControlProspectVetting | null>;
  /** Re-run vetting (network) when the stored verdict is expired; returns the fresh row. */
  revet(prospect: ControlProspect): Promise<ControlProspectVetting>;
  loadFacts(prospectId: number): Promise<ControlProspectFact[]>;
  /** Deliverability guard, reply-to policy and the sends kill switch, all from control_policies. */
  policyFlags(): Promise<SendPolicyFlags>;
  /** Status of the campaign the email belongs to (null when missing). */
  campaignStatus(campaignId: number): Promise<string | null>;
  /** Serialize cap check + delivery across concurrent approvals. */
  withSendLock<T>(fn: () => Promise<T>): Promise<T>;
  deliver(message: DeliverMessage): Promise<{ id: string | null }>;
  markSent(emailId: number, record: { providerId: string | null; html: string; text: string; to: string; at: Date }): Promise<void>;
  markFailed(emailId: number, error: string): Promise<void>;
  /** Keep the draft (status stays "draft") and record why it could not go out yet. */
  markDeferred(emailId: number, error: string): Promise<void>;
  bumpProspect(prospect: ControlProspect, step: number | null, at: Date): Promise<void>;
  config(): SendConfig;
  imageUrl(objectKey: string): string;
  now(): Date;
}

export function assetToTemplateImage(asset: ControlProspectAsset, imageUrl: (key: string) => string): TemplateImage {
  let sourceHost: string | null = null;
  if (asset.sourceUrl) {
    try {
      sourceHost = new URL(asset.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      sourceHost = null;
    }
  }
  return {
    url: imageUrl(asset.objectKey),
    alt: asset.altText,
    width: asset.width,
    height: asset.height,
    sourceHost,
    isSample: asset.kind === "sample_preview",
  };
}

/** Renders the exact message for an email row (HTML, text, List-Unsubscribe headers); shared by send and preview. */
export function renderEmailRow(
  email: Pick<ControlOutreachEmail, "subject" | "greeting" | "body" | "signOff" | "ctaLabel" | "ctaUrl" | "imageAssetIds" | "unsubscribeToken">,
  prospect: Pick<ControlProspect, "name">,
  assets: ControlProspectAsset[],
  options: {
    postalAddress: string;
    unsubscribeMailbox: string | null;
    imageUrl: (objectKey: string) => string;
    forceScheme?: "light" | "dark";
  },
) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const images = email.imageAssetIds
    .map((id) => byId.get(id))
    .filter((asset): asset is ControlProspectAsset => Boolean(asset))
    .map((asset) => assetToTemplateImage(asset, options.imageUrl));
  return renderOutreachEmail({
    subject: email.subject,
    greeting: email.greeting,
    paragraphs: splitParagraphs(email.body),
    signOffLines: email.signOff.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    ctaLabel: email.ctaLabel,
    ctaUrl: email.ctaUrl,
    images,
    venueName: prospect.name,
    unsubscribeUrl: unsubscribeUrl(email.unsubscribeToken),
    unsubscribeMailbox: options.unsubscribeMailbox,
    postalAddress: options.postalAddress,
    forceScheme: options.forceScheme,
  });
}

/** Pure: the cap message (cap 0 means the deliverability guard paused sending). */
export function dailyCapMessage(cap: { cap: number; sentToday: number }): string {
  if (cap.cap <= 0) return "Prospect sending is paused (daily cap is 0); an operator must reset the deliverability guard in /control.";
  return `Daily prospect email cap reached (${cap.sentToday}/${cap.cap}); the draft is kept and can be approved again tomorrow.`;
}

function contactGuardFailure(err: unknown): Error {
  if (err instanceof ContactGuardError && err.code === "gap") return new DeferredSendError(err.message);
  return err instanceof Error ? err : new Error(String(err));
}

export async function sendOutreachEmail(
  emailId: number,
  deps: OutreachSendDeps,
): Promise<{ sent: true; emailId: number; to: string; providerId: string | null; contactCount: number }> {
  const email = await deps.loadEmail(emailId);
  if (!email) throw new Error(`Outreach email ${emailId} not found.`);
  if (email.status !== "draft") {
    throw new Error(`Outreach email ${emailId} is "${email.status}" and cannot be sent again.`);
  }
  if (email.actionId == null) {
    throw new Error(`Outreach email ${emailId} has no governed action; it must be proposed and approved first.`);
  }
  const actionStatus = await deps.loadActionStatus(email.actionId);
  if (!actionStatus || !SENDABLE_ACTION_STATUSES.has(actionStatus)) {
    throw new Error(
      `Outreach email ${emailId} cannot send: its action #${email.actionId} is "${actionStatus ?? "missing"}", not approved by an operator.`,
    );
  }

  const prospect = await deps.loadProspect(email.prospectId);
  if (!prospect) throw new Error(`Prospect ${email.prospectId} not found.`);

  const now = deps.now();
  try {
    const [policy, suppressed, customerSlug] = await Promise.all([
      deps.loadPolicy(),
      deps.isSuppressed(prospect.email),
      deps.existingCustomerSlug(prospect.email),
    ]);
    try {
      assertProspectContactable(prospect, policy, { suppressed, existingCustomerSlug: customerSlug }, now);
    } catch (err) {
      throw contactGuardFailure(err);
    }

    return await deps.withSendLock(async () => {
      const cap = await deps.dailyCap();
      if (cap.sentToday >= cap.cap) throw new DeferredSendError(dailyCapMessage(cap));

      const flags = await deps.policyFlags();
      if (flags.guard.status === "paused") {
        throw new DeferredSendError(
          `Prospect sending is paused by the deliverability guard${flags.guard.reason ? ` (${flags.guard.reason})` : ""}; an operator must reset it in /control before any send.`,
        );
      }
      if (!flags.sendsEnabled) {
        throw new DeferredSendError("Outbound prospect email is frozen (policy outreach_sends_enabled = false); the draft is kept.");
      }

      let vetting = await deps.loadVetting(prospect.id);
      if (vetting && vetting.status === "passed" && !vettingIsFresh(vetting, now)) vetting = await deps.revet(prospect);
      try {
        assertVettingAllowsOutreach(vetting, prospect.id, now);
      } catch (err) {
        if (err instanceof VettingGateError && err.reason !== "failed") throw new DeferredSendError(err.message);
        throw err;
      }

      const cited = citedFactsIn(email, citableFacts(await deps.loadFacts(prospect.id)));
      if (cited.length < COPY_RULES.minCitedFacts) {
        throw new DeferredSendError(
          `Email ${emailId} cites ${cited.length} verified venue fact(s); at least ${COPY_RULES.minCitedFacts} are required. Edit the draft in /control → Outreach.`,
        );
      }
      if (/^\s*(re|fwd?)\s*:/i.test(email.subject)) throw new DeferredSendError("Subject must not fake a reply or forward.");

      const config = deps.config();
      if (config.postalAddressIsPlaceholder) {
        throw new DeferredSendError("OUTREACH_POSTAL_ADDRESS is not set; CAN-SPAM requires a real postal address in the footer.");
      }
      if (flags.requireReplyTo && !config.replyTo) {
        throw new DeferredSendError(
          "OUTREACH_REPLY_TO is not set; outreach must come from a monitored mailbox (policy outreach_require_reply_to).",
        );
      }
      if (config.replyTo && isFreeMail(splitEmail(config.replyTo)?.domain ?? "")) {
        throw new DeferredSendError(`OUTREACH_REPLY_TO (${config.replyTo}) is a free-mail address; use a mailbox on the sending domain.`);
      }
      if (config.sandboxSender) {
        throw new DeferredSendError(
          "EMAIL_FROM is unset or the Resend sandbox sender, which only delivers to the Resend account owner; set a sender on a verified domain.",
        );
      }
      if (!config.resendConfigured) {
        throw new DeferredSendError("RESEND_API_KEY is not set; email delivery is not configured on this server.");
      }
      if (email.campaignId != null) {
        const status = await deps.campaignStatus(email.campaignId);
        if (status !== "active") {
          const message = `Campaign ${email.campaignId} is "${status ?? "missing"}"; only active campaigns may send.`;
          if (status === "paused" || status === "draft") throw new DeferredSendError(message);
          throw new Error(message);
        }
      }

      const assets = await deps.loadAssets(email.imageAssetIds);
      const rendered = renderEmailRow(email, prospect, assets, {
        postalAddress: config.postalAddress,
        unsubscribeMailbox: config.unsubscribeMailbox,
        imageUrl: deps.imageUrl,
      });

      const delivery = await deps.deliver({
        to: prospect.email,
        subject: email.subject,
        html: rendered.html,
        text: rendered.text,
        headers: rendered.headers,
        replyTo: config.replyTo,
        tags: [
          { name: "category", value: "outreach" },
          { name: "email_id", value: String(emailId) },
        ],
      });

      await deps.markSent(emailId, {
        providerId: delivery.id,
        html: rendered.html,
        text: rendered.text,
        to: prospect.email,
        at: now,
      });
      await deps.bumpProspect(prospect, email.step, now);
      return {
        sent: true as const,
        emailId,
        to: prospect.email,
        providerId: delivery.id,
        contactCount: prospect.contactCount + 1,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isDeferredSendError(err)) await deps.markDeferred(emailId, message);
    else await deps.markFailed(emailId, message);
    throw err;
  }
}

/* ————— Default (database + Resend) dependencies ————— */

/**
 * Prospect emails delivered today (UTC): studio rows with sentAt today plus
 * any legacy plain-text sends executed today. Counting delivered rows (not
 * executed actions) keeps an in-flight send visible to the next cap check.
 */
export async function prospectEmailsSentToday(now: Date = new Date()): Promise<number> {
  const since = startOfUtcDay(now);
  const [studio] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(controlOutreachEmailsTable)
    .where(and(isNotNull(controlOutreachEmailsTable.sentAt), gte(controlOutreachEmailsTable.sentAt, since)));
  const [legacy] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentActionsTable)
    .where(
      and(
        eq(agentActionsTable.actionType, "send_prospect_email"),
        eq(agentActionsTable.status, "executed"),
        gte(agentActionsTable.executedAt, since),
      ),
    );
  return (studio?.total ?? 0) + (legacy?.total ?? 0);
}

export function defaultSendConfig(): SendConfig {
  return {
    postalAddress: outreachPostalAddress(),
    unsubscribeMailbox: outreachUnsubscribeMailbox(),
    replyTo: outreachReplyTo(),
    postalAddressIsPlaceholder: postalAddressIsPlaceholder(),
    sandboxSender: senderIsSandbox(),
    resendConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
  };
}

export function defaultSendDeps(): OutreachSendDeps {
  return {
    async loadEmail(emailId) {
      const [row] = await db.select().from(controlOutreachEmailsTable).where(eq(controlOutreachEmailsTable.id, emailId));
      return row ?? null;
    },
    async loadProspect(prospectId) {
      const [row] = await db.select().from(controlProspectsTable).where(eq(controlProspectsTable.id, prospectId));
      return row ?? null;
    },
    async loadActionStatus(actionId) {
      const [row] = await db
        .select({ status: agentActionsTable.status })
        .from(agentActionsTable)
        .where(eq(agentActionsTable.id, actionId));
      return row?.status ?? null;
    },
    async loadAssets(ids) {
      if (ids.length === 0) return [];
      return db.select().from(controlProspectAssetsTable).where(inArray(controlProspectAssetsTable.id, ids));
    },
    isSuppressed,
    existingCustomerSlug,
    loadPolicy: loadContactPolicy,
    async dailyCap() {
      return {
        cap: await getPolicyNumber("max_prospect_emails_per_day", "emails", 15),
        sentToday: await prospectEmailsSentToday(),
      };
    },
    loadVetting,
    revet: (prospect) => ensureVetted(prospect, { force: true, requestedBy: "system:sender" }).then((result) => result.vetting),
    loadFacts,
    async policyFlags() {
      const [guard, requireReplyTo, sendsEnabled] = await Promise.all([
        loadGuard(),
        getPolicyBoolean("outreach_require_reply_to", "enabled", true),
        getPolicyBoolean("outreach_sends_enabled", "enabled", true),
      ]);
      return { guard, requireReplyTo, sendsEnabled };
    },
    async campaignStatus(campaignId) {
      const [row] = await db
        .select({ status: controlCampaignsTable.status })
        .from(controlCampaignsTable)
        .where(eq(controlCampaignsTable.id, campaignId));
      return row?.status ?? null;
    },
    async withSendLock(fn) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${SEND_LOCK_KEY})`);
        return fn();
      });
    },
    async deliver(message) {
      const result = await sendRawEmail({
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
        replyTo: message.replyTo,
        tags: message.tags,
      });
      if (!result.sent) throw new Error(result.reason);
      return { id: result.id };
    },
    async markSent(emailId, record) {
      await db
        .update(controlOutreachEmailsTable)
        .set({
          status: "sent",
          providerMessageId: record.providerId,
          htmlSnapshot: record.html,
          textSnapshot: record.text,
          sentTo: record.to,
          sentAt: record.at,
          lastError: null,
          updatedAt: record.at,
        })
        .where(eq(controlOutreachEmailsTable.id, emailId));
      await recordAuditEvent({
        actorType: "system",
        actor: "outreach-studio",
        eventType: "outreach_email_sent",
        subjectType: "outreach_email",
        subjectId: emailId,
        detail: { to: record.to, providerId: record.providerId },
      });
    },
    async markFailed(emailId, error) {
      await db
        .update(controlOutreachEmailsTable)
        .set({ status: "failed", lastError: error.slice(0, 1000), updatedAt: new Date() })
        .where(eq(controlOutreachEmailsTable.id, emailId));
    },
    async markDeferred(emailId, error) {
      await db
        .update(controlOutreachEmailsTable)
        .set({ lastError: error.slice(0, 1000), updatedAt: new Date() })
        .where(and(eq(controlOutreachEmailsTable.id, emailId), eq(controlOutreachEmailsTable.status, "draft")));
    },
    async bumpProspect(prospect, step, at) {
      await db
        .update(controlProspectsTable)
        .set({
          status: "contacted",
          contactCount: prospect.contactCount + 1,
          lastContactedAt: at,
          campaignStep: step ?? prospect.campaignStep,
          updatedAt: at,
        })
        .where(eq(controlProspectsTable.id, prospect.id));
    },
    config: defaultSendConfig,
    imageUrl: publicObjectUrl,
    now: () => new Date(),
  };
}
