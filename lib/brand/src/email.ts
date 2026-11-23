/**
 * Flat brand constants for surfaces that cannot consume CSS variables: the
 * outreach email studio, transactional email, the public unsubscribe page,
 * and PDF or social exports. Every value here is derived from `tokens.ts`;
 * nothing is hand-tuned, so the two can never drift.
 *
 * The `dark` scheme is for email clients' forced dark modes (Gmail, Apple
 * Mail, Outlook's `[data-ogsc]`) and reuses the ink surface roles.
 */
import { ICON_HEIGHT, ICON_SIZE, logoAssetUrl } from "./logo.js";
import { relativeLuminance } from "./contrast.js";
import { brand, coral, font, fontImportUrl, ink, ivory, radius, semantic } from "./tokens.js";

export const BRAND = {
  /** Product name as written in running text and sign-offs. */
  name: brand.name,
  /** Uppercase wordmark used in logotype positions. */
  wordmark: brand.wordmark,
  domain: brand.domain,
  /** The one-line promise every marketing surface is tested against. */
  tagline: brand.tagline,
  /** Plain-words description for footers and first-touch copy. */
  description: brand.description,
} as const;

/**
 * Palette roles for email. `accent` is used for both links and button fills,
 * so it is deep orange (legacy key `coral.700`) with white on top;
 * on dark it is signal orange (`coral.400`) with ink on top. Contrast is tested.
 */
export const BRAND_COLORS = {
  light: {
    /** Page background behind the email card. */
    canvas: semantic.band,
    /** Card / content surface. */
    surface: semantic.surface,
    /** Primary text. */
    ink: semantic.text,
    /** Secondary text, captions, footers. */
    inkMuted: semantic.textMuted,
    /** Links, buttons, the mark. */
    accent: coral[700],
    accentHover: coral[800],
    /** Text placed on the accent. */
    onAccent: ivory[0],
    /** Hairlines and dividers. */
    border: semantic.border,
    /** Soft tinted panel (quotes, image captions). */
    soft: ivory[200],
  },
  dark: {
    canvas: ink[900],
    surface: ink[800],
    ink: ivory[100],
    inkMuted: ink[300],
    accent: coral[400],
    accentHover: coral[300],
    onAccent: ink[900],
    border: ink[700],
    soft: ink[700],
  },
} as const;

export type BrandScheme = keyof typeof BRAND_COLORS;

/**
 * Type stacks. Email clients cannot be relied on to load web fonts, so the
 * stacks fall back to the closest system faces; surfaces that can load web
 * fonts use `webFontsHref`.
 */
export const BRAND_TYPE = {
  display: font.display,
  body: font.body,
  mono: font.mono,
  /** Google Fonts stylesheet for surfaces that may load web fonts. */
  webFontsHref: fontImportUrl,
} as const;

export const BRAND_RADIUS = {
  sm: radius.sm,
  md: radius.md,
  lg: radius.lg,
  xl: radius.xl,
} as const;

/**
 * Email-specific layout tokens. 600px is the width every major client renders
 * without horizontal scrolling; images are stored at 2x for retina displays.
 */
export const BRAND_EMAIL = {
  contentWidth: 600,
  gutter: 32,
  heroImageWidth: 1200,
  /** JPEG quality for stored outreach images (mozjpeg-style tradeoff). */
  imageQuality: 82,
} as const;

/**
 * Historical function name retained for callers. Returns an email-compatible
 * PNG image of the actual generated mark (not an SVG or a replacement drawing).
 */
export function brandMarkSvg(color: string, size = 20): string {
  const tone = relativeLuminance(color) > 0.4 ? "reversed" : "ink";
  return `<img src="${brand.url}${logoAssetUrl("mark", tone)}" width="${size}" height="${Math.round(size * ICON_HEIGHT / ICON_SIZE)}" alt="" style="display:block;border:0;"/>`;
}
