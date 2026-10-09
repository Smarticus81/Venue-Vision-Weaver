import { BRAND, BRAND_COLORS, BRAND_EMAIL, BRAND_TYPE, brandMarkSvg } from "@workspace/brand";

/**
 * The outreach email: a personal note with the venue's own photos as the
 * centerpiece and a quiet Dreemer signature. Table-based, 600px, fluid on
 * mobile, light and dark mode (prefers-color-scheme plus Outlook's
 * [data-ogsc]), MSO conditionals for Outlook desktop, a plain-text twin, and
 * every user-provided string escaped. No template engine or runtime
 * dependency: the markup here is what React Email / MJML would compile to,
 * kept in one file so it can be unit-tested with node:test.
 */

export interface TemplateImage {
  url: string;
  alt: string;
  width: number;
  height: number;
  /** Hostname the photo was taken from, shown as a small credit. */
  sourceHost: string | null;
  /** True for operator-generated Dreemer samples; they are labeled as such. */
  isSample?: boolean;
}

export interface TemplateInput {
  subject: string;
  greeting: string;
  /** Plain-text paragraphs (already split on blank lines). */
  paragraphs: string[];
  /** Sign-off lines, e.g. ["Thanks,", "Sam at Dreemer"]. */
  signOffLines: string[];
  ctaLabel: string;
  ctaUrl: string;
  images: TemplateImage[];
  venueName: string;
  unsubscribeUrl: string;
  postalAddress: string;
  /**
   * Why this address is receiving the note (CAN-SPAM commercial notice and
   * opt-out expectation). Defaults to defaultWhyLine(venueName).
   */
  whyLine?: string;
  /** Optional mailbox listed in List-Unsubscribe next to the https URL. */
  unsubscribeMailbox?: string | null;
  /** Preview-only: render the dark palette unconditionally. */
  forceScheme?: "light" | "dark";
}

/** The footer sentence: commercial nature, why this address, and the contact limit. */
export function defaultWhyLine(venueName: string): string {
  return `This is a personal note from someone at ${BRAND.name}, sent because ${venueName} publicly lists this address for event inquiries. We write at most three times and stop as soon as you reply or unsubscribe.`;
}

type Palette = Record<keyof typeof BRAND_COLORS.light, string>;

