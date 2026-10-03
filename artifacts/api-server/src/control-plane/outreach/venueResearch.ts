import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { BRAND_EMAIL } from "@workspace/brand";
import { logger } from "../../lib/logger.js";
import { ObjectStorageService } from "../../lib/objectStorage.js";
import { completeJson, controlPlaneAiConfigured } from "../grok.js";

/**
 * Venue research for the outreach studio.
 *
 * Given a prospect's own public website we pull the facts an email can
 * truthfully mention (name, location, named spaces, style, public capacity)
 * and copies of the venue's own photos (og:image, hero, gallery), recording
 * where every one came from. Everything network-facing goes through
 * injectable deps so the selection logic is unit-testable without the web,
 * sharp, or storage.
 */

export interface VenueFacts {
  name: string | null;
  location: string | null;
  spaces: string[];
  style: string | null;
  capacity: number | null;
  summary: string | null;
}

export interface ResearchImage {
  objectKey: string;
  sourceUrl: string;
  pageUrl: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  altText: string;
  score: number;
  selected: boolean;
}

export type ResearchStatus = "ok" | "no_images" | "fetch_failed";

export interface ResearchResult {
  status: ResearchStatus;
  sourceUrls: string[];
  facts: VenueFacts;
  warnings: string[];
  images: ResearchImage[];
  /** Plain-text excerpts the copywriter may quote from (never shown to prospects). */
  pageText: string;
}

export interface FetchedPage {
  finalUrl: string;
  html: string;
}

export interface ProcessedImage {
  width: number;
  height: number;
  /** Resized JPEG ready for storage. */
  buffer: Buffer;
  contentType: string;
  /** Coarse perceptual hash for de-duplication (hex). */
  hash: string;
}

export interface ResearchDeps {
  fetchPage(url: string): Promise<FetchedPage | null>;
  fetchBinary(url: string): Promise<{ buffer: Buffer; contentType: string | null } | null>;
  processImage(buffer: Buffer): Promise<ProcessedImage | null>;
  store(relativePath: string, buffer: Buffer, contentType: string): Promise<string>;
  refineFacts?(input: {
    heuristic: VenueFacts;
    pageText: string;
    prospectName: string;
  }): Promise<VenueFacts | null>;
}

export interface ResearchInput {
  prospectId: number;
  name: string;
  website: string | null;
  region: string | null;
}

export const RESEARCH_LIMITS = {
  maxPages: 4,
  maxImageDownloads: 10,
  maxStoredImages: 6,
  maxSelectedImages: 3,
  minWidth: 700,
  minHeight: 400,
  maxHtmlBytes: 3 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  fetchTimeoutMs: 12_000,
} as const;

/* ————— Tiny HTML helpers (regex-based; we only need tags, attrs, and text) ————— */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<[a-zA-Z0-9:-]+/, "").replace(/\/?>$/, "");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const name = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!(name in attrs)) attrs[name] = decodeEntities(value);
  }
  return attrs;
}

