import type { Request, Response } from "express";
import { Webhook } from "svix";
import { db, controlEmailEventsTable, controlProspectsTable } from "@workspace/db";
import { and, inArray, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { recordAuditEvent } from "../audit.js";
import { evaluateEventAndMaybePause } from "./sendingHealth.js";
import { recordDeliveryEvent, type DeliveryEventType } from "./studio.js";
import { normalizeEmail, suppressEmail } from "./unsubscribe.js";

/**
 * Resend webhooks (svix-signed): sent, delivered, delayed, bounced,
 * complained, opened, clicked, and inbound replies (email.received).
 * Events are matched to the studio email by provider message id; only a
 * matched outreach email's bounce or complaint suppresses an address (a
 * transactional bounce never locks a prospect) and feeds the deliverability
 * guard. An inbound reply from a prospect's address marks it replied, which
 * stops all automated contact.
 */

type ResendEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { message?: string; type?: string; subType?: string };
    [key: string]: unknown;
  };
};

export const EVENT_MAP: Record<string, DeliveryEventType> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
};

/** Pure: the sender address of an inbound email payload ("Name <a@b>", {email}, or [..]). */
export function inboundSenderAddress(from: unknown): string | null {
  const first = Array.isArray(from) ? from[0] : from;
  let raw: string | null = null;
  if (typeof first === "string") raw = first;
  else if (first && typeof first === "object") {
    const record = first as Record<string, unknown>;
    raw = typeof record.email === "string" ? record.email : typeof record.address === "string" ? record.address : null;
  }
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>/);
  const address = (match?.[1] ?? raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

/** Inbound reply: the prospect is marked replied (a human owns the thread now). */
export async function recordInboundReply(event: ResendEvent): Promise<{ handled: boolean; prospectId?: number }> {
  const address = inboundSenderAddress(event.data?.from);
  if (!address) return { handled: false };
  const now = new Date();
  const updated = await db
    .update(controlProspectsTable)
    .set({
      status: "replied",
      repliedAt: sql`coalesce(${controlProspectsTable.repliedAt}, ${now})`,
      statusChangedBy: "system:resend-inbound",
      updatedAt: now,
    })
    .where(
      and(
        sql`lower(${controlProspectsTable.email}) = ${normalizeEmail(address)}`,
        inArray(controlProspectsTable.status, ["qualified", "contacted"]),
      ),
    )
    .returning({ id: controlProspectsTable.id });
  const prospectId = updated[0]?.id;
  await recordAuditEvent({
    actorType: "system",
    actor: "resend-webhook",
    eventType: prospectId ? "prospect_replied" : "inbound_email_unmatched",
    subjectType: prospectId ? "prospect" : "email_address",
    subjectId: prospectId ?? address,
    detail: { subject: typeof event.data?.subject === "string" ? event.data.subject.slice(0, 200) : null },
  });
  return { handled: Boolean(prospectId), prospectId };
}

export async function handleResendWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    res.status(503).send("Resend webhook secret not configured");
    return;
  }
  const svixId = req.headers["svix-id"];
  const svixTimestamp = req.headers["svix-timestamp"];
  const svixSignature = req.headers["svix-signature"];
  if (typeof svixId !== "string" || typeof svixTimestamp !== "string" || typeof svixSignature !== "string") {
    res.status(400).send("Missing svix headers");
    return;
  }

  const payload = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body ?? {});
  let event: ResendEvent;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendEvent;
  } catch (err) {
    logger.warn({ err }, "Resend webhook signature verification failed");
    res.status(400).send("Invalid signature");
    return;
  }

  try {
    await processResendEvent(event, svixId);
    res.status(200).send("ok");
  } catch (err) {
    logger.error({ err, type: event.type }, "Resend webhook handler failed");
    res.status(500).send("Webhook handler failed");
  }
}

export async function processResendEvent(event: ResendEvent, providerEventId: string | null): Promise<{ handled: boolean }> {
  if (event.type === "email.received") return recordInboundReply(event);
  const mapped = EVENT_MAP[event.type];
  const providerMessageId = event.data?.email_id;
  if (!mapped || !providerMessageId) return { handled: false };

  const at = event.created_at ? new Date(event.created_at) : new Date();
  const reason = event.data?.bounce
    ? [event.data.bounce.type, event.data.bounce.subType, event.data.bounce.message].filter(Boolean).join(" · ")
    : null;
  const email = await recordDeliveryEvent({ providerMessageId, eventType: mapped, reason, at });

  await db
    .insert(controlEmailEventsTable)
    .values({
      emailId: email?.id ?? null,
      providerEventId,
      eventType: mapped,
      payload: (event.data ?? null) as Record<string, unknown> | null,
    })
    .onConflictDoNothing({ target: controlEmailEventsTable.providerEventId });

  // Only studio outreach emails suppress addresses and move the guard; a bounce
  // on a transactional email (gallery link, owner notice) is not a prospect signal.
  const recipient = email?.sentTo ?? (Array.isArray(event.data?.to) ? event.data.to[0] : event.data?.to) ?? null;
  if (email && recipient && (mapped === "bounced" || mapped === "complained")) {
    await suppressEmail({
      email: recipient,
      reason: mapped === "bounced" ? "bounce" : "complaint",
      detail: reason ?? mapped,
      prospectId: email.prospectId,
      actor: "system:resend-webhook",
    });
  }
  await recordAuditEvent({
    actorType: "system",
    actor: "resend-webhook",
    eventType: `email_${mapped}`,
    subjectType: "outreach_email",
    subjectId: email?.id ?? providerMessageId,
    detail: { providerMessageId, reason, matched: Boolean(email) },
  });
  if (email && (mapped === "bounced" || mapped === "complained")) {
    try {
      await evaluateEventAndMaybePause(mapped, "system:resend-webhook");
    } catch (err) {
      logger.error({ err, emailId: email.id }, "Deliverability guard evaluation failed");
    }
  }
  return { handled: true };
}
