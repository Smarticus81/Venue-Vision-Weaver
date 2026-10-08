import { BRAND } from "@workspace/brand";
import { getAppBaseUrl } from "../../lib/appUrl.js";

/**
 * Outreach studio configuration. Everything here is optional at boot; the
 * defaults are safe placeholders that the operator sees in previews and must
 * replace before real sends (the CAN-SPAM address in particular).
 */

export const POSTAL_ADDRESS_PLACEHOLDER = `${BRAND.name} · [Street address] · [City, State ZIP]`;

export function outreachSenderName(): string {
  return process.env.OUTREACH_SENDER_NAME?.trim() || `The ${BRAND.name} team`;
}

/** First name used in the sign-off ("Thanks, Sam"). */
export function outreachSenderFirstName(): string {
  const name = outreachSenderName();
  const first = name.split(/\s+/)[0] ?? name;
  return first.toLowerCase() === "the" ? BRAND.name : first;
}

export function outreachReplyTo(): string | null {
  const explicit = process.env.OUTREACH_REPLY_TO?.trim();
  if (explicit) return explicit;
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const match = from.match(/<([^>]+)>/);
  const address = match?.[1] ?? from;
  return address.includes("@") ? address : null;
}

export function outreachPostalAddress(): string {
  return process.env.OUTREACH_POSTAL_ADDRESS?.trim() || POSTAL_ADDRESS_PLACEHOLDER;
}

export function postalAddressIsPlaceholder(): boolean {
  return outreachPostalAddress() === POSTAL_ADDRESS_PLACEHOLDER;
}

/** Optional mailbox listed in List-Unsubscribe alongside the https URL. */
export function outreachUnsubscribeMailbox(): string | null {
  return process.env.OUTREACH_UNSUBSCRIBE_MAILBOX?.trim() || null;
}

/** Where the one ask points. Defaults to a reply (mailto) when nothing is configured. */
export function outreachDefaultCtaUrl(venueName: string): string {
  const configured = process.env.OUTREACH_CTA_URL?.trim();
  if (configured) return configured;
  const replyTo = outreachReplyTo();
  const subject = encodeURIComponent(`Free preview for ${venueName}`);
  if (replyTo) return `mailto:${replyTo}?subject=${subject}`;
  return getAppBaseUrl();
}

export function unsubscribeUrl(token: string): string {
  return `${getAppBaseUrl()}/api/outreach/unsubscribe/${encodeURIComponent(token)}`;
}

export function publicObjectUrl(objectKey: string): string {
  const key = objectKey.startsWith("/") ? objectKey : `/${objectKey}`;
  return `${getAppBaseUrl()}/api/storage${key}`;
}

/** Research results older than this are refreshed before a new draft. */
export const RESEARCH_STALE_DAYS = 14;
