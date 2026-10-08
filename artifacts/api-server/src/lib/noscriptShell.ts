import { font, semantic } from "@workspace/brand";
import type { PublicConfig } from "./publicConfig.js";

/*
 * SPA shell rendering helpers (funnel-ux.md 2.3-2.4). Everything here is pure
 * string work so it can be unit tested without Express or a database:
 *
 * - renderNoscriptShell: the <noscript> pitch (prices, the sign-up anchor) or
 *   the gallery notice for /v/ paths. The ask and the prices are in the HTML,
 *   so the page still converts with JavaScript disabled; Clerk itself needs JS.
 * - galleryOpenGraphTags: absolute og:/twitter: tags for a shared gallery.
 * - renderShellHtml: injects head tags, swaps the shell's default meta set for
 *   a page-specific one, flips robots to noindex, and inserts the noscript
 *   block right after <div id="root">.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Whole currency units, no decimals: "$129", "€279". */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

/** Paths whose shell must carry noindex (private galleries, couple flow, owner surfaces). */
export function isNoindexPath(path: string): boolean {
  const normalized = path.split("?")[0] ?? "";
  return (
    normalized.startsWith("/v/") ||
    normalized.startsWith("/preview/") ||
    normalized === "/dashboard" ||
    normalized.startsWith("/dashboard/") ||
    normalized === "/control" ||
    normalized.startsWith("/control/") ||
    normalized.startsWith("/claim/")
  );
}

function isGalleryPath(path: string): boolean {
  return path.startsWith("/v/");
}

const NOSCRIPT_STYLE = `
.dm-noscript{box-sizing:border-box;max-width:40rem;margin:0 auto;padding:48px 20px 64px;background:${semantic.canvas};color:${semantic.text};font-family:${font.body};line-height:1.5}
.dm-noscript img{display:block;height:36px;width:auto;margin-bottom:28px}
.dm-noscript h1{font-family:${font.display};font-size:2rem;line-height:1.1;letter-spacing:-0.01em;margin:0 0 16px;color:${semantic.text}}
.dm-noscript p{margin:0 0 16px;font-size:1.0625rem;color:${semantic.textSecondary}}
.dm-noscript ul{list-style:none;margin:0 0 24px;padding:16px 20px;border:1px solid ${semantic.border};border-radius:12px;background:${semantic.surface}}
.dm-noscript li{margin:0;padding:6px 0;color:${semantic.text}}
.dm-noscript .dm-label{font-size:0.8125rem;letter-spacing:0.04em;text-transform:uppercase;color:${semantic.textMuted}}
.dm-noscript a{color:${semantic.accentText};text-decoration:underline;text-underline-offset:3px}
.dm-noscript .dm-cta{display:inline-block;margin:0 16px 12px 0;padding:12px 18px;border-radius:999px;background:${semantic.accent};color:${semantic.textOnAccent};text-decoration:none;font-weight:600}
.dm-noscript .dm-foot{font-size:0.875rem;color:${semantic.textMuted}}
`.trim();

/**
 * The <noscript> block for the SPA shell. Plain anchors and literal prices so
 * a venue owner without JavaScript still sees the ask; a shared gallery path
 * gets a notice instead of the pitch.
 */
export function renderNoscriptShell(config: PublicConfig, path: string): string {
  const parts: string[] = [`<noscript><style>${NOSCRIPT_STYLE}</style><div class="dm-noscript">`];
  parts.push(`<img src="/dreemer-lockup-email.png" alt="Dreemer" width="160" height="36" />`);

  if (isGalleryPath(path)) {
    parts.push(
      `<p>This gallery needs JavaScript to show its images and reel. Open the link in a current browser, or ask the venue to email you the images.</p>`,
    );
  } else {
    const { pricing, trial } = config;
    const money = (amount: number) => escapeHtml(formatMoney(amount, pricing.currency));
    parts.push(`<h1>Turn tours into bookings.</h1>`);
    parts.push(
      `<p>A couple tours your venue. Before they leave, they see realistic images and a short reel of themselves getting married there, with your date link attached.</p>`,
    );
    const priceItems = [
      `<li>Starter ${money(pricing.starterMonthly)} a month, ${pricing.starterCredits} galleries</li>`,
      `<li>Growth ${money(pricing.growthMonthly)} a month, ${pricing.growthCredits} galleries</li>`,
      `<li>Credit pack ${money(pricing.creditPack)}, ${pricing.creditPackCredits} galleries</li>`,
      pricing.label ? `<li class="dm-label">${escapeHtml(pricing.label)}</li>` : "",
    ].join("");
    parts.push(`<ul>${priceItems}</ul>`);
    const trialLine =
      trial.credits === 5
        ? "Start free — five galleries, no card"
        : `Start free — ${trial.credits} galleries, no card`;
    parts.push(`<a class="dm-cta" href="/create-venue">${escapeHtml(trialLine)}</a>`);
    if (config.contactEmail) {
      const mail = escapeHtml(config.contactEmail);
      parts.push(`<a href="mailto:${mail}">Email us</a>`);
    }
    parts.push(
      `<p class="dm-foot">Signing in to the venue dashboard needs JavaScript; the rest of this page does not.</p>`,
    );
  }

  parts.push(`</div></noscript>`);
  return parts.join("");
}

