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
import { and, eq, inArray, sql } from "drizzle-orm";
import { sendRawEmail } from "../../lib/emailService.js";
import { logger } from "../../lib/logger.js";
import { getPolicyBoolean, getPolicyNumber } from "../policies.js";
import { recordAuditEvent } from "../audit.js";
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
import { loadGuard, prospectSendsToday, type GuardState } from "./sendingHealth.js";

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
  /** One provider message per key: a retry after an unclear failure can never deliver twice. */
  idempotencyKey: string;
}

/** Idempotency key for a studio email (stable across retries of the same row). */
export function outreachIdempotencyKey(emailId: number): string {
  return `outreach-email-${emailId}`;
}

export interface DeliveryRecord {
  providerId: string | null;
  html: string;
  text: string;
  to: string;
  at: Date;
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
  /**
   * Serialize the contact re-check, cap check and delivery across concurrent
   * approvals. Waits a bounded time for the lock; on contention it throws a
   * DeferredSendError (the draft is kept) instead of pinning a connection.
   */
  withSendLock<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Deliver one message. Throws DeferredSendError when the provider gave no
   * definite answer (timeout, 429, 5xx): the idempotency key makes a retry
   * safe. Any other failure is a rejection.
   */
  deliver(message: DeliverMessage): Promise<{ id: string | null }>;
  /**
   * After a delivery: mark the email sent and record the contact on the
   * prospect (count incremented in SQL, status moved to contacted only from
   * new/qualified/contacted) in one transaction.
   */
  recordDelivery(emailId: number, record: DeliveryRecord, prospectId: number, step: number | null): Promise<void>;
  markFailed(emailId: number, error: string): Promise<void>;
  /** Keep the draft (status stays "draft") and record why it could not go out yet. */
  markDeferred(emailId: number, error: string): Promise<void>;
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

  const initial = await deps.loadProspect(email.prospectId);
  if (!initial) throw new Error(`Prospect ${email.prospectId} not found.`);

  const now = deps.now();
  // Recipient rules: suppression list, status, gap, lifetime cap, existing
  // customer. Checked once up front (cheap refusal) and again under the send
  // lock on a freshly loaded row, because an unsubscribe, a reply or another
  // send can land while this approval waits for the lock.
  const assertContactable = async (prospect: ControlProspect): Promise<void> => {
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
  };

  let delivered = false;
  try {
    await assertContactable(initial);

    // Vetting may re-run over the network; it happens before the lock so a
    // slow site never holds up other sends.
    let vetting = await deps.loadVetting(initial.id);
    if (vetting && vetting.status === "passed" && !vettingIsFresh(vetting, now)) vetting = await deps.revet(initial);
    try {
      assertVettingAllowsOutreach(vetting, initial.id, now);
    } catch (err) {
      if (err instanceof VettingGateError && err.reason !== "failed") throw new DeferredSendError(err.message);
      throw err;
    }

    return await deps.withSendLock(async () => {
      const prospect = await deps.loadProspect(email.prospectId);
      if (!prospect) throw new Error(`Prospect ${email.prospectId} not found.`);
      await assertContactable(prospect);

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
        idempotencyKey: outreachIdempotencyKey(emailId),
      });
      delivered = true;

      // The message is out: from here on nothing may mark it failed (that
      // would let it be drafted and sent again). Bookkeeping is retried.
      await recordDeliveryWithRetry(deps, emailId, {
        providerId: delivery.id,
        html: rendered.html,
        text: rendered.text,
        to: prospect.email,
        at: now,
      }, prospect.id, email.step);
      return {
        sent: true as const,
        emailId,
        to: prospect.email,
        providerId: delivery.id,
        contactCount: prospect.contactCount + 1,
      };
    });
  } catch (err) {
    if (delivered) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (isDeferredSendError(err)) await deps.markDeferred(emailId, message);
    else await deps.markFailed(emailId, message);
    throw err;
  }
}

