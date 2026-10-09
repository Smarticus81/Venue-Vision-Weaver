import crypto from "crypto";
import { Resend } from "resend";
import { brand, font, semantic } from "@workspace/brand";
import { logger } from "./logger.js";
import { getAppBaseUrl, shareUrlForToken } from "./appUrl.js";

/**
 * Recipients are logged as a short keyed hash, never as the address: logs are
 * long-lived and shipped elsewhere, while the address is personal data.
 */
export function hashRecipient(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("base64url").slice(0, 16);
}

const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM ?? "Dreemer <onboarding@resend.dev>";
const usingSandboxSender = fromEmail.includes("onboarding@resend.dev");

const resend = resendApiKey ? new Resend(resendApiKey) : null;

// Make broken email config loud at boot instead of failing silently per-send.
if (!resend) {
  logger.warn(
    "Email delivery is DISABLED: RESEND_API_KEY is not set. Gallery links, owner notifications, and recovery emails will not be sent.",
  );
} else if (usingSandboxSender) {
  logger.warn(
    { from: fromEmail },
    "EMAIL_FROM is the Resend sandbox sender (onboarding@resend.dev). Resend only delivers sandbox mail to the Resend account owner's own address — couples and venue owners will NOT receive email. Set EMAIL_FROM to a sender on a domain verified in Resend.",
  );
}

export type EmailSendResult = { sent: true } | { sent: false; reason: string };

const NOT_CONFIGURED_REASON =
  "Email is not configured on this server (RESEND_API_KEY is not set).";
const SANDBOX_HINT =
  " Note: EMAIL_FROM is the Resend sandbox sender (onboarding@resend.dev), which can only deliver to the Resend account owner's own address — set EMAIL_FROM to a sender on a domain verified in Resend.";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shared email chrome, built on the brand tokens: ivory band behind a single
 * card, the lockup up top, one heading, body copy, and a quiet footer. All
 * styling is inline because email clients ignore most stylesheets.
 */
function emailLayout(title: string, bodyHtml: string): string {
  const site = getAppBaseUrl();
  const safeSite = escapeHtml(site);
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    a { color: ${semantic.secondary}; }
    p { margin: 0 0 16px; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${semantic.band};font-family:${font.email};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${semantic.band};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:${semantic.surface};border:1px solid ${semantic.border};border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 0;">
              <a href="${safeSite}" style="display:inline-block;text-decoration:none;">
                <img src="${safeSite}/dreemer-lockup-email.png" width="140" height="21" alt="${escapeHtml(brand.name)}" style="display:block;border:0;outline:none;width:140px;height:21px;font-family:${font.email};font-size:16px;font-weight:600;line-height:21px;color:${semantic.text};" />
              </a>
              <h1 style="margin:24px 0 0;font-family:${font.email};font-size:24px;font-weight:600;line-height:1.25;color:${semantic.text};">${safeTitle}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 28px;font-family:${font.email};font-size:15px;line-height:1.6;color:${semantic.textSecondary};">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid ${semantic.border};font-family:${font.email};font-size:12px;line-height:1.6;color:${semantic.textMuted};">
              <a href="${safeSite}" style="color:${semantic.textMuted};text-decoration:none;">${safeSite}</a><br />
              ${escapeHtml(brand.name)} · ${escapeHtml(brand.tagline)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 8px;">
    <tr>
      <td style="border-radius:8px;background:${semantic.accent};">
        <a href="${safeHref}" style="display:inline-block;padding:14px 28px;border-radius:8px;font-family:${font.email};font-size:15px;font-weight:600;line-height:1.2;color:${semantic.textOnAccent};text-decoration:none;">${safeLabel}</a>
      </td>
    </tr>
  </table>
  <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:${semantic.textMuted};word-break:break-all;">
    <a href="${safeHref}" style="color:${semantic.textMuted};">${safeHref}</a>
  </p>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<EmailSendResult> {
  if (!resend) {
    logger.warn({ to: hashRecipient(to), subject }, "RESEND_API_KEY not set - skipping email");
    return { sent: false, reason: NOT_CONFIGURED_REASON };
  }
  try {
    const { error } = await resend.emails.send({ from: fromEmail, to, subject, html });
    if (error) {
      logger.error({ error, to: hashRecipient(to), subject, from: fromEmail }, "Resend email failed");
      const providerMessage = error.message || "The email provider rejected the send.";
      return {
        sent: false,
        reason: `${providerMessage}${usingSandboxSender ? SANDBOX_HINT : ""}`,
      };
    }
    return { sent: true };
  } catch (err) {
    logger.error({ err, to: hashRecipient(to), subject }, "Email send threw");
    return {
      sent: false,
      reason: "The email provider request failed. Check server connectivity and RESEND_API_KEY.",
    };
  }
}

/**
 * transient: the provider did not give a definite answer (timeout, connection
 * reset, rate limit, 5xx), so the message may or may not have gone out. With
 * an idempotency key a retry is safe; callers must not treat it as rejected.
 */
export type RawEmailSendResult = { sent: true; id: string | null } | { sent: false; reason: string; transient?: boolean };

const TRANSIENT_RESEND_ERRORS = new Set([
  "rate_limit_exceeded",
  "application_error",
  "internal_server_error",
  "concurrent_idempotent_requests",
]);

export function isTransientResendError(name: string | null | undefined): boolean {
  return name != null && TRANSIENT_RESEND_ERRORS.has(name);
}

/**
 * Fully rendered message with its own HTML, plain-text twin, and headers —
 * used by the outreach studio, which owns its template (List-Unsubscribe
 * headers, reply-to, physical-address footer). Returns the provider id so
 * delivery webhooks can be matched back to the message.
 */
export async function sendRawEmail(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  replyTo?: string | null;
  /** Resend tags (ASCII letters, digits, _ and - only) for grouping delivery events. */
  tags?: Array<{ name: string; value: string }>;
  /** Sent as the Idempotency-Key header: Resend delivers one message per key (24h). */
  idempotencyKey?: string;
}): Promise<RawEmailSendResult> {
  if (!resend) {
    logger.warn({ to: hashRecipient(message.to), subject: message.subject }, "RESEND_API_KEY not set - skipping email");
    return { sent: false, reason: NOT_CONFIGURED_REASON };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.tags?.length ? { tags: message.tags } : {}),
    }, message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined);
    if (error) {
      logger.error({ error, to: hashRecipient(message.to), subject: message.subject, from: fromEmail }, "Resend email failed");
      const providerMessage = error.message || "The email provider rejected the send.";
      return {
        sent: false,
        reason: `${providerMessage}${usingSandboxSender ? SANDBOX_HINT : ""}`,
        transient: isTransientResendError(error.name),
      };
    }
    return { sent: true, id: data?.id ?? null };
  } catch (err) {
    logger.error({ err, to: hashRecipient(message.to), subject: message.subject }, "Email send threw");
    return {
      sent: false,
      reason: "The email provider request failed. Check server connectivity and RESEND_API_KEY.",
      transient: true,
    };
  }
}

