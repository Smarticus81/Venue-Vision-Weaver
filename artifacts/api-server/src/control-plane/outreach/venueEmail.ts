import { BRAND, BRAND_COLORS, BRAND_TYPE } from "@workspace/brand";
import { escapeHtml } from "./emailTemplate.js";

/**
 * Template for governed operational email to a venue owner (send_venue_email:
 * activation nudges, low-credit reminders, support follow-ups). Plain
 * paragraphs, a footer that says why the owner is receiving it and how to
 * stop, the postal address, and RFC 2369 List-Unsubscribe headers pointing at
 * a monitored mailbox. Everything user-supplied is escaped.
 */

export interface VenueEmailInput {
  subject: string;
  paragraphs: string[];
  venueName: string;
  postalAddress: string;
  /** Mailbox that receives "unsubscribe" requests (reply-to or OUTREACH_UNSUBSCRIBE_MAILBOX). */
  unsubscribeMailbox: string | null;
}

export interface RenderedVenueEmail {
  html: string;
  text: string;
  headers: Record<string, string>;
}

export function venueEmailFooter(venueName: string): string {
  return `You are receiving this because you manage ${venueName} on ${BRAND.name}. Reply "unsubscribe" and we will stop these notes; account and billing messages still reach you.`;
}

export function renderVenueEmail(input: VenueEmailInput): RenderedVenueEmail {
  const colors = BRAND_COLORS.light;
  const font = BRAND_TYPE.body.replace(/"/g, "'");
  const paragraphs = input.paragraphs.map((p) => p.trim()).filter(Boolean);
  const footer = venueEmailFooter(input.venueName);
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${font};font-size:16px;line-height:26px;color:${colors.ink};">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`,
    )
    .join("\n");
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background-color:${colors.canvas};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${colors.canvas};">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
        <tr><td style="padding:24px;background-color:${colors.surface};border:1px solid ${colors.border};border-radius:10px;">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 8px 0;">
          <p style="margin:0 0 8px;font-family:${font};font-size:12px;line-height:18px;color:${colors.inkMuted};">${escapeHtml(footer)}</p>
          <p style="margin:0;font-family:${font};font-size:12px;line-height:18px;color:${colors.inkMuted};">${escapeHtml(input.postalAddress)}<br />${escapeHtml(BRAND.name)} &middot; ${escapeHtml(BRAND.domain)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [...paragraphs.flatMap((p) => [p, ""]), "—", footer, input.postalAddress, `${BRAND.name} · ${BRAND.domain}`].join("\n");
  const headers: Record<string, string> = input.unsubscribeMailbox
    ? { "List-Unsubscribe": `<mailto:${input.unsubscribeMailbox}?subject=unsubscribe>` }
    : {};
  return { html, text, headers };
}
