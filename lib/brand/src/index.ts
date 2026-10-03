/**
 * Dreemer brand tokens — the single shared source of truth for the product
 * name, voice, palette, and type stacks across every surface that is not the
 * web app's own stylesheet (transactional and outreach email, PDF exports,
 * operator tooling, generated social cards).
 *
 * The web app keeps its tokens in `artifacts/wedding-app/src/index.css`; the
 * hex values here are derived from that garden palette so both surfaces read
 * as one brand. When the rebrand lands, update both in the same change.
 *
 * Nothing here may import runtime dependencies: this module is consumed by the
 * API server bundle, the Vite app, and node:test suites alike.
 */

export const BRAND = {
  /** Product name as written in running text and sign-offs. */
  name: "Dreemer",
  /** Lowercase wordmark used in logotype positions. */
  wordmark: "dreemer",
  domain: "dreemer.co",
  /** The one-line promise every marketing surface is tested against. */
  tagline: "Turn tours into bookings.",
  /** Plain-words description for footers and first-touch copy. */
  description:
    "Dreemer gives wedding venues a personal AI preview of a couple's day in their own spaces, sent after the tour so the booking conversation keeps going.",
} as const;

/**
 * Palette roles. Light values mirror the web app's garden palette; dark
 * values are tuned for email clients' forced dark modes (Gmail, Apple Mail,
 * Outlook) where they are applied through `prefers-color-scheme` and the
 * `[data-ogsc]` Outlook selector.
 */
export const BRAND_COLORS = {
  light: {
    /** Page background behind the email card. */
    canvas: "#faf9f5",
    /** Card / content surface. */
    surface: "#ffffff",
    /** Primary text. */
    ink: "#24332c",
    /** Secondary text, captions, footers. */
    inkMuted: "#5f6d65",
    /** Brand green — buttons, links, the viewfinder mark. */
    accent: "#325747",
    accentHover: "#223f33",
    /** Text placed on the accent. */
    onAccent: "#ffffff",
    /** Hairlines and dividers. */
    border: "#d3d4c9",
    /** Soft tinted panel (quotes, image captions). */
    soft: "#ebece4",
  },
  dark: {
    canvas: "#141917",
    surface: "#1c2320",
    ink: "#eef1ec",
    inkMuted: "#a7b2aa",
    accent: "#8fb8a1",
    accentHover: "#a9cbb8",
    onAccent: "#10261b",
    border: "#2f3a35",
    soft: "#232c28",
  },
} as const;

export type BrandScheme = keyof typeof BRAND_COLORS;

/**
 * Type stacks. The web app loads DM Sans + DM Serif Display; email clients
 * cannot be relied on to load web fonts, so the stacks here fall back to the
 * closest system faces and the app may layer the web fonts on top.
 */
export const BRAND_TYPE = {
  display: `"DM Serif Display", Georgia, "Times New Roman", serif`,
  body: `"DM Sans", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
  mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
  /** Google Fonts stylesheet for surfaces that may load web fonts. */
  webFontsHref:
    "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display:ital@0;1&display=swap",
} as const;

export const BRAND_RADIUS = {
  sm: 3,
  md: 6,
  lg: 10,
  xl: 16,
} as const;

/**
 * Email-specific layout tokens. 600px is the width every major client renders
 * without horizontal scrolling; images are stored at 2x for retina displays.
 */
export const BRAND_EMAIL = {
  contentWidth: 600,
  gutter: 32,
  heroImageWidth: 1200,
  heroImageHeight: 750,
  secondaryImageWidth: 600,
  secondaryImageHeight: 450,
  /** JPEG quality for stored outreach images (mozjpeg-style tradeoff). */
  imageQuality: 82,
} as const;

/**
 * Inline SVG of the viewfinder mark, color-agnostic (uses currentColor) so it
 * can be embedded in HTML email headers without an external image request.
 */
export function brandMarkSvg(color: string, size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 10 V6.5 A2.5 2.5 0 0 1 6.5 4 H10"/><path d="M22 4 H25.5 A2.5 2.5 0 0 1 28 6.5 V10"/><path d="M28 22 V25.5 A2.5 2.5 0 0 1 25.5 28 H22"/><path d="M10 28 H6.5 A2.5 2.5 0 0 1 4 25.5 V22"/><circle cx="16" cy="16" r="4.6" fill="${color}" stroke="none"/></svg>`;
}