export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  replyTo?: string | null;
  /** Resend tags (name/value pairs) for grouping delivery events. */
  tags?: Array<{ name: string; value: string }>;
}

/**
 * Generic transactional sender over the shared Resend client for lifecycle
 * and operator email (trial nudges, low-credit reminders, weekly digest).
 * Returns the provider message id, or null when email is disabled or the
 * provider rejected the send (the reason is logged; callers treat null as
 * "not delivered" and never throw on it).
 */
export async function sendTransactionalEmail(message: TransactionalEmail): Promise<{ id: string } | null> {
  if (!resend) {
    logger.warn({ to: hashRecipient(message.to), subject: message.subject }, "RESEND_API_KEY not set - skipping email");
    return null;
  }
  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.tags?.length ? { tags: message.tags } : {}),
    });
    if (error) {
      logger.error({ error, to: hashRecipient(message.to), subject: message.subject, from: fromEmail }, "Resend email failed");
      return null;
    }
    return data?.id ? { id: data.id } : null;
  } catch (err) {
    logger.error({ err, to: hashRecipient(message.to), subject: message.subject }, "Email send threw");
    return null;
  }
}

/**
 * Generic branded email used by the Autonomous Business Control Plane for
 * governed venue outreach (activation nudges, low-credit reminders, support
 * follow-ups). Body is plain-text paragraphs; everything is escaped.
 */
export async function sendControlPlaneEmail(
  to: string,
  subject: string,
  paragraphs: string[],
): Promise<EmailSendResult> {
  const body = paragraphs
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
  if (!body) {
    return { sent: false, reason: "The email had no message body to send." };
  }
  return sendEmail(to, subject, emailLayout(subject, body));
}

export async function sendSessionCreatedNotification(
  ownerEmail: string | null | undefined,
  session: { id: number; coupleName?: string | null },
  venue: { name: string },
): Promise<void> {
  if (!ownerEmail) return;
  const who = session.coupleName
    ? `<strong>${escapeHtml(session.coupleName)}</strong>`
    : "A couple";
  const body = `<p>${who} just started a gallery at <strong>${escapeHtml(venue.name)}</strong>.</p>
    <p>It's session #${session.id}. We'll email you again when it's ready.</p>`;
  await sendEmail(
    ownerEmail,
    `New couple at ${venue.name}`,
    emailLayout("A couple just started a gallery", body),
  );
}

