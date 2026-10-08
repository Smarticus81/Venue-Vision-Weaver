import { semantic, font } from "@workspace/brand";

/**
 * The printable tour card: an A6-proportioned card the coordinator hands to
 * the couple at the end of the tour. Pure SVG string building so it can be
 * unit-tested; the component rasterises it to PNG for download.
 */

export const TOUR_CARD_WIDTH = 1240; // A6 at 300dpi ≈ 1240 × 1748
export const TOUR_CARD_HEIGHT = 1748;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Keeps a venue name to one or two lines at the card's display size. */
export function wrapTitle(name: string, maxChars = 18): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && current) lines.push(current);
  if (lines.length === 2 && words.join(" ").length > lines.join(" ").length) {
    lines[1] = `${lines[1].slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return lines.length ? lines : [name.trim().slice(0, maxChars)];
}

export interface TourCardInput {
  venueName: string;
  /** The couple link printed under the code, e.g. dreemer.co/preview/willow */
  url: string;
  /** Inner markup of a QR <svg> (paths), already sized to a square viewBox. */
  qrSvg: string;
  /** The QR svg's viewBox size so it can be scaled into the slot. */
  qrViewBox: number;
}

export function tourCardFileName(slug: string): string {
  const safe = slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${safe || "venue"}-tour-card.png`;
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function buildTourCardSvg(input: TourCardInput): string {
  const W = TOUR_CARD_WIDTH;
  const H = TOUR_CARD_HEIGHT;
  const title = wrapTitle(input.venueName);
  const titleY = 300;
  const qrSize = 760;
  const qrX = (W - qrSize) / 2;
  const qrY = 560;
  const scale = qrSize / Math.max(1, input.qrViewBox);
  const display = escapeXml(displayUrl(input.url));
  const fontDisplay = escapeXml(font.display);
  const fontBody = escapeXml(font.body);
  const titleLines = title
    .map(
      (line, i) =>
        `<text x="${W / 2}" y="${titleY + i * 92}" text-anchor="middle" font-family="${fontDisplay}" font-size="78" font-weight="600" fill="${semantic.text}" letter-spacing="-1.5">${escapeXml(line)}</text>`,
    )
    .join("");
  const afterTitle = titleY + (title.length - 1) * 92;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tour card for ${escapeXml(input.venueName)}">`,
    `<rect width="${W}" height="${H}" fill="${semantic.band}"/>`,
    `<rect x="60" y="60" width="${W - 120}" height="${H - 120}" rx="28" fill="${semantic.surface}" stroke="${semantic.border}" stroke-width="3"/>`,
    `<text x="${W / 2}" y="190" text-anchor="middle" font-family="${fontBody}" font-size="30" font-weight="600" fill="${semantic.accentText}" letter-spacing="4">SEE YOURSELVES MARRIED HERE</text>`,
    titleLines,
    `<text x="${W / 2}" y="${afterTitle + 90}" text-anchor="middle" font-family="${fontBody}" font-size="36" fill="${semantic.textSecondary}">Scan, add two or three photos of you both,</text>`,
    `<text x="${W / 2}" y="${afterTitle + 140}" text-anchor="middle" font-family="${fontBody}" font-size="36" fill="${semantic.textSecondary}">and your gallery arrives by email.</text>`,
    `<rect x="${qrX - 40}" y="${qrY - 40}" width="${qrSize + 80}" height="${qrSize + 80}" rx="24" fill="${semantic.surfaceRaised}" stroke="${semantic.border}" stroke-width="3"/>`,
    `<g transform="translate(${qrX} ${qrY}) scale(${scale.toFixed(4)})">${input.qrSvg}</g>`,
    `<text x="${W / 2}" y="${qrY + qrSize + 130}" text-anchor="middle" font-family="${fontBody}" font-size="34" font-weight="600" fill="${semantic.text}">${display}</text>`,
    `<text x="${W / 2}" y="${H - 170}" text-anchor="middle" font-family="${fontBody}" font-size="26" fill="${semantic.textMuted}">Images are an AI preview, imagined at ${escapeXml(input.venueName)}. Private link, yours to keep.</text>`,
    `<text x="${W / 2}" y="${H - 120}" text-anchor="middle" font-family="${fontBody}" font-size="26" fill="${semantic.textMuted}">Made with Dreemer</text>`,
    `</svg>`,
  ].join("");
}

/** Pulls the inner markup and viewBox size out of a qrcode library SVG string. */
export function extractQrSvg(svg: string): { inner: string; viewBox: number } {
  const viewBoxMatch = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  const viewBox = viewBoxMatch ? Number(viewBoxMatch[1]) : 0;
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return { inner, viewBox: Number.isFinite(viewBox) && viewBox > 0 ? viewBox : 1 };
}