const RECORD_DELIVERY_ATTEMPTS = 3;

/**
 * Record a delivered email. A failure here never turns into "failed" (the
 * message went out); it is retried, and if the database stays unavailable
 * the send still reports success with the error logged for an operator.
 */
async function recordDeliveryWithRetry(
  deps: OutreachSendDeps,
  emailId: number,
  record: DeliveryRecord,
  prospectId: number,
  step: number | null,
): Promise<void> {
  for (let attempt = 1; attempt <= RECORD_DELIVERY_ATTEMPTS; attempt += 1) {
    try {
      await deps.recordDelivery(emailId, record, prospectId, step);
      return;
    } catch (err) {
      logger.error(
        { err, emailId, prospectId, attempt, providerId: record.providerId },
        attempt < RECORD_DELIVERY_ATTEMPTS
          ? "Recording a delivered outreach email failed; retrying"
          : "Delivered outreach email could not be recorded; reconcile it by hand (it was sent)",
      );
      if (attempt < RECORD_DELIVERY_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

/** Column updates recording one more contact; status only moves forward from new/qualified/contacted. */
export function prospectContactBump(step: number | null, at: Date) {
  return {
    status: sql<string>`case when ${controlProspectsTable.status} in ('new', 'qualified', 'contacted') then 'contacted' else ${controlProspectsTable.status} end`,
    contactCount: sql<number>`${controlProspectsTable.contactCount} + 1`,
    lastContactedAt: at,
    campaignStep: step == null ? sql<number>`${controlProspectsTable.campaignStep}` : step,
    updatedAt: at,
  };
}

/** Postgres lock_not_available (lock_timeout expired), possibly wrapped by the driver. */
function isLockTimeout(err: unknown): boolean {
  const candidate = err as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === "55P03" || candidate?.cause?.code === "55P03";
}

/** How long an approval waits for another send to finish before it is deferred. */
const SEND_LOCK_TIMEOUT = "5s";

/* ————— Default (database + Resend) dependencies ————— */

/** Prospect emails delivered today (UTC); the same count /control shows (sendingHealth.prospectSendsToday). */
export async function prospectEmailsSentToday(now: Date = new Date()): Promise<number> {
  return prospectSendsToday(now);
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
      let acquired = false;
      try {
        return await db.transaction(async (tx) => {
          await tx.execute(sql.raw(`set local lock_timeout = '${SEND_LOCK_TIMEOUT}'`));
          await tx.execute(sql`select pg_advisory_xact_lock(${SEND_LOCK_KEY})`);
          acquired = true;
          return fn();
        });
      } catch (err) {
        if (!acquired && isLockTimeout(err)) {
          throw new DeferredSendError("Another prospect email is being sent right now; the draft is kept. Approve it again in a minute.");
        }
        throw err;
      }
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
        idempotencyKey: message.idempotencyKey,
      });
      if (!result.sent) {
        if (result.transient) {
          throw new DeferredSendError(
            `The email provider did not confirm the send (${result.reason}). The draft is kept; approving it again is safe because the provider delivers one message per idempotency key.`,
          );
        }
        throw new Error(result.reason);
      }
      return { id: result.id };
    },
    async recordDelivery(emailId, record, prospectId, step) {
      await db.transaction(async (tx) => {
        await tx
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
        await tx.update(controlProspectsTable).set(prospectContactBump(step, record.at)).where(eq(controlProspectsTable.id, prospectId));
      });
      await recordAuditEvent({
        actorType: "system",
        actor: "outreach-studio",
        eventType: "outreach_email_sent",
        subjectType: "outreach_email",
        subjectId: emailId,
        detail: { to: record.to, providerId: record.providerId },
      }).catch((err) => logger.warn({ err, emailId }, "outreach_email_sent audit not recorded"));
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
    config: defaultSendConfig,
    imageUrl: publicObjectUrl,
    now: () => new Date(),
  };
}
