import { randomBytes } from "node:crypto";
import {
  db,
  controlEmailSuppressionsTable,
  controlOutreachEmailsTable,
  controlProspectsTable,
  type EmailSuppressionReason,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { recordAuditEvent } from "../audit.js";

/**
 * Consent plumbing. A suppression is permanent and checked by every outreach
 * send; the unsubscribe token is a random per-email secret that the public
 * endpoints exchange for a suppression without any sign-in.
 */

export function newUnsubscribeToken(): string {
  return randomBytes(24).toString("base64url");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function isSuppressed(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: controlEmailSuppressionsTable.id })
    .from(controlEmailSuppressionsTable)
    .where(eq(controlEmailSuppressionsTable.email, normalizeEmail(email)))
    .limit(1);
  return Boolean(row);
}

export async function suppressEmail(input: {
  email: string;
  reason: EmailSuppressionReason;
  detail?: string | null;
  prospectId?: number | null;
  actor: string;
}): Promise<{ created: boolean }> {
  const email = normalizeEmail(input.email);
  const inserted = await db
    .insert(controlEmailSuppressionsTable)
    .values({
      email,
      reason: input.reason,
      detail: input.detail ?? null,
      prospectId: input.prospectId ?? null,
    })
    .onConflictDoNothing({ target: controlEmailSuppressionsTable.email })
    .returning({ id: controlEmailSuppressionsTable.id });

  // Lock the prospect so no agent or legacy action can ever propose contact again.
  if (input.reason === "unsubscribe_link" || input.reason === "one_click" || input.reason === "complaint" || input.reason === "operator") {
    await db
      .update(controlProspectsTable)
      .set({ status: "unsubscribed", statusChangedBy: input.actor, updatedAt: new Date() })
      .where(sql`lower(${controlProspectsTable.email}) = ${email}`);
  }

  await recordAuditEvent({
    actorType: input.actor.startsWith("operator:") ? "operator" : "system",
    actor: input.actor,
    eventType: inserted.length > 0 ? "email_suppressed" : "email_suppression_repeated",
    subjectType: "email_address",
    subjectId: email,
    detail: { reason: input.reason, detail: input.detail ?? null, prospectId: input.prospectId ?? null },
  });
  return { created: inserted.length > 0 };
}

export interface UnsubscribeTarget {
  emailId: number;
  prospectId: number;
  address: string;
  venueName: string;
}

export async function findUnsubscribeTarget(token: string): Promise<UnsubscribeTarget | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await db
    .select({
      emailId: controlOutreachEmailsTable.id,
      prospectId: controlOutreachEmailsTable.prospectId,
      sentTo: controlOutreachEmailsTable.sentTo,
      prospectEmail: controlProspectsTable.email,
      venueName: controlProspectsTable.name,
    })
    .from(controlOutreachEmailsTable)
    .innerJoin(controlProspectsTable, eq(controlOutreachEmailsTable.prospectId, controlProspectsTable.id))
    .where(eq(controlOutreachEmailsTable.unsubscribeToken, token))
    .limit(1);
  if (!row) return null;
  return {
    emailId: row.emailId,
    prospectId: row.prospectId,
    address: row.sentTo ?? row.prospectEmail,
    venueName: row.venueName,
  };
}

/** Both the link (after confirmation) and RFC 8058 one-click land here. */
export async function unsubscribeByToken(
  token: string,
  reason: Extract<EmailSuppressionReason, "unsubscribe_link" | "one_click">,
): Promise<UnsubscribeTarget | null> {
  const target = await findUnsubscribeTarget(token);
  if (!target) return null;
  await suppressEmail({
    email: target.address,
    reason,
    detail: `email #${target.emailId}`,
    prospectId: target.prospectId,
    actor: reason === "one_click" ? "system:list-unsubscribe" : "system:unsubscribe-page",
  });
  return target;
}
