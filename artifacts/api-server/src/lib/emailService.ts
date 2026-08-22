import { Resend } from "resend";
import { logger } from "./logger.js";
import { getAppBaseUrl, shareUrlForToken } from "./appUrl.js";

const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM ?? "glimpse <onboarding@resend.dev>";
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

function emailLayout(title: string, bodyHtml: string): string {
  const site = getAppBaseUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f7f4ef;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f7f4ef;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fffdf9;border:1px solid #e8e0d4;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 8px;text-align:center;">
              <p style="margin:0;font-size:13px;letter-spacing:0.28em;text-transform:uppercase;color:#9a8b6e;">glimpse</p>
              <h1 style="margin:12px 0 0;font-size:26px;font-weight:500;color:#1f1f1f;line-height:1.3;">${escapeHtml(title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 28px;font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#3d3d3d;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #efe9df;text-align:center;font-family:system-ui,sans-serif;font-size:11px;color:#8a8278;">
              <a href="${escapeHtml(site)}" style="color:#8a8278;text-decoration:none;">${escapeHtml(site)}</a>
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
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px auto 8px;">
    <tr>
      <td style="border-radius:999px;background:#b8955a;">
        <a href="${safeHref}" style="display:inline-block;padding:14px 28px;font-family:system-ui,sans-serif;font-size:15px;font-weight:600;color:#fffdf9;text-decoration:none;">${safeLabel}</a>
      </td>
    </tr>
  </table>
  <p style="margin:12px 0 0;font-size:12px;color:#8a8278;text-align:center;word-break:break-all;">
    <a href="${safeHref}" style="color:#8a8278;">${safeHref}</a>
  </p>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<EmailSendResult> {
  if (!resend) {
    logger.warn({ to, subject }, "RESEND_API_KEY not set - skipping email");
    return { sent: false, reason: NOT_CONFIGURED_REASON };
  }
  try {
    const { error } = await resend.emails.send({ from: fromEmail, to, subject, html });
    if (error) {
      logger.error({ error, to, subject, from: fromEmail }, "Resend email failed");
      const providerMessage = error.message || "The email provider rejected the send.";
      return {
        sent: false,
        reason: `${providerMessage}${usingSandboxSender ? SANDBOX_HINT : ""}`,
      };
    }
    return { sent: true };
  } catch (err) {
    logger.error({ err, to, subject }, "Email send threw");
    return {
      sent: false,
      reason: "The email provider request failed. Check server connectivity and RESEND_API_KEY.",
    };
  }
}

export async function sendSessionCreatedNotification(
  ownerEmail: string | null | undefined,
  session: { id: number; coupleName?: string | null },
  venue: { name: string },
): Promise<void> {
  if (!ownerEmail) return;
  const couple = session.coupleName ? ` (${session.coupleName})` : "";
  const body = `<p>A new couple just started a session at <strong>${escapeHtml(venue.name)}</strong>${escapeHtml(couple)}.</p>
    <p>Session #${session.id} is now processing.</p>`;
  await sendEmail(
    ownerEmail,
    `New session at ${venue.name}`,
    emailLayout("New couple session", body),
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
  const body = `<p>The gallery for <strong>${escapeHtml(couple)}</strong> at ${escapeHtml(venue.name)} is ready.</p>
    ${ctaButton(url, "View the gallery")}`;
  await sendEmail(
    ownerEmail,
    `Gallery ready - ${venue.name}`,
    emailLayout("A glimpse gallery is ready", body),
  );
}

export async function sendGalleryToCouple(
  coupleEmail: string,
  session: { id: number; shareToken?: string | null; coupleName?: string | null },
  venue: { name: string },
): Promise<EmailSendResult> {
  const url = shareUrlForToken(session.shareToken);
  const greeting = session.coupleName
    ? escapeHtml(session.coupleName)
    : "there";
  const body = `<p>Hi ${greeting},</p>
    <p>Your glimpse gallery at <strong>${escapeHtml(venue.name)}</strong> is ready to view.</p>
    ${ctaButton(url, "Open your gallery")}
    <p style="margin-top:20px;font-size:13px;color:#8a8278;">Bookmark this email - the button above is your private link to view again anytime.</p>`;
  return sendEmail(
    coupleEmail,
    `Your glimpse at ${venue.name} is ready`,
    emailLayout("Your glimpse is ready", body),
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
  const rows = sessions
    .filter((s) => !!s.shareToken)
    .map((s) => {
      const url = shareUrlForToken(s.shareToken);
      const when = new Date(s.createdAt).toLocaleDateString();
      const label = escapeHtml(s.coupleName || `Gallery #${s.id}`);
      return `<tr>
        <td style="padding:10px 8px;border-bottom:1px solid #efe9df;">${label}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #efe9df;color:#666;">${escapeHtml(s.venueName)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #efe9df;color:#666;">${when}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #efe9df;">
          <a href="${escapeHtml(url)}" style="color:#b8955a;font-weight:600;text-decoration:none;">Open gallery</a>
        </td>
      </tr>`;
    })
    .join("");

  const body = `<p>Here are the glimpse galleries we found for this email address:</p>
     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;font-family:system-ui,sans-serif;font-size:14px;">
       <thead>
         <tr style="text-align:left;color:#666;">
           <th style="padding:8px;border-bottom:2px solid #ddd;">Couple</th>
           <th style="padding:8px;border-bottom:2px solid #ddd;">Venue</th>
           <th style="padding:8px;border-bottom:2px solid #ddd;">Date</th>
           <th style="padding:8px;border-bottom:2px solid #ddd;"></th>
         </tr>
       </thead>
       <tbody>${rows}</tbody>
     </table>
     <p style="color:#8a8278;font-size:12px;">These links are private. If you did not request this email, you can ignore it.</p>`;

  return sendEmail(
    email,
    "Your glimpse gallery links",
    emailLayout("Find your galleries", body),
  );
}

