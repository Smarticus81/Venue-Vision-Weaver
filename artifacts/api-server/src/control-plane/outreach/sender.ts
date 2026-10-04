import {
  db,
  agentActionsTable,
  controlOutreachEmailsTable,
  controlProspectAssetsTable,
  controlProspectsTable,
  type ControlOutreachEmail,
  type ControlProspect,
  type ControlProspectAsset,
} from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { sendRawEmail } from "../../lib/emailService.js";
import { getPolicyNumber } from "../policies.js";
import { recordAuditEvent } from "../audit.js";
import {
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
  publicObjectUrl,
  unsubscribeUrl,
} from "./config.js";
import { buildListUnsubscribeHeaders, renderOutreachEmail, splitParagraphs, type TemplateImage } from "./emailTemplate.js";

/**
 * The only code path that delivers a studio email. It runs inside the
 * governed send_outreach_email action, and re-verifies on its own that the
 * email's action is approved, the prospect is still contactable, the address
 * is not suppressed, and the daily cap holds — so even a direct call cannot
 * bypass the operator gate. Dependencies are injectable for tests.
 */

export const OUTREACH_SEND_ACTION_TYPES = ["send_prospect_email", "send_outreach_email"] as const;

export interface DeliverMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  replyTo: string | null;
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
  deliver(message: DeliverMessage): Promise<{ id: string | null }>;
  markSent(emailId: number, record: { providerId: string | null; html: string; text: string; to: string; at: Date }): Promise<void>;
  markFailed(emailId: number, error: string): Promise<void>;
  bumpProspect(prospect: ControlProspect, step: number | null, at: Date): Promise<void>;
  config(): { postalAddress: string; unsubscribeMailbox: string | null; replyTo: string | null };
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

/** Renders the exact message for an email row; shared by send and preview. */
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
  const unsubscribe = unsubscribeUrl(email.unsubscribeToken);
  const rendered = renderOutreachEmail({
    subject: email.subject,
    greeting: email.greeting,
    paragraphs: splitParagraphs(email.body),
    signOffLines: email.signOff.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    ctaLabel: email.ctaLabel,
    ctaUrl: email.ctaUrl,
    images,
    venueName: prospect.name,
    unsubscribeUrl: unsubscribe,
    postalAddress: options.postalAddress,
    forceScheme: options.forceScheme,
  });
  rendered.headers = buildListUnsubscribeHeaders(unsubscribe, options.unsubscribeMailbox);
  return rendered;
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
  if (actionStatus !== "approved") {
    throw new Error(
      `Outreach email ${emailId} cannot send: its action #${email.actionId} is "${actionStatus ?? "missing"}", not approved by an operator.`,
    );
  }

  const prospect = await deps.loadProspect(email.prospectId);
  if (!prospect) throw new Error(`Prospect ${email.prospectId} not found.`);

  const now = deps.now();
  try {
    const [policy, suppressed, customerSlug, cap] = await Promise.all([
      deps.loadPolicy(),
      deps.isSuppressed(prospect.email),
      deps.existingCustomerSlug(prospect.email),
      deps.dailyCap(),
    ]);
    assertProspectContactable(prospect, policy, { suppressed, existingCustomerSlug: customerSlug }, now);
    if (cap.sentToday >= cap.cap) {
      throw new Error(`Daily prospect email cap reached (${cap.sentToday}/${cap.cap}).`);
    }

    const assets = await deps.loadAssets(email.imageAssetIds);
    const config = deps.config();
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
      sent: true,
      emailId,
      to: prospect.email,
      providerId: delivery.id,
      contactCount: prospect.contactCount + 1,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.markFailed(emailId, message);
    throw err;
  }
}

/* ————— Default (database + Resend) dependencies ————— */

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function prospectEmailsSentToday(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentActionsTable)
    .where(
      and(
        inArray(agentActionsTable.actionType, [...OUTREACH_SEND_ACTION_TYPES]),
        eq(agentActionsTable.status, "executed"),
        gte(agentActionsTable.executedAt, startOfUtcDay(new Date())),
      ),
    );
  return row?.total ?? 0;
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
    async deliver(message) {
      const result = await sendRawEmail({
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
        replyTo: message.replyTo,
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
    config: () => ({
      postalAddress: outreachPostalAddress(),
      unsubscribeMailbox: outreachUnsubscribeMailbox(),
      replyTo: outreachReplyTo(),
    }),
    imageUrl: publicObjectUrl,
    now: () => new Date(),
  };
}