export interface GalleryOpenGraphInput {
  title: string;
  description: string;
  pageUrl: string;
  imageUrl: string;
  /** Known only for the static fallback image; omitted when unknown rather than guessed. */
  imageWidth?: number;
  imageHeight?: number;
}

/** Absolute-URL Open Graph + Twitter tags for a shared gallery page. */
export function galleryOpenGraphTags(input: GalleryOpenGraphInput): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const pageUrl = escapeHtml(input.pageUrl);
  const imageUrl = escapeHtml(input.imageUrl);
  const dimensions =
    input.imageWidth && input.imageHeight
      ? `<meta property="og:image:width" content="${input.imageWidth}" />` +
        `<meta property="og:image:height" content="${input.imageHeight}" />`
      : "";
  return (
    `<title>${title}</title>` +
    `<meta name="description" content="${description}" />` +
    `<meta property="og:site_name" content="Dreemer" />` +
    `<meta property="og:type" content="website" />` +
    `<meta property="og:url" content="${pageUrl}" />` +
    `<meta property="og:title" content="${title}" />` +
    `<meta property="og:description" content="${description}" />` +
    `<meta property="og:image" content="${imageUrl}" />` +
    dimensions +
    `<meta name="twitter:card" content="summary_large_image" />` +
    `<meta name="twitter:title" content="${title}" />` +
    `<meta name="twitter:description" content="${description}" />` +
    `<meta name="twitter:image" content="${imageUrl}" />`
  );
}

export interface ShellRenderOptions {
  /** The built index.html. */
  html: string;
  /** Tags appended right after <head> (Clerk key, public config, preloads). */
  headTags?: string;
  /**
   * Page-specific title/description/og/twitter tags. When present, the shell's
   * own copies of those tags are removed first so crawlers see one set.
   */
  replaceMetaWith?: string;
  /** Flip the shell's robots meta to noindex, nofollow. */
  noindex?: boolean;
  /** Markup inserted directly after <div id="root"></div>. */
  noscript?: string;
}

const SHELL_META_PATTERN =
  /<title>[\s\S]*?<\/title>\s*|<meta\s+(?:name="(?:description|twitter:[a-z:]+)"|property="og:[a-z:_]+")[^>]*\/?>\s*/gi;
const ROBOTS_META_PATTERN = /<meta\s+name="robots"[^>]*\/?>/i;
const ROOT_DIV = '<div id="root"></div>';

/** Compose the final shell HTML. Pure; the caller sets headers. */
export function renderShellHtml(options: ShellRenderOptions): string {
  let html = options.html;

  if (options.replaceMetaWith) {
    html = html.replace(SHELL_META_PATTERN, "");
  }
  if (options.noindex) {
    const noindexTag = `<meta name="robots" content="noindex, nofollow" />`;
    html = ROBOTS_META_PATTERN.test(html)
      ? html.replace(ROBOTS_META_PATTERN, noindexTag)
      : html.replace("<head>", `<head>${noindexTag}`);
  }

  const headTags = `${options.headTags ?? ""}${options.replaceMetaWith ?? ""}`;
  if (headTags) {
    html = html.replace("<head>", `<head>${headTags}`);
  }
  if (options.noscript) {
    html = html.includes(ROOT_DIV)
      ? html.replace(ROOT_DIV, `${ROOT_DIV}${options.noscript}`)
      : html.replace("<body>", `<body>${options.noscript}`);
  }
  return html;
}
