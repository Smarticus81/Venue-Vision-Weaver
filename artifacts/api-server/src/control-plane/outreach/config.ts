import { BRAND } from "@workspace/brand";
import { getAppBaseUrl } from "../../lib/appUrl.js";

/**
 * Outreach studio configuration. Everything here is optional at boot; the
 * defaults are safe placeholders that the operator sees in previews and must
 * replace before real sends (the CAN-SPAM address in particular).
 */

export const POSTAL_ADDRESS_PLACEHOLDER = `${BRAND.name} · [Street address] · [City, State ZIP]`;

/** Resend's shared sandbox sender only delivers to the account owner; never a real send. */
export const SANDBOX_SENDER_HOST = "resend.dev";

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

/** The configured From address (EMAIL_FROM), or null when it is unset. */
export function outreachFromAddress(): string | null {
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  if (!from) return null;
  const match = from.match(/<([^>]+)>/);
  const address = (match?.[1] ?? from).trim();
  return address.includes("@") ? address.toLowerCase() : null;
}

/** True when EMAIL_FROM is unset or points at Resend's sandbox sender (onboarding@resend.dev). */
export function senderIsSandbox(): boolean {
  const from = outreachFromAddress();
  if (!from) return true;
  return from.endsWith(`@${SANDBOX_SENDER_HOST}`) || from.endsWith(`.${SANDBOX_SENDER_HOST}`);
}

export function outreachPostalAddress(): string {
  return process.env.OUTREACH_POSTAL_ADDRESS?.trim() || POSTAL_ADDRESS_PLACEHOLDER;
}

export function postalAddressIsPlaceholder(): boolean {
  const address = outreachPostalAddress();
  return address === POSTAL_ADDRESS_PLACEHOLDER || /\[(street|city|state|zip)/i.test(address);
}

/** Optional mailbox listed in List-Unsubscribe alongside the https URL. */
export function outreachUnsubscribeMailbox(): string | null {
  return process.env.OUTREACH_UNSUBSCRIBE_MAILBOX?.trim() || null;
}

/**
 * Tracked claim link: /claim/:token pre-fills the venue's signup from the
 * prospect record and attributes the signup to this email. UTM parameters
 * name the channel, the campaign (or first touch) and the copy variant.
 */
export function claimUrl(
  token: string,
  options: { campaignId?: number | null; variantKey?: string | null; step?: number | null } = {},
): string {
  const params = new URLSearchParams({
    utm_source: "dreemer-outreach",
    utm_medium: "email",
    utm_campaign: options.campaignId ? `campaign-${options.campaignId}` : "first-touch",
    utm_content: options.variantKey ?? (options.step ? `step-${options.step}` : "default"),
  });
  return `${getAppBaseUrl()}/claim/${encodeURIComponent(token)}?${params.toString()}`;
}

/**
 * Where the one ask points. OUTREACH_CTA_URL wins when an operator set it;
 * otherwise the per-email claim link (trackable, attributable); and only when
 * no claim token exists, a reply (mailto) or the site root.
 */
export function outreachDefaultCtaUrl(
  venueName: string,
  claim: { token: string; campaignId?: number | null; variantKey?: string | null; step?: number | null } | null = null,
): string {
  const configured = process.env.OUTREACH_CTA_URL?.trim();
  if (configured) return configured;
  if (claim?.token) return claimUrl(claim.token, claim);
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

/** Failed research (fetch_failed) is not re-crawled on every draft; it waits this long. */
export const RESEARCH_FAILED_RETRY_HOURS = 24;

/* ————— Prospect vetting (vetting.md 1.7) ————— */

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

/** How long a vetting verdict stays valid; drafts and sends refuse older verdicts and re-run. */
export function vettingTtlDays(): number {
  return envInt("VETTING_TTL_DAYS", 30);
}

/** Max Google Places text searches per UTC day (the free Enterprise SKU is 1,000/month). */
export function placesDailyCap(): number {
  return envInt("VETTING_PLACES_DAILY_CAP", 30, 0);
}

/** RDAP bootstrap/redirector base (tests point it at a fixture). */
export function rdapBaseUrl(): string {
  return (process.env.VETTING_RDAP_BASE_URL?.trim() || "https://rdap.org").replace(/\/$/, "");
}

/** Wayback CDX endpoint. */
export function waybackCdxUrl(): string {
  return process.env.VETTING_WAYBACK_CDX_URL?.trim() || "https://web.archive.org/cdx/search/cdx";
}
