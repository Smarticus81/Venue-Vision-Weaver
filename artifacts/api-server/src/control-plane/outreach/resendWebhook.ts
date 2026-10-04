import type { Request, Response } from "express";
import { Webhook } from "svix";
import { db, controlEmailEventsTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { recordAuditEvent } from "../audit.js";
import { recordDeliveryEvent } from "./studio.js";
import { suppressEmail } from "./unsubscribe.js";

/**
 * Resend delivery webhooks (svix-signed): sent, delivered, delayed, bounced,
 * complained. Bounces and complaints suppress the address so no future draft
 * can target it; every event is stored against the studio email.
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

const EVENT_MAP: Record<string, "sent" | "delivered" | "bounced" | "complained" | "delivery_delayed"> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

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

  const recipients = Array.isArray(event.data?.to) ? event.data.to : event.data?.to ? [event.data.to] : [];
  const address = email?.sentTo ?? recipients[0] ?? null;
  if (address && (mapped === "bounced" || mapped === "complained")) {
    await suppressEmail({
      email: address,
      reason: mapped === "bounced" ? "bounce" : "complaint",
      detail: reason ?? mapped,
      prospectId: email?.prospectId ?? null,
      actor: "system:resend-webhook",
    });
  }
  await recordAuditEvent({
    actorType: "system",
    actor: "resend-webhook",
    eventType: `email_${mapped}`,
    subjectType: "outreach_email",
    subjectId: email?.id ?? providerMessageId,
    detail: { providerMessageId, reason },
  });
  return { handled: true };
}
