import { brand, font, semantic } from "@workspace/brand";
import { getAppBaseUrl } from "../../lib/appUrl.js";

/*
 * Email chrome for the growth loop's own messages (trial lifecycle emails,
 * the weekly operator digest, the aging-approvals nudge). Mirrors the
 * transactional layout in lib/emailService.ts, which keeps its helpers
 * private; the brand tokens are the single source of colour and type. All
 * styling is inline because email clients ignore most stylesheets and every
 * string is escaped before it lands in markup.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function growthEmailLayout(title: string, bodyHtml: string, options: { preheader?: string } = {}): string {
  const site = getAppBaseUrl();
  const safeSite = escapeHtml(site);
  const safeTitle = escapeHtml(title);
  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.preheader)}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    a { color: ${semantic.secondary}; }
    p { margin: 0 0 16px; }
    table.kpi td { padding: 8px 10px; border-bottom: 1px solid ${semantic.border}; font-size: 14px; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${semantic.band};font-family:${font.email};">
  ${preheader}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${semantic.band};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:${semantic.surface};border:1px solid ${semantic.border};border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 0;">
              <a href="${safeSite}" style="display:inline-block;text-decoration:none;font-family:${font.email};font-size:16px;font-weight:600;line-height:21px;color:${semantic.text};">${escapeHtml(brand.name)}</a>
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

export function growthCtaButton(href: string, label: string): string {
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

export function paragraphsHtml(paragraphs: string[]): string {
  return paragraphs
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

/** Plain-text twin: paragraphs separated by blank lines, CTA as "Label: URL". */
export function plainText(paragraphs: string[], cta?: { label: string; href: string } | null): string {
  const lines = paragraphs.map((p) => p.trim()).filter(Boolean);
  if (cta) lines.push(`${cta.label}: ${cta.href}`);
  lines.push(`${brand.name} · ${getAppBaseUrl()}`);
  return lines.join("\n\n");
}