function findTags(html: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  return html.match(re) ?? [];
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function textBetween(html: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const text = stripTags(match[1] ?? "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

export function resolveUrl(base: string, href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("javascript:")) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function pickLargestFromSrcset(srcset: string | undefined): string | null {
  if (!srcset) return null;
  let best: { url: string; size: number } | null = null;
  for (const part of srcset.split(",")) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = descriptor ? parseFloat(descriptor) || 0 : 0;
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url ?? null;
}

/* ————— SSRF-safe fetching ————— */

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("::ffff:")
  );
}

export function hostLooksPrivate(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  const version = isIP(host);
  if (version === 4) return isPrivateIpv4(host);
  if (version === 6) return isPrivateIpv6(host);
  return false;
}

/** Only public http(s) hosts; resolves DNS and refuses private ranges. */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing non-http URL ${rawUrl}`);
  }
  if (hostLooksPrivate(url.hostname)) {
    throw new Error(`Refusing private host ${url.hostname}`);
  }
  if (!isIP(url.hostname)) {
    const addresses = await dnsLookup(url.hostname, { all: true }).catch(() => []);
    if (addresses.length === 0) throw new Error(`Could not resolve ${url.hostname}`);
    for (const address of addresses) {
      if (hostLooksPrivate(address.address)) {
        throw new Error(`Refusing ${url.hostname}: resolves to a private address`);
      }
    }
  }
  return url;
}

const USER_AGENT = "Mozilla/5.0 (compatible; DreemerResearch/1.0; +https://dreemer.co)";

async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function safeFetch(
  rawUrl: string,
  accept: string,
  maxBytes: number,
): Promise<{ finalUrl: string; buffer: Buffer; contentType: string | null } | null> {
  let current = rawUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    const url = await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESEARCH_LIMITS.fetchTimeoutMs);
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: accept },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) return null;
      const buffer = await readCapped(response, maxBytes);
      if (!buffer) return null;
      return { finalUrl: url.toString(), buffer, contentType: response.headers.get("content-type") };
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/* ————— Candidate discovery ————— */

interface ImageCandidate {
  url: string;
  pageUrl: string;
  score: number;
  alt: string | null;
}

const SKIP_URL = /logo|icon|favicon|sprite|badge|avatar|pixel|tracking|facebook|instagram|twitter|pinterest|tiktok|youtube|weddingwire|theknot|zola|award|button|arrow|spinner|placeholder|blank\.|\.svg|\.gif|\.ico/i;
const HERO_HINT = /hero|banner|slider|slide|carousel|gallery|featured|cover|masthead|header-image|background|splash|jumbotron/i;
const LOGO_HINT = /logo|icon|brand|sponsor|partner|badge/i;

export function collectImageCandidates(html: string, pageUrl: string): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const seen = new Set<string>();
  const push = (href: string | undefined, score: number, alt: string | null) => {
    const url = resolveUrl(pageUrl, href);
    if (!url || seen.has(url) || SKIP_URL.test(url)) return;
    seen.add(url);
    candidates.push({ url, pageUrl, score, alt });
  };

  for (const tag of findTags(html, "meta")) {
    const attrs = parseAttrs(tag);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key === "og:image" || key === "og:image:secure_url" || key === "og:image:url") {
      push(attrs.content, 60, null);
    } else if (key === "twitter:image" || key === "twitter:image:src") {
      push(attrs.content, 50, null);
    }
  }
  for (const tag of findTags(html, "link")) {
    const attrs = parseAttrs(tag);
    if ((attrs.rel ?? "").toLowerCase() === "image_src") push(attrs.href, 45, null);
  }
  for (const block of html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []) {
    const inner = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    for (const match of inner.matchAll(/"image"\s*:\s*(\[[^\]]*\]|"[^"]+"|\{[^}]*\})/g)) {
      const value = match[1] ?? "";
      for (const url of value.matchAll(/https?:\/\/[^"\s]+/g)) push(url[0], 40, null);
    }
  }

  findTags(html, "img").forEach((tag, index) => {
    const attrs = parseAttrs(tag);
    const alt = attrs.alt?.trim() || null;
    if (alt && LOGO_HINT.test(alt)) return;
    const hintSource = `${attrs.class ?? ""} ${attrs.id ?? ""} ${attrs.src ?? ""}`;
    if (LOGO_HINT.test(`${attrs.class ?? ""} ${attrs.id ?? ""}`)) return;
    const declaredWidth = parseInt(attrs.width ?? "", 10);
    const declaredHeight = parseInt(attrs.height ?? "", 10);
    if ((declaredWidth && declaredWidth < 300) || (declaredHeight && declaredHeight < 200)) return;
    let score = 30 - Math.min(index, 20);
    if (HERO_HINT.test(hintSource)) score += 15;
    if (declaredWidth >= 600) score += 10;
    const src =
      pickLargestFromSrcset(attrs.srcset) ??
      pickLargestFromSrcset(attrs["data-srcset"]) ??
      attrs["data-src"] ??
      attrs["data-lazy-src"] ??
      attrs["data-original"] ??
      attrs.src;
    push(src, score, alt);
  });

  for (const match of html.matchAll(/background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi)) {
    push(match[2], 25, null);
  }
  return candidates.sort((a, b) => b.score - a.score);
}

/* ————— Fact extraction ————— */

const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const LOCATION_RE = new RegExp(
  `\\b([A-Z][a-zA-Z.'’-]+(?:\\s+[A-Z][a-zA-Z.'’-]+){0,3}),\\s*(${US_STATES})\\b(?!\\w)`,
);
const SPACE_WORDS =
  "Ballroom|Garden|Gardens|Barn|Terrace|Chapel|Pavilion|Lawn|Courtyard|Vineyard|Hall|Loft|Rooftop|Conservatory|Greenhouse|Patio|Veranda|Orchard|Meadow|Grove|Library|Atrium|Carriage House|Cellar|Deck|Pier|Boathouse|Studio|Solarium|Manor|Stable|Stables|Mill|Great Room|Dining Room|Lounge|Arbor|Gazebo|Porch|Pond|Lake|Lakeside|Waterfront|Cottage|Farmhouse|Silo|Tasting Room|Winery|Brewery|Loggia|Cloister|Parlor|Salon|Mezzanine|Observatory|Treehouse|Amphitheater|Overlook|Bluff|Beach|Dock|Hangar|Warehouse|Foundry|Gallery|Theater|Theatre";
const SPACE_RE = new RegExp(
  `\\b((?:The\\s+)?(?:[A-Z][\\w'’-]+\\s+){0,3}(?:${SPACE_WORDS}))\\b`,
  "g",
);
const GENERIC_SPACE = /^(the\s+)?(photo\s+)?(gallery|garden|hall|lounge|deck|beach|lake|pond|studio|library|theater|theatre)$/i;
const CAPACITY_RE = /\b(\d{2,4})\s*(?:\+\s*)?(?:seated\s+|standing\s+)?(?:guests|people|persons|attendees)\b/gi;

export function extractHeuristicFacts(pages: Array<{ url: string; html: string }>, fallbackName: string, region: string | null): VenueFacts {
  let name: string | null = null;
  let location: string | null = null;
  let style: string | null = null;
  const spaces = new Map<string, number>();
  let capacity: number | null = null;

  for (const page of pages) {
    const { html } = page;
    for (const tag of findTags(html, "meta")) {
      const attrs = parseAttrs(tag);
      const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
      const content = attrs.content?.trim();
      if (!content) continue;
      if (key === "og:site_name" && !name) name = content;
      if ((key === "description" || key === "og:description") && !style) {
        style = content.replace(/\s+/g, " ").slice(0, 220);
      }
      if ((key === "geo.placename" || key === "og:locality") && !location) location = content;
    }
    for (const block of html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []) {
      const inner = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
      try {
        const data = JSON.parse(inner) as unknown;
        const nodes: unknown[] = Array.isArray(data) ? data : [data];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const record = node as Record<string, unknown>;
          const graph = Array.isArray(record["@graph"]) ? (record["@graph"] as unknown[]) : [];
          for (const item of [record, ...graph]) {
            if (!item || typeof item !== "object") continue;
            const entry = item as Record<string, unknown>;
            if (!name && typeof entry.name === "string" && entry.name.length < 80) name = entry.name;
            const address = entry.address as Record<string, unknown> | undefined;
            if (!location && address && typeof address === "object") {
              const city = typeof address.addressLocality === "string" ? address.addressLocality : null;
              const state = typeof address.addressRegion === "string" ? address.addressRegion : null;
              if (city) location = state ? `${city}, ${state}` : city;
            }
          }
        }
      } catch {
        /* malformed JSON-LD is common; ignore */
      }
    }
    if (!name) {
      const title = textBetween(html, "title")[0];
      if (title) {
        const first = title.split(/\s*[|–—-]\s*/)[0]?.trim();
        if (first && first.length < 80) name = first;
      }
    }

    const headings = [...textBetween(html, "h1"), ...textBetween(html, "h2"), ...textBetween(html, "h3")];
    const alts = findTags(html, "img")
      .map((tag) => parseAttrs(tag).alt?.trim() ?? "")
      .filter(Boolean);
    const text = stripTags(html);
    const spaceSources = [...headings, ...alts, text];
    for (const source of spaceSources) {
      for (const match of source.matchAll(SPACE_RE)) {
        const candidate = match[1]!.replace(/\s+/g, " ").trim();
        if (candidate.length < 4 || candidate.length > 40 || GENERIC_SPACE.test(candidate)) continue;
        if (/^(our|your|the|a|an)\s+\w+$/i.test(candidate) && !/^The\s/.test(candidate)) continue;
        const key = candidate.toLowerCase();
        spaces.set(key, (spaces.get(key) ?? 0) + (headings.includes(source) || alts.includes(source) ? 3 : 1));
      }
    }
    if (!location) {
      const match = text.match(LOCATION_RE);
      if (match) location = `${match[1]}, ${match[2]}`;
    }
    for (const match of text.matchAll(CAPACITY_RE)) {
      const n = parseInt(match[1]!, 10);
      if (n >= 20 && n <= 2000) capacity = Math.max(capacity ?? 0, n);
    }
  }

  const rankedSpaces = [...spaces.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
    .slice(0, 6)
    .map((key) =>
      key
        .split(" ")
        .map((word) => (word === "the" ? "the" : word.charAt(0).toUpperCase() + word.slice(1)))
        .join(" ")
        .replace(/^the /, "The "),
    );

  return {
    name: name ?? fallbackName,
    location: location ?? region,
    spaces: rankedSpaces,
    style,
    capacity,
    summary: null,
  };
}

/** Grok may tighten the facts, but only with claims that appear in the fetched text. */
export async function refineFactsWithGrok(input: {
  heuristic: VenueFacts;
  pageText: string;
  prospectName: string;
}): Promise<VenueFacts | null> {
  if (!controlPlaneAiConfigured()) return null;
  const { json } = await completeJson({
    systemPrompt: `You extract facts about a wedding venue from text copied from the venue's own website. Return ONLY a JSON object with keys: name (string|null), location (string|null, "City, ST" or "City, Country"), spaces (array of up to 5 strings: the venue's named event spaces exactly as the site names them), style (one plain sentence, max 160 chars, describing the setting, or null), capacity (integer guest count stated on the site, or null), summary (one plain sentence a salesperson could say about the venue, max 160 chars, or null). Rules: use only what the text states; if the text does not say it, use null or an empty array. Never invent spaces, numbers, awards, or claims. Prefer the site's own wording for space names.`,
    userMessage: `Business name on file: ${input.prospectName}\nHeuristic extraction (may be wrong): ${JSON.stringify(input.heuristic)}\n\nWEBSITE TEXT:\n${input.pageText.slice(0, 7000)}`,
    maxOutputTokens: 600,
  });
  const lowerText = input.pageText.toLowerCase();
  const grounded = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    // A fact is grounded when its distinctive words appear in the page text.
    const words = trimmed.toLowerCase().split(/[^a-z0-9'’]+/).filter((word) => word.length > 3);
    if (words.length === 0) return null;
    const hits = words.filter((word) => lowerText.includes(word)).length;
    return hits / words.length >= 0.6 ? trimmed : null;
  };
  const spaces = Array.isArray(json.spaces)
    ? json.spaces.map(grounded).filter((space): space is string => Boolean(space)).slice(0, 5)
    : [];
  const capacityRaw = Number(json.capacity);
  const capacity =
    Number.isInteger(capacityRaw) && capacityRaw >= 20 && capacityRaw <= 2000 && lowerText.includes(String(capacityRaw))
      ? capacityRaw
      : null;
  return {
    name: grounded(json.name) ?? input.heuristic.name,
    location: grounded(json.location) ?? input.heuristic.location,
    spaces: spaces.length > 0 ? spaces : input.heuristic.spaces,
    style: grounded(json.style) ?? input.heuristic.style,
    capacity: capacity ?? input.heuristic.capacity,
    summary: grounded(json.summary),
  };
}

/* ————— Default deps (network, sharp, storage) ————— */

export function defaultResearchDeps(): ResearchDeps {
  const storage = new ObjectStorageService();
  return {
    async fetchPage(url) {
      const result = await safeFetch(url, "text/html,application/xhtml+xml", RESEARCH_LIMITS.maxHtmlBytes);
      if (!result) return null;
      if (result.contentType && !/html|xml/i.test(result.contentType)) return null;
      return { finalUrl: result.finalUrl, html: result.buffer.toString("utf8") };
    },
    async fetchBinary(url) {
      const result = await safeFetch(url, "image/*", RESEARCH_LIMITS.maxImageBytes);
      if (!result) return null;
      return { buffer: result.buffer, contentType: result.contentType };
    },
    async processImage(buffer) {
      try {
        const image = sharp(buffer, { failOn: "none" }).rotate();
        const meta = await image.metadata();
        if (!meta.width || !meta.height) return null;
        if (meta.format === "svg" || meta.format === "gif") return null;
        const hashRaw = await sharp(buffer, { failOn: "none" })
          .rotate()
          .resize(8, 8, { fit: "fill" })
          .grayscale()
          .raw()
          .toBuffer();
        const avg = hashRaw.reduce((sum, v) => sum + v, 0) / hashRaw.length;
        let bits = "";
        for (const value of hashRaw) bits += value > avg ? "1" : "0";
        const hash = BigInt(`0b${bits}`).toString(16).padStart(16, "0");
        const resized = await image
          .resize({ width: BRAND_EMAIL.heroImageWidth, withoutEnlargement: true })
          .jpeg({ quality: BRAND_EMAIL.imageQuality, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        return {
          width: resized.info.width,
          height: resized.info.height,
          buffer: resized.data,
          contentType: "image/jpeg",
          hash,
        };
      } catch (err) {
        logger.debug({ err }, "Outreach research: image could not be processed");
        return null;
      }
    },
    store: (relativePath, buffer, contentType) =>
      storage.uploadPublicObject(relativePath, buffer, contentType).then((path) => `/public-objects/${path}`),
    refineFacts: refineFactsWithGrok,
  };
}

/* ————— Orchestration ————— */

function hammingDistance(a: string, b: string): number {
  const x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  let v = x;
  while (v > 0n) {
    count += Number(v & 1n);
    v >>= 1n;
  }
  return count;
}

const SUBPAGE_HINT = /wedding|venue|space|gallery|photo|event|tour|about|celebrat/i;

function pickSubpages(html: string, pageUrl: string, max: number): string[] {
  const origin = new URL(pageUrl).origin;
  const picked: string[] = [];
  const seen = new Set<string>([pageUrl.replace(/\/$/, "")]);
  for (const match of html.matchAll(/<a\b[^>]*href=("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[2] ?? match[3];
    const label = stripTags(match[4] ?? "");
    const url = resolveUrl(pageUrl, href);
    if (!url || !url.startsWith(origin)) continue;
    const normalized = url.replace(/\/$/, "");
    if (seen.has(normalized)) continue;
    if (!SUBPAGE_HINT.test(`${label} ${new URL(url).pathname}`)) continue;
    if (/\.(pdf|jpe?g|png|webp|zip|mp4)$/i.test(url)) continue;
    seen.add(normalized);
    picked.push(url);
    if (picked.length >= max) break;
  }
  return picked;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function altTextFor(venueName: string, candidateAlt: string | null, sourceUrl: string): string {
  const alt = candidateAlt?.replace(/\s+/g, " ").trim() ?? "";
  if (alt && alt.length >= 8 && alt.length <= 120 && !/^(image|photo|img|dsc|untitled)[\s_\d-]*$/i.test(alt)) {
    return alt.toLowerCase().includes(venueName.toLowerCase()) ? alt : `${venueName}: ${alt}`;
  }
  return `${venueName}, photographed for ${hostnameOf(sourceUrl)}`;
}

export async function researchVenue(input: ResearchInput, deps: ResearchDeps): Promise<ResearchResult> {
  const warnings: string[] = [];
  const sourceUrls: string[] = [];
  const venueName = input.name;

  const website = input.website ? resolveUrl("https://example.invalid/", input.website) : null;
  if (!website) {
    return {
      status: "fetch_failed",
      sourceUrls,
      facts: { name: venueName, location: input.region, spaces: [], style: null, capacity: null, summary: null },
      warnings: ["The prospect has no website on file, so no venue photos or facts could be gathered."],
      images: [],
      pageText: "",
    };
  }

  const pages: Array<{ url: string; html: string }> = [];
  let home: FetchedPage | null = null;
  try {
    home = await deps.fetchPage(website);
  } catch (err) {
    logger.warn({ err, website }, "Outreach research: homepage fetch threw");
  }
  if (!home) {
    return {
      status: "fetch_failed",
      sourceUrls: [website],
      facts: { name: venueName, location: input.region, spaces: [], style: null, capacity: null, summary: null },
      warnings: [`Could not load ${hostnameOf(website)}; the site may block automated requests. Add images manually or retry later.`],
      images: [],
      pageText: "",
    };
  }
  pages.push({ url: home.finalUrl, html: home.html });
  sourceUrls.push(home.finalUrl);

  for (const subpage of pickSubpages(home.html, home.finalUrl, RESEARCH_LIMITS.maxPages - 1)) {
    try {
      const fetched = await deps.fetchPage(subpage);
      if (fetched) {
        pages.push({ url: fetched.finalUrl, html: fetched.html });
        sourceUrls.push(fetched.finalUrl);
      }
    } catch (err) {
      logger.debug({ err, subpage }, "Outreach research: subpage fetch failed");
    }
  }

  // Facts.
  const heuristic = extractHeuristicFacts(pages, venueName, input.region);
  const pageText = pages
    .map((page) => `# ${page.url}\n${stripTags(page.html).slice(0, 4000)}`)
    .join("\n\n");
  let facts = heuristic;
  if (deps.refineFacts) {
    try {
      const refined = await deps.refineFacts({ heuristic, pageText, prospectName: venueName });
      if (refined) facts = refined;
    } catch (err) {
      logger.warn({ err }, "Outreach research: fact refinement failed; using heuristic facts");
      warnings.push("Grok could not refine the venue facts; the draft uses heuristic extraction only.");
    }
  }
  if (facts.spaces.length === 0) {
    warnings.push("No named event spaces were found on the site; the copy will speak about the venue generally.");
  }

  // Images: gather candidates across pages, download the strongest, keep the good ones.
  const candidates: ImageCandidate[] = [];
  const seenUrls = new Set<string>();
  for (const page of pages) {
    for (const candidate of collectImageCandidates(page.html, page.url)) {
      if (seenUrls.has(candidate.url)) continue;
      seenUrls.add(candidate.url);
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const kept: Array<ResearchImage & { hash: string }> = [];
  let downloads = 0;
  for (const candidate of candidates) {
    if (downloads >= RESEARCH_LIMITS.maxImageDownloads || kept.length >= RESEARCH_LIMITS.maxStoredImages) break;
    downloads += 1;
    let fetched: { buffer: Buffer; contentType: string | null } | null = null;
    try {
      fetched = await deps.fetchBinary(candidate.url);
    } catch (err) {
      logger.debug({ err, url: candidate.url }, "Outreach research: image fetch failed");
    }
    if (!fetched) continue;
    if (fetched.contentType && !/^image\//i.test(fetched.contentType)) continue;
    const processed = await deps.processImage(fetched.buffer);
    if (!processed) continue;
    if (processed.width < RESEARCH_LIMITS.minWidth || processed.height < RESEARCH_LIMITS.minHeight) continue;
    const aspect = processed.width / processed.height;
    if (aspect < 0.5 || aspect > 2.6) continue;
    if (kept.some((image) => hammingDistance(image.hash, processed.hash) <= 5)) continue;

    const area = processed.width * processed.height;
    let score = candidate.score + Math.min(20, Math.round((area / (1200 * 800)) * 10));
    if (aspect >= 1.2 && aspect <= 2.0) score += 5;

    const fileName = `${createHash("sha1").update(candidate.url).digest("hex").slice(0, 16)}.jpg`;
    let objectKey: string;
    try {
      objectKey = await deps.store(`outreach/${input.prospectId}/${fileName}`, processed.buffer, processed.contentType);
    } catch (err) {
      logger.warn({ err, url: candidate.url }, "Outreach research: storing image failed");
      warnings.push("One or more venue photos could not be saved to storage.");
      continue;
    }
    kept.push({
      objectKey,
      sourceUrl: candidate.url,
      pageUrl: candidate.pageUrl,
      contentType: processed.contentType,
      width: processed.width,
      height: processed.height,
      bytes: processed.buffer.length,
      altText: altTextFor(facts.name ?? venueName, candidate.alt, candidate.url),
      score,
      selected: false,
      hash: processed.hash,
    });
  }

  kept.sort((a, b) => b.score - a.score);
  kept.forEach((image, index) => {
    image.selected = index < RESEARCH_LIMITS.maxSelectedImages;
  });
  const images: ResearchImage[] = kept.map(({ hash: _hash, ...image }) => image);

  let status: ResearchStatus = "ok";
  if (images.length === 0) {
    status = "no_images";
    warnings.unshift(
      `No usable venue photos were found on ${hostnameOf(home.finalUrl)} (need at least ${RESEARCH_LIMITS.minWidth}×${RESEARCH_LIMITS.minHeight}). The email will send as a text-only note unless you add one.`,
    );
  }

  return { status, sourceUrls, facts, warnings, images, pageText };
}
