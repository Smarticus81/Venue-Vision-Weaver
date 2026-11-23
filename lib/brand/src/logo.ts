/** Canonical OpenAI-generated artwork. Never substitute hand-drawn paths or live text. */
import { ink, ivory } from "./tokens.js";
export type LogoVariant = "color" | "ink" | "reversed";
export type LogoPart = "lockup" | "mark" | "wordmark";
export const LOCKUP_WIDTH = 2069;
export const LOCKUP_HEIGHT = 450;
export const WORDMARK_WIDTH = 1547;
export const WORDMARK_HEIGHT = 307;
export const ICON_SIZE = 485;
export const ICON_HEIGHT = 450;
export const LOGO_DIMENSIONS = { lockup: [LOCKUP_WIDTH, LOCKUP_HEIGHT], mark: [ICON_SIZE, ICON_HEIGHT], wordmark: [WORDMARK_WIDTH, WORDMARK_HEIGHT] } as const;
/** URL-only exports keep raster bytes out of client JavaScript. */
export function logoAssetUrl(part: LogoPart = "lockup", variant: LogoVariant = "ink") {
  return `/brand/dreemer-${part}-${variant === "reversed" ? "reversed" : "ink"}.png`;
}
export function logoColors(variant: LogoVariant) {
  const color = variant === "reversed" ? ivory[0] : ink[900];
  return { mark: color, line: color, word: color, background: null };
}
export type LogoSvgOptions = { padding?: number; imageHref?: string };
function escapeAttribute(value: string) { return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
function artworkSvg(part: LogoPart, variant: LogoVariant, options: LogoSvgOptions = {}) {
  const [width, height] = LOGO_DIMENSIONS[part];
  const pad = options.padding ?? 0;
  const href = escapeAttribute(options.imageHref ?? logoAssetUrl(part, variant));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}" role="img" aria-label="Dreemer"><image width="${width}" height="${height}" xlink:href="${href}"/></svg>\n`;
}
export function iconSvg(variant: LogoVariant = "ink", options: LogoSvgOptions = {}) { return artworkSvg("mark", variant, options); }
export function wordmarkSvg(variant: LogoVariant = "ink", options: LogoSvgOptions = {}) { return artworkSvg("wordmark", variant, options); }
export function lockupSvg(variant: LogoVariant = "ink", options: LogoSvgOptions = {}) { return artworkSvg("lockup", variant, options); }
export function tileSvg(options: { size?: number; variant?: "light" | "dark"; simplified?: boolean; rounded?: boolean; inset?: number; imageHref?: string } = {}) {
  const size = options.size ?? 512;
  const dark = options.variant !== "light";
  const inset = (options.inset ?? 12) * size / 100;
  const width = size - 2 * inset;
  const height = width * ICON_HEIGHT / ICON_SIZE;
  const href = escapeAttribute(options.imageHref ?? logoAssetUrl("mark", dark ? "reversed" : "ink"));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${size} ${size}" aria-label="Dreemer"><rect width="${size}" height="${size}" rx="${options.rounded === false ? 0 : size * .06}" fill="${dark ? ink[900] : ivory[0]}"/><image x="${inset}" y="${(size - height) / 2}" width="${width}" height="${height}" xlink:href="${href}"/></svg>\n`;
}
/** @deprecated Path-based artwork was retired. Retained for source compatibility only. */
export const ICON_BODY_PATH = "";
export const ICON_LINE_PATHS: readonly string[] = [];
export const ICON_SPARK_PATHS: readonly string[] = [];
export const WORDMARK_PATHS: readonly string[] = [];
export const WORDMARK_OFFSETS: readonly number[] = [];
export const WORDMARK_STROKE = 0;
export const ICON_LINE_STROKE = 0;
export const ICON_SPARK_STROKE = 0;
export const LOCKUP_GAP = 37;
export const LOCKUP_ICON_SCALE = 1;
export const LOCKUP_ICON_OFFSET_Y = 0;
export const LOCKUP_ICON_WIDTH = ICON_SIZE;
/** @deprecated Use wordmarkSvg with a data URI for offline rasterization. */
export function wordmarkGroup(_fill: string) { return wordmarkSvg(); }