export async function sendGalleryReadyNotification(
  ownerEmail: string | null | undefined,
  session: { id: number; coupleName?: string | null; shareToken?: string | null },
  venue: { name: string },
): Promise<void> {
  if (!ownerEmail) return;
  const couple = session.coupleName ?? "A couple";
  const url = shareUrlForToken(session.shareToken);
  const body = `<p>The gallery for <strong>${escapeHtml(couple)}</strong> at <strong>${escapeHtml(venue.name)}</strong> is ready.</p>
    ${ctaButton(url, "Review the gallery")}
    <p style="margin:20px 0 0;">Check the likeness, then send it to the couple from your dashboard.</p>`;
  await sendEmail(
    ownerEmail,
    `Gallery ready to review – ${venue.name}`,
    emailLayout("A gallery is ready to review", body),
  );
}

export interface GalleryEmailOptions {
  /** Overrides venue.name in the copy (e.g. when the caller only has a slimmer venue row). */
  venueName?: string | null;
  /** Secondary "check your date" link under the gallery button; omitted when absent. */
  bookingCta?: { label: string; href: string } | null;
}

export async function sendGalleryToCouple(
  coupleEmail: string,
  session: { id: number; shareToken?: string | null; coupleName?: string | null },
  venue: { name: string },
  options: GalleryEmailOptions = {},
): Promise<EmailSendResult> {
  const url = shareUrlForToken(session.shareToken);
  const venueName = options.venueName?.trim() || venue.name;
  const greeting = session.coupleName
    ? escapeHtml(session.coupleName)
    : "there";
  const bookingCta = options.bookingCta?.href?.trim()
    ? `<p style="margin:20px 0 0;">
      <a href="${escapeHtml(options.bookingCta.href.trim())}" style="color:${semantic.secondary};font-weight:600;text-decoration:none;">${escapeHtml(
        options.bookingCta.label.trim() || `Check your date at ${venueName}`,
      )}</a>
    </p>`
    : "";
  const body = `<p>Hi ${greeting},</p>
    <p>Here are your images and reel at <strong>${escapeHtml(venueName)}</strong>.</p>
    ${ctaButton(url, "Open your gallery")}
    ${bookingCta}
    <p style="margin:20px 0 0;font-size:13px;color:${semantic.textMuted};">Keep this email — the button is your private link.</p>`;
  return sendEmail(
    coupleEmail,
    `Your gallery at ${venueName} is ready`,
    emailLayout("Your gallery is ready", body),
  );
}

export async function sendRecoveryEmail(
  email: string,
  sessions: Array<{
    id: number;
    shareToken: string | null;
    coupleName: string | null;
    venueName: string;
    status: string;
    createdAt: Date | string;
  }>,
): Promise<EmailSendResult> {
  if (sessions.length === 0) return { sent: false, reason: "No sessions to include." };
  const cell = `padding:10px 8px;border-bottom:1px solid ${semantic.border};`;
  const rows = sessions
    .filter((s) => !!s.shareToken)
    .map((s) => {
      const url = shareUrlForToken(s.shareToken);
      const when = new Date(s.createdAt).toLocaleDateString();
      const label = escapeHtml(s.coupleName || `Gallery #${s.id}`);
      return `<tr>
        <td style="${cell}color:${semantic.text};">${label}</td>
        <td style="${cell}color:${semantic.textMuted};">${escapeHtml(s.venueName)}</td>
        <td style="${cell}color:${semantic.textMuted};">${when}</td>
        <td style="${cell}">
          <a href="${escapeHtml(url)}" style="color:${semantic.secondary};font-weight:600;text-decoration:none;">Open gallery</a>
        </td>
      </tr>`;
    })
    .join("");

  const head = `padding:8px;border-bottom:2px solid ${semantic.border};font-weight:600;color:${semantic.textMuted};`;
  const body = `<p>Here are the galleries linked to this email address:</p>
     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;font-family:${font.email};font-size:14px;">
       <thead>
         <tr style="text-align:left;">
           <th style="${head}">Couple</th>
           <th style="${head}">Venue</th>
           <th style="${head}">Date</th>
           <th style="${head}"></th>
         </tr>
       </thead>
       <tbody>${rows}</tbody>
     </table>
     <p style="margin:0;color:${semantic.textMuted};font-size:12px;">These links are private. If you did not request this email, you can ignore it.</p>`;

  return sendEmail(
    email,
    "Your Dreemer gallery links",
    emailLayout("Your galleries", body),
  );
}

/* ————— Owner billing nudges (sessions workstream) ————— */