/** Font stacks for inline style attributes: single quotes so they survive style="...". */
const FONT_BODY = BRAND_TYPE.body.replace(/"/g, "'");

export interface RenderedEmail {
  html: string;
  text: string;
  /** Headers the sender must attach (RFC 2369 + RFC 8058). */
  headers: Record<string, string>;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeHref(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed) && !/[\s<>"']/.test(trimmed)) return trimmed;
  return "#";
}

export function buildListUnsubscribeHeaders(unsubscribeUrl: string, mailbox: string | null): Record<string, string> {
  const targets = [`<${unsubscribeUrl}>`];
  if (mailbox) targets.push(`<mailto:${mailbox}?subject=unsubscribe>`);
  return {
    "List-Unsubscribe": targets.join(", "),
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function splitParagraphs(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function paragraphHtml(text: string, color: string): string {
  return `<p class="dm-ink" style="margin:0 0 18px;font-family:${FONT_BODY};font-size:16px;line-height:26px;color:${color};mso-line-height-rule:exactly;">${escapeHtml(text).replace(/\n/g, "<br />")}</p>`;
}

function darkRules(prefix: string): string {
  const d = BRAND_COLORS.dark;
  return `
      ${prefix} .dm-canvas { background-color: ${d.canvas} !important; }
      ${prefix} .dm-surface { background-color: ${d.surface} !important; }
      ${prefix} .dm-soft { background-color: ${d.soft} !important; }
      ${prefix} .dm-ink { color: ${d.ink} !important; }
      ${prefix} .dm-muted { color: ${d.inkMuted} !important; }
      ${prefix} .dm-link { color: ${d.accent} !important; }
      ${prefix} .dm-border { border-color: ${d.border} !important; }
      ${prefix} .dm-btn { background-color: ${d.accent} !important; }
      ${prefix} .dm-btn a { color: ${d.onAccent} !important; }
      ${prefix} .dm-mark-light { display: none !important; }
      ${prefix} .dm-mark-dark { display: inline !important; }`;
}

function imageBlock(image: TemplateImage, width: number, colors: Palette, radius: string): string {
  const height = Math.round((image.height / image.width) * width);
  const credit = image.isSample
    ? `Sample ${BRAND.name} preview, made for illustration`
    : image.sourceHost
      ? `Photo: ${image.sourceHost}`
      : null;
  return `<img class="fluid" src="${escapeHtml(image.url)}" width="${width}" height="${height}" alt="${escapeHtml(image.alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:${radius};" />${
    credit
      ? `<p class="dm-muted" style="margin:8px 0 0;font-family:${FONT_BODY};font-size:12px;line-height:16px;color:${colors.inkMuted};">${escapeHtml(credit)}</p>`
      : ""
  }`;
}

export function renderOutreachEmail(input: TemplateInput): RenderedEmail {
  const colors: Palette = input.forceScheme === "dark" ? BRAND_COLORS.dark : BRAND_COLORS.light;
  const width = BRAND_EMAIL.contentWidth;
  const gutter = BRAND_EMAIL.gutter;
  const inner = width - gutter * 2;
  const radius = `${10}px`;
  const ctaHref = safeHref(input.ctaUrl);
  const unsubscribeHref = safeHref(input.unsubscribeUrl);
  const whyLine = input.whyLine?.trim() || defaultWhyLine(input.venueName);
  // The hero should be a landscape frame; a portrait photo leads only when nothing else is available.
  const ordered = input.images.slice(0, 3);
  const landscapeIndex = ordered.findIndex((image) => image.width / image.height >= 1.1);
  if (landscapeIndex > 0) ordered.unshift(...ordered.splice(landscapeIndex, 1));
  const [hero, ...rest] = ordered;
  const aspect = (image: TemplateImage) => image.width / image.height;
  const twoUp = rest.length === 2 && Math.abs(aspect(rest[0]!) - aspect(rest[1]!)) / aspect(rest[0]!) <= 0.12;
  const preheader = input.paragraphs[0]?.split(/(?<=[.!?])\s/)[0]?.slice(0, 140) ?? input.subject;

  const paragraphs = input.paragraphs.map((p) => paragraphHtml(p, colors.ink));
  // Secondary images sit after the first paragraph so the note still opens with words.
  const secondary = twoUp
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 22px;"><tr>
              <td class="stack" width="50%" valign="top" style="padding:0 6px 0 0;">${imageBlock(rest[0]!, Math.floor(inner / 2) - 6, colors, "8px")}</td>
              <td class="stack stack-gap" width="50%" valign="top" style="padding:0 0 0 6px;">${imageBlock(rest[1]!, Math.floor(inner / 2) - 6, colors, "8px")}</td>
            </tr></table>`
    : rest
        .map(
          (image) =>
            `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 22px;"><tr><td>${imageBlock(image, inner, colors, "8px")}</td></tr></table>`,
        )
        .join("");
  const bodyHtml =
    paragraphs.length > 1
      ? `${paragraphs[0]}${secondary}${paragraphs.slice(1).join("")}`
      : `${paragraphs.join("")}${secondary}`;

  const markLight = brandMarkSvg(BRAND_COLORS.light.accent, 18);
  const markDark = brandMarkSvg(BRAND_COLORS.dark.accent, 18);

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${escapeHtml(input.subject)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; } img { -ms-interpolation-mode: bicubic; } p, a { font-family: Georgia, Arial, sans-serif !important; }</style>
  <![endif]-->
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    html, body { margin: 0 !important; padding: 0 !important; height: 100% !important; width: 100% !important; }
    * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
    table { border-spacing: 0; }
    img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
    a { text-decoration: underline; }
    .dm-mark-dark { display: none; }
    @media screen and (max-width: 620px) {
      .container { width: 100% !important; max-width: 100% !important; }
      .px { padding-left: 20px !important; padding-right: 20px !important; }
      .stack { display: block !important; width: 100% !important; padding: 0 !important; }
      .stack-gap { padding-top: 12px !important; }
      .fluid { width: 100% !important; max-width: 100% !important; height: auto !important; }
      .canvas-pad { padding: 12px 0 !important; }
      .card { border-radius: 0 !important; }
      .btn a { display: block !important; text-align: center !important; }
    }
    @media (prefers-color-scheme: dark) {${darkRules("")}
    }${darkRules("[data-ogsc]")}${input.forceScheme === "dark" ? darkRules("") : ""}
  </style>
</head>
<body class="dm-canvas" style="margin:0;padding:0;background-color:${colors.canvas};word-spacing:normal;">
  <div role="article" aria-roledescription="email" aria-label="${escapeHtml(input.subject)}" lang="en" style="background-color:${colors.canvas};">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" class="dm-canvas" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${colors.canvas};">
    <tr>
      <td class="canvas-pad" align="center" style="padding:28px 12px;">
        <!--[if mso]><table role="presentation" width="${width}" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td><![endif]-->
        <table role="presentation" class="container" width="${width}" cellspacing="0" cellpadding="0" border="0" style="width:${width}px;max-width:${width}px;margin:0 auto;table-layout:fixed;">
          <tr>
            <td class="px" style="padding:0 ${gutter}px 14px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                <td valign="middle" style="padding-right:7px;line-height:0;"><span class="dm-mark-light">${markLight}</span><span class="dm-mark-dark">${markDark}</span></td>
                <td valign="middle" class="dm-muted" style="font-family:${FONT_BODY};font-size:14px;letter-spacing:0.02em;color:${colors.inkMuted};">${escapeHtml(BRAND.wordmark)}</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td class="card dm-surface dm-border" style="background-color:${colors.surface};border:1px solid ${colors.border};border-radius:${radius};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${
                  hero
                    ? `<tr><td class="px" style="padding:${gutter - 8}px ${gutter}px 0;">${imageBlock(hero, inner, colors, radius)}</td></tr>`
                    : ""
                }
                <tr>
                  <td class="px" style="padding:${hero ? 24 : gutter}px ${gutter}px 8px;">
                    ${paragraphHtml(input.greeting, colors.ink)}
                    ${bodyHtml}
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:4px ${gutter}px 26px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" class="btn"><tr>
                      <td class="dm-btn" style="background-color:${colors.accent};border-radius:6px;mso-padding-alt:13px 22px;">
                        <a href="${escapeHtml(ctaHref)}" style="display:inline-block;padding:13px 22px;font-family:${FONT_BODY};font-size:15px;font-weight:600;line-height:18px;color:${colors.onAccent};text-decoration:none;border-radius:6px;">${escapeHtml(input.ctaLabel)}</a>
                      </td>
                    </tr></table>
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:0 ${gutter}px ${gutter}px;">
                    <p class="dm-ink" style="margin:0;font-family:${FONT_BODY};font-size:16px;line-height:26px;color:${colors.ink};">${input.signOffLines.map(escapeHtml).join("<br />")}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:22px ${gutter}px 8px;">
              <p class="dm-muted" style="margin:0 0 10px;font-family:${FONT_BODY};font-size:12px;line-height:18px;color:${colors.inkMuted};">${escapeHtml(whyLine)} <a class="dm-link" href="${escapeHtml(unsubscribeHref)}" style="color:${colors.accent};text-decoration:underline;">Unsubscribe here</a> and we will not write again.</p>
              <p class="dm-muted" style="margin:0;font-family:${FONT_BODY};font-size:12px;line-height:18px;color:${colors.inkMuted};">${escapeHtml(input.postalAddress)}<br />${escapeHtml(BRAND.name)} &middot; <a class="dm-link" href="https://${escapeHtml(BRAND.domain)}" style="color:${colors.inkMuted};text-decoration:none;">${escapeHtml(BRAND.domain)}</a></p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
  </div>
</body>
</html>`;

  const text = [
    input.greeting,
    "",
    ...input.paragraphs.flatMap((p) => [p, ""]),
    `${input.ctaLabel}: ${ctaHref}`,
    "",
    ...input.signOffLines,
    "",
    "—",
    whyLine,
    `Unsubscribe here and we will not write again: ${unsubscribeHref}`,
    input.postalAddress,
    `${BRAND.name} · ${BRAND.domain}`,
  ].join("\n");

  return { html, text, headers: buildListUnsubscribeHeaders(input.unsubscribeUrl, input.unsubscribeMailbox ?? null) };
}
