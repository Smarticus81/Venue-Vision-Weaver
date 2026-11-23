/**
 * Dreemer brand tokens — the single source of truth for color, type, shape,
 * and motion across the web app, the API server's emails and rendered
 * assets, and any future surface.
 *
 * Photo-led identity: neutral ink, white surfaces, clear upright typography.
 * Legacy scale identifiers are compatibility aliases, not retained colors.
 * Accent fills use white text; light cyan is reserved for dark surfaces.
 * Status colors retain their semantic meaning and contrast requirements.
 *
 * `tokens.css` is generated from this file (`pnpm --filter @workspace/brand run build`).
 */

export const brand = {
  name: "Dreemer",
  wordmark: "DREEMER",
  domain: "dreemer.co",
  url: "https://www.dreemer.co",
  tagline: "Turn tours into bookings.",
  description:
    "Personalized previews and private galleries for venue sales. Show couples themselves at your venue, then track views, shares and date enquiries.",
} as const;

/* ---------------------------------------------------------------- color */

export const prism = {
  50: "#EDF3FF",
  100: "#DCE9FF",
  200: "#C0DAF9",
  300: "#A7CDF7",
  400: "#92C9F0",
  500: "#2A4FDC",
  600: "#2144BF",
  700: "#1639B6",
  800: "#15338D",
  900: "#112659",
} as const;
// Legacy identifiers are API compatibility only; no legacy palette is retained.
export const orange = prism;
export const lavender = prism;
export const coral = prism;

export const ink = {
  50: "#F2F2F4",
  100: "#E4E4E8",
  200: "#CFCFD6",
  300: "#B7B8C0",
  400: "#80828B",
  500: "#5D6068",
  600: "#454750",
  700: "#34363D",
  800: "#25262D",
  900: "#101116",
} as const;

export const ivory = {
  0: "#FFFFFF",
  50: "#FAFAFB",
  100: "#F5F5F7",
  200: "#EEEEF1",
  300: "#D9DADE",
  400: "#B0B2BA",
  500: "#797C86",
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

export const color = { prism, orange, lavender, coral, ink, ivory, sea, success, warning, error } as const;

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
  textOnAccent: ivory[0],
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
  lensGlow: "#CBEAF0",
  lensHaze: "#E0EDF2",
  lensLine: "#CBDFE5",
} as const;

/* ----------------------------------------------------------------- type */

/**
 * Upright Manrope across display and interface; logo lettering is generated artwork.
 */
export const font = {
  display: "'Manrope', ui-sans-serif, system-ui, sans-serif",
  body: "'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
  /** Email clients can't load web fonts reliably; this stack degrades gracefully. */
  email: "'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
} as const;

export const fontImportUrl =
  "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap";

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
  display: "-0.015em",
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
  xs: 2,
  sm: 3,
  md: 4,
  lg: 6,
  xl: 8,
  pill: 4,
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
  flatten("prism", prism, flat);
  flatten("orange", orange, flat);
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