/**
 * Where owner emails send venues to pick a plan or add credits. Honors
 * GROWTH_PRICING_URL (shared-contract D23); defaults to the dashboard
 * upgrade panel anchor.
 */
export function billingDeepLink(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GROWTH_PRICING_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).toString();
    } catch {
      /* fall through to the default */
    }
  }
  return `${getAppBaseUrl()}/dashboard#pricing`;
}

export interface OwnerCreditsExhaustedEmail {
  ownerEmail: string | null | undefined;
  venue: { name: string; slug: string };
  coupleName?: string | null;
  /** trial_expired: the clock ran out; insufficient_credits: the balance did. */
  reason: "trial_expired" | "insufficient_credits";
  billingUrl?: string;
}

export interface RenderedOwnerEmail {
  subject: string;
  title: string;
  html: string;
  text: string;
}

/**
 * Rendered copy for the credits-exhausted owner email. Exported so the words
 * and the deep link can be checked without a mail provider.
 */
export function renderOwnerCreditsExhausted(input: OwnerCreditsExhaustedEmail): RenderedOwnerEmail {
  const billingUrl = input.billingUrl ?? billingDeepLink();
  const who = input.coupleName?.trim() ? input.coupleName.trim() : "A couple";
  const venueName = input.venue.name;
  const trial = input.reason === "trial_expired";
  const subject = trial
    ? `A couple at ${venueName} is waiting on your plan`
    : `A couple at ${venueName} could not start a gallery`;
  const title = trial ? "Your free trial has ended" : "Your credits ran out";
  const cause = trial
    ? "your free trial has ended. Any credits you still have stay on your account; picking a plan unlocks them again."
    : "your organization has no gallery credits left.";
  const action = trial ? "Pick a plan" : "Add credits";
  const paragraphs = [
    `${who} just tried to start a gallery at ${venueName}, but ${cause}`,
    'Until then, couples at your venue see a short "check back soon" notice instead of their gallery.',
  ];
  const footnote = "Credits are shared across every venue in your organization.";
  const html = `<p>${escapeHtml(paragraphs[0]!)}</p>
    <p>${escapeHtml(paragraphs[1]!)}</p>
    ${ctaButton(billingUrl, action)}
    <p style="margin:20px 0 0;font-size:13px;color:${semantic.textMuted};">${escapeHtml(footnote)}</p>`;
  const text = `${paragraphs[0]}\n\n${paragraphs[1]}\n\n${action}: ${billingUrl}\n\n${footnote}`;
  return { subject, title, html, text };
}

export async function sendOwnerCreditsExhausted(input: OwnerCreditsExhaustedEmail): Promise<EmailSendResult> {
  if (!input.ownerEmail) return { sent: false, reason: "No owner email on file." };
  const rendered = renderOwnerCreditsExhausted(input);
  return sendEmail(input.ownerEmail, rendered.subject, emailLayout(rendered.title, rendered.html));
}

export interface OwnerLowCreditEmail {
  ownerEmail: string | null | undefined;
  venue: { name: string; slug: string };
  creditsLeft: number;
  billingUrl?: string;
}

export function renderOwnerLowCredit(input: OwnerLowCreditEmail): RenderedOwnerEmail {
  const billingUrl = input.billingUrl ?? billingDeepLink();
  const n = Math.max(0, Math.floor(input.creditsLeft));
  const unit = n === 1 ? "credit" : "credits";
  const subject =
    n === 0
      ? `No gallery credits left for ${input.venue.name}`
      : `${n} gallery ${unit} left for ${input.venue.name}`;
  const title = n === 0 ? "You are out of credits" : "You are almost out of credits";
  const paragraphs = [
    n === 0 ? "Your organization has no gallery credits left." : `Your organization has ${n} gallery ${unit} left.`,
    'Each couple gallery uses one credit. When they run out, couples at your venue see a short "check back soon" notice instead of their gallery.',
  ];
  const action = "Add credits";
  const html = `<p>${escapeHtml(paragraphs[0]!)}</p>
    <p>${escapeHtml(paragraphs[1]!)}</p>
    ${ctaButton(billingUrl, action)}`;
  const text = `${paragraphs[0]}\n\n${paragraphs[1]}\n\n${action}: ${billingUrl}`;
  return { subject, title, html, text };
}

export async function sendOwnerLowCredit(input: OwnerLowCreditEmail): Promise<EmailSendResult> {
  if (!input.ownerEmail) return { sent: false, reason: "No owner email on file." };
  const rendered = renderOwnerLowCredit(input);
  return sendEmail(input.ownerEmail, rendered.subject, emailLayout(rendered.title, rendered.html));
}
