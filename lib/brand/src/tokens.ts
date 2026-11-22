/**
 * Dreemer brand tokens — the single source of truth for color, type, shape,
 * and motion across the web app, the API server's emails and rendered
 * assets, and any future surface.
 *
 * Blue-hour album: midnight ink, silver paper and a lavender accent.
 * Legacy `coral` and `ivory` exports/CSS keys remain compatibility aliases
 * for lavender and pearl so every app, email and renderer changes together.
 * Lavender fill carries midnight text; deep lavender is used for text and
 * the logo on light surfaces. Never use the pale fill as body text.
 *  - Sea is the secondary color: links inside running text, informational
 *    states, charts. Calm and cool against the warm page.
 *  - success / warning / error carry meaning only. Each has a text value that
 *    passes 4.5:1 on ivory, a fill value, and a soft tint for backgrounds.
 *
 * `tokens.css` is generated from this file (`pnpm --filter @workspace/brand run build`).
 */

export const brand = {
  name: "Dreemer",
  wordmark: "dreemer",
  domain: "dreemer.co",
  url: "https://www.dreemer.co",
  tagline: "Let them see their day here.",
  description:
    "Personalized AI wedding galleries for your venue. Give touring couples four imagined moments, a motion reel and a way to check their date.",
} as const;

/* ---------------------------------------------------------------- color */

export const lavender = {
  50: "#F2F1FD",
  100: "#E9E7FC",
  200: "#DDD9FC",
  300: "#D3CEFB",
  400: "#CBC7FA",
  500: "#C6C4FA",
  600: "#B4AFE9",
  700: "#5351A2",
  800: "#403E84",
  900: "#302E63",
} as const;
export const coral = lavender;

export const ink = {
  50: "#F0F2F7",
  100: "#E0E5EF",
  200: "#C2CBDE",
  300: "#A6B2CA",
  400: "#7886A1",
  500: "#58647B",
  600: "#46516A",
  700: "#35405A",
  800: "#28344F",
  900: "#202A44",
} as const;

export const ivory = {
  0: "#FFFFFF",
  50: "#FCFCFE", // cards, inputs, modals
  100: "#F7F8FC", // pearl paper canvas
  200: "#E8ECF4", // silver bands, sidebars and email body
  300: "#D8DEEA", // hairlines
  400: "#BAC3D5", // strong borders
  500: "#949EB2", // disabled text, decorative only
} as const;

export const sea = {
  50: "#EEF5F4",
  100: "#D6E8E6",
  200: "#AFD1CD",
  300: "#7FB4AE",
  400: "#4F938C",
  500: "#2F7A73",
  600: "#25645E", // secondary action / links (AA on ivory)
  700: "#1E524D",
  800: "#163D39",
  900: "#0E2826",
} as const;

export const success = {
  soft: "#DCEFE2",
  fill: "#26804F",
  text: "#1E6E43", // AA on ivory
  strong: "#15502F",
} as const;

export const warning = {
  soft: "#FBECC6",
  fill: "#E2A42B",
  text: "#7A5200", // AA on ivory
  strong: "#5A3C00",
} as const;

export const error = {
  soft: "#F9DDD9",
  fill: "#C9403A",
  text: "#A82E28", // AA on ivory
  strong: "#7D1F1B",
} as const;

export const color = { lavender, coral, ink, ivory, sea, success, warning, error } as const;

/**
 * Semantic roles. Everything in the UI should reach for one of these rather
 * than a raw scale value, so a surface can be re-themed in one place.
 */
export const semantic = {
  canvas: ivory[100],
  band: ivory[200],
  surface: ivory[50],
  surfaceRaised: ivory[0],
  surfaceSunken: ivory[300],
  border: ivory[300],
  borderStrong: ivory[400],
  text: ink[900],
  textSecondary: ink[600],
  textMuted: ink[500],
  textPlaceholder: ink[500],
  textDisabled: ivory[500],
  textOnAccent: ink[900],
  textOnInk: ivory[100],
  accent: coral[500],
  accentHover: coral[600],
  accentActive: coral[600],
  accentText: coral[700],
  accentSoft: coral[50],
  secondary: sea[600],
  secondaryHover: sea[700],
  secondarySoft: sea[50],
  focusRing: coral[700],
  selectionBackground: coral[100],
  selectionText: ink[900],
  successText: success.text,
  successFill: success.fill,
  successSoft: success.soft,
  warningText: warning.text,
  warningFill: warning.fill,
  warningSoft: warning.soft,
  errorText: error.text,
  errorFill: error.fill,
  errorSoft: error.soft,
  /* dark surfaces (reversed lockup, video frames, control-plane header) */
  inkSurface: ink[900],
  inkSurfaceRaised: ink[800],
  inkBorder: ink[700],
  inkText: ivory[100],
  inkTextMuted: ink[300],
} as const;

