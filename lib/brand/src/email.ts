/**
 * Flat brand constants for surfaces that cannot consume CSS variables: the
 * outreach email studio, transactional email, the public unsubscribe page,
 * and PDF or social exports. Every value here is derived from `tokens.ts`;
 * nothing is hand-tuned, so the two can never drift.
 *
 * The `dark` scheme is for email clients' forced dark modes (Gmail, Apple
 * Mail, Outlook's `[data-ogsc]`) and reuses the ink surface roles.
 */
import {
  ICON_BODY_PATH,
  ICON_LINE_PATHS,
  ICON_LINE_STROKE,
  ICON_SIZE,
  ICON_SPARK_PATHS,
  ICON_SPARK_STROKE,
} from "./logo.js";
import { brand, coral, font, fontImportUrl, ink, ivory, radius, semantic } from "./tokens.js";

export const BRAND = {
  /** Product name as written in running text and sign-offs. */
  name: brand.name,
  /** Lowercase wordmark used in logotype positions. */
  wordmark: brand.wordmark,
  domain: brand.domain,
  /** The one-line promise every marketing surface is tested against. */
  tagline: brand.tagline,
  /** Plain-words description for footers and first-touch copy. */
  description: brand.description,
} as const;

/**
 * Palette roles for email. `accent` is used for both links and button fills,
 * so it is the text-safe coral (`coral.700`, 4.6:1 on brand ivory) with white
 * on top (5.7:1); on dark it is `coral.400` with ink on top (8:1).
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
 * Inline SVG of the mark in one color, for HTML email headers where an
 * external image request is unwelcome. Same geometry as every other logo file.
 */
export function brandMarkSvg(color: string, size = 20): string {
  const lines = ICON_LINE_PATHS.map((d) => `<path d="${d}"/>`).join("");
  const spark = ICON_SPARK_PATHS.map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" aria-hidden="true"><path d="${ICON_BODY_PATH}" fill="${color}"/><g fill="none" stroke="${color}" stroke-width="${ICON_LINE_STROKE}" stroke-linecap="round">${lines}</g><g fill="none" stroke="${color}" stroke-width="${ICON_SPARK_STROKE}" stroke-linecap="round">${spark}</g></svg>`;
}