/* ----------------------------------------------------------------- type */

/**
 * Outfit carries the wordmark's geometric construction into headings and
 * numerals; Figtree is the body and interface face — same geometric family
 * feel, better at 13–16px. Both are open-source (Google Fonts).
 */
export const font = {
  display: "'Outfit', 'Figtree', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  body: "'Figtree', 'Outfit', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
  /** Email clients can't load web fonts reliably; this stack degrades gracefully. */
  email: "'Figtree', 'Outfit', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
} as const;

export const fontImportUrl =
  "https://fonts.googleapis.com/css2?family=Outfit:wght@500;600&family=Figtree:wght@400;500;600&display=swap";

/** Modular scale, 1.25 ratio from a 16px base, in px. */
export const typeScale = {
  xs: 12,
  sm: 14,
  base: 16,
  md: 18,
  lg: 20,
  xl: 25,
  "2xl": 31,
  "3xl": 39,
  "4xl": 49,
  "5xl": 61,
} as const;

export const letterSpacing = {
  display: "-0.025em",
  body: "0",
  label: "0.08em",
} as const;

export const lineHeight = {
  display: 1.08,
  heading: 1.2,
  body: 1.6,
  compact: 1.4,
} as const;

/* ---------------------------------------------------------------- shape */

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 20,
  pill: 999,
} as const;

export const shadow = {
  sm: "0 1px 2px rgba(6, 18, 25, 0.06)",
  md: "0 4px 16px rgba(6, 18, 25, 0.08)",
  lg: "0 16px 40px rgba(6, 18, 25, 0.12)",
} as const;

export const space = {
  unit: 4,
  gutter: 24,
  pageMax: 1280,
  contentMax: 720,
} as const;

/* --------------------------------------------------------------- motion */

export const motion = {
  fast: "150ms",
  base: "220ms",
  slow: "420ms",
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

/* --------------------------------------------------------- css variables */

type Flat = Record<string, string | number>;

function flatten(prefix: string, group: Record<string, string | number>, out: Flat): void {
  for (const [key, value] of Object.entries(group)) {
    out[`${prefix}-${key}`] = value;
  }
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** Every token as a flat `--dm-*` custom-property map. */
export function cssVariables(): Record<string, string> {
  const flat: Flat = {};
  flatten("lavender", lavender, flat);
  flatten("coral", coral, flat);
  flatten("ink", ink, flat);
  flatten("ivory", ivory, flat);
  flatten("sea", sea, flat);
  flatten("success", success, flat);
  flatten("warning", warning, flat);
  flatten("error", error, flat);
  for (const [key, value] of Object.entries(semantic)) flat[kebab(key)] = value;
  for (const [key, value] of Object.entries(font)) flat[`font-${key}`] = value;
  for (const [key, value] of Object.entries(typeScale)) flat[`text-${key}`] = `${value}px`;
  for (const [key, value] of Object.entries(radius)) flat[`radius-${key}`] = `${value}px`;
  for (const [key, value] of Object.entries(shadow)) flat[`shadow-${key}`] = value;
  for (const [key, value] of Object.entries(motion)) flat[`motion-${kebab(key)}`] = value;
  flat["tracking-display"] = letterSpacing.display;
  flat["tracking-label"] = letterSpacing.label;
  flat["leading-display"] = String(lineHeight.display);
  flat["leading-heading"] = String(lineHeight.heading);
  flat["leading-body"] = String(lineHeight.body);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(flat)) out[`--dm-${key}`] = String(value);
  return out;
}

/** `:root { … }` block for tokens.css. */
export function cssText(): string {
  const lines = Object.entries(cssVariables()).map(([k, v]) => `  ${k}: ${v};`);
  return `/* Generated from lib/brand/src/tokens.ts — do not edit by hand. */\n:root {\n${lines.join("\n")}\n}\n`;
}
