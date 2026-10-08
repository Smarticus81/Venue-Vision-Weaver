import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import sharp from "sharp";
import { BRAND_EMAIL } from "@workspace/brand";
import { logger } from "../../lib/logger.js";
import { ObjectStorageService } from "../../lib/objectStorage.js";
import { completeJson, controlPlaneAiConfigured } from "../grok.js";
import { normalizeWebsiteUrl } from "../vetting/domain.js";

/**
 * Venue research for the outreach studio.
 *
 * Given a prospect's own public website we pull the facts an email can
 * truthfully mention (name, location, named spaces, style, public capacity)
 * and copies of the venue's own photos (og:image, hero, gallery), recording
 * where every one came from. Everything network-facing goes through
 * injectable deps so the selection logic is unit-testable without the web,
 * sharp, or storage.
 *
 * Network safety: every outbound request resolves the hostname itself,
 * refuses private/special ranges (IPv4 and IPv6, including embedded IPv4),
 * refuses non-standard ports, and then connects to the exact address it
 * validated (pinned), re-validating on every redirect hop. There is no
 * second DNS lookup for an attacker to rebind.
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
  /** Per-page visible text so fact attribution can name the page a fact was seen on. */
  pages: Array<{ url: string; text: string }>;
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
  /** Clock for the research deadline (tests inject a fake). */
  now?(): number;
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
  /** Whole research run (pages + photos) stops after this and reports what it has. */
  totalDeadlineMs: 45_000,
  /** Per-page text kept for attribution. */
  pageTextChars: 20_000,
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
    .replace(/[ \t ]+/g, " ")
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

function isPrivateIpv4Parts(parts: number[]): boolean {
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return isPrivateIpv4Parts(parts);
}

/**
 * Parse an IPv6 literal (with or without brackets, with an optional zone id
 * that is rejected) into 16 bytes. Handles "::" compression and embedded
 * dotted IPv4 ("::ffff:10.0.0.1"). Null when malformed.
 */
export function parseIpv6(raw: string): Uint8Array | null {
  let ip = raw.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!ip || ip.includes("%")) return null;
  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(":");
  const lastPart = ip.slice(lastColon + 1);
  if (lastPart.includes(".")) {
    const v4 = lastPart.split(".").map(Number);
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    tail = [((v4[0]! << 8) | v4[1]!) & 0xffff, ((v4[2]! << 8) | v4[3]!) & 0xffff];
    ip = `${ip.slice(0, lastColon)}:`;
    if (ip === ":") ip = "::";
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (segment: string): number[] | null => {
    if (segment === "") return [];
    const groups = segment.split(":");
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (!head || !rest) return null;
  const groups = [...head];
  const total = head.length + rest.length + tail.length;
  if (halves.length === 2) {
    if (total > 7) return null;
    for (let i = total; i < 8; i += 1) groups.push(0);
  } else if (total !== 8) {
    return null;
  }
  groups.push(...rest, ...tail);
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function embeddedIpv4IsPrivate(bytes: Uint8Array, offset: number): boolean {
  return isPrivateIpv4Parts([bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!]);
}

/** True for loopback, unspecified, unique-local, link-local, site-local, multicast, documentation, and embedded private IPv4. */
export function isPrivateIpv6(ip: string): boolean {
  const bytes = parseIpv6(ip);
  if (!bytes) return true;
  const allZeroPrefix = (upTo: number) => bytes.slice(0, upTo).every((b) => b === 0);
  if (allZeroPrefix(15) && (bytes[15] === 0 || bytes[15] === 1)) return true; // :: and ::1
  if (allZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) return embeddedIpv4IsPrivate(bytes, 12); // ::ffff:a.b.c.d
  if (allZeroPrefix(12)) return embeddedIpv4IsPrivate(bytes, 12); // ::a.b.c.d (IPv4-compatible, deprecated)
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && allZeroPrefixFrom(bytes, 4, 12)) {
    return embeddedIpv4IsPrivate(bytes, 12); // 64:ff9b::/96 NAT64
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return embeddedIpv4IsPrivate(bytes, 2); // 2002::/16 6to4
  const first = bytes[0]!;
  if ((first & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (first === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // fe80::/10 link local
  if (first === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return true; // fec0::/10 site local (deprecated)
  if (first === 0xff) return true; // multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32 documentation
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && allZeroPrefixFrom(bytes, 2, 8)) return true; // 100::/64 discard
  return false;
}

function allZeroPrefixFrom(bytes: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

/** True when an IP literal belongs to a range we never connect to. */
export function ipIsPrivate(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, "");
  const version = isIP(host);
  if (version === 4) return isPrivateIpv4(host);
  if (version === 6) return isPrivateIpv6(host);
  return true;
}

export function hostLooksPrivate(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".in-addr.arpa") ||
    host.endsWith(".ip6.arpa")
  ) {
    return true;
  }
  if (isIP(host)) return ipIsPrivate(host);
  return false;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type AddressLookup = (hostname: string) => Promise<ResolvedAddress[]>;

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true }).catch(() => []);
  return addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
}

/** Only the default http(s) ports are ever contacted. */
export const ALLOWED_PORTS = new Set(["", "80", "443"]);

/**
 * Validate a URL and resolve the exact address we will connect to. Every
 * resolved address must be public (a host that resolves to a mix of public
 * and private addresses is refused outright). The returned address is pinned
 * for the connection, so the DNS answer we checked is the one we use.
 */
export async function resolvePinnedTarget(url: URL, lookup: AddressLookup = defaultLookup): Promise<ResolvedAddress> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing non-http URL ${url.toString()}`);
  }
  if (url.username || url.password) throw new Error(`Refusing URL with credentials ${url.hostname}`);
  if (!ALLOWED_PORTS.has(url.port)) throw new Error(`Refusing non-standard port ${url.port} on ${url.hostname}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (hostLooksPrivate(host)) throw new Error(`Refusing private host ${url.hostname}`);
  const literal = isIP(host);
  if (literal) return { address: host, family: literal === 6 ? 6 : 4 };
  const addresses = await lookup(host);
  if (addresses.length === 0) throw new Error(`Could not resolve ${host}`);
  for (const entry of addresses) {
    if (ipIsPrivate(entry.address)) throw new Error(`Refusing ${host}: resolves to a private address`);
  }
  return addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
}

/** Only public http(s) hosts; resolves DNS and refuses private ranges and odd ports. */
export async function assertPublicUrl(rawUrl: string, lookup?: AddressLookup): Promise<URL> {
  const url = new URL(rawUrl);
  await resolvePinnedTarget(url, lookup);
  return url;
}

const USER_AGENT = "Mozilla/5.0 (compatible; DreemerResearch/1.0; +https://dreemer.co)";

export interface PinnedRequest {
  url: URL;
  address: string;
  family: 4 | 6;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface PinnedResponse {
  status: number;
  headers: Record<string, string | undefined>;
  /** Raw (possibly content-encoded) body; null when it exceeded maxBytes. */
  body: Buffer | null;
}

export type PinnedTransport = (request: PinnedRequest) => Promise<PinnedResponse>;

function flattenHeaders(message: IncomingMessage): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(message.headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** Connects to the pinned address with the hostname only in Host/SNI, never re-resolving. */
function defaultTransport(request: PinnedRequest): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = request.url.protocol === "https:";
    const hostname = request.url.hostname.replace(/^\[|\]$/g, "");
    const port = request.url.port ? Number(request.url.port) : isHttps ? 443 : 80;
    const hostHeader = request.url.port ? `${request.url.hostname}:${request.url.port}` : request.url.hostname;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const options = {
      host: request.address,
      port,
      path: `${request.url.pathname}${request.url.search}`,
      method: request.method,
      headers: { ...request.headers, Host: hostHeader },
      ...(isHttps && !isIP(hostname) ? { servername: hostname } : {}),
    };
    const req = (isHttps ? httpsRequest : httpRequest)(options, (response) => {
      const declared = Number(response.headers["content-length"] ?? "0");
      if (declared > request.maxBytes) {
        response.destroy();
        finish(() => resolve({ status: response.statusCode ?? 0, headers: flattenHeaders(response), body: null }));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      let over = false;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > request.maxBytes) {
          over = true;
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        finish(() => resolve({ status: response.statusCode ?? 0, headers: flattenHeaders(response), body: over ? null : Buffer.concat(chunks) }));
      });
      response.on("close", () => {
        finish(() => resolve({ status: response.statusCode ?? 0, headers: flattenHeaders(response), body: over ? null : Buffer.concat(chunks) }));
      });
      response.on("error", (err) => finish(() => reject(err)));
    });
    req.setTimeout(request.timeoutMs, () => req.destroy(new Error(`Timed out after ${request.timeoutMs}ms fetching ${request.url.hostname}`)));
    req.on("error", (err) => finish(() => reject(err)));
    if (request.body) req.write(request.body);
    req.end();
  });
}

function decodeBody(body: Buffer | null, encoding: string | undefined, maxBytes: number): Buffer | null {
  if (!body) return null;
  const enc = (encoding ?? "").trim().toLowerCase();
  try {
    if (!enc || enc === "identity") return body;
    if (enc === "gzip" || enc === "x-gzip") return gunzipSync(body, { maxOutputLength: maxBytes });
    if (enc === "deflate") return inflateSync(body, { maxOutputLength: maxBytes });
    if (enc === "br") return brotliDecompressSync(body, { maxOutputLength: maxBytes });
    return body;
  } catch {
    return null;
  }
}

export interface PublicFetchOptions {
  accept?: string;
  maxBytes?: number;
  timeoutMs?: number;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  maxRedirects?: number;
  lookup?: AddressLookup;
  transport?: PinnedTransport;
}

export interface PublicFetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  /** Decoded body; null when it exceeded the cap. */
  buffer: Buffer | null;
}

/**
 * SSRF-safe fetch with pinned addresses and manual redirects (every hop is
 * re-validated and re-pinned). Throws on DNS/connect/timeout/guard errors;
 * returns non-2xx statuses to the caller.
 */
export async function fetchPublic(rawUrl: string, options: PublicFetchOptions = {}): Promise<PublicFetchResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxBytes ?? RESEARCH_LIMITS.maxHtmlBytes;
  const transport = options.transport ?? defaultTransport;
  let current = rawUrl;
  let method: "GET" | "POST" = options.method ?? "GET";
  let body = options.body;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = new URL(current);
    const target = await resolvePinnedTarget(url, options.lookup);
    const response = await transport({
      url,
      address: target.address,
      family: target.family,
      method,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: options.accept ?? "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        ...(options.headers ?? {}),
      },
      body,
      timeoutMs: options.timeoutMs ?? RESEARCH_LIMITS.fetchTimeoutMs,
      maxBytes,
    });
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      current = new URL(response.headers.location, url).toString();
      if (response.status === 303 || method === "POST") {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return {
      finalUrl: url.toString(),
      status: response.status,
      contentType: response.headers["content-type"] ?? null,
      buffer: decodeBody(response.body, response.headers["content-encoding"], maxBytes),
    };
  }
  throw new Error(`Too many redirects fetching ${rawUrl}`);
}

/** 2xx-only convenience over fetchPublic: null on non-2xx or an over-cap body; throws on network/guard errors. */
export async function safeFetch(
  rawUrl: string,
  accept: string,
  maxBytes: number,
  options: Pick<PublicFetchOptions, "timeoutMs" | "lookup" | "transport"> = {},
): Promise<{ finalUrl: string; buffer: Buffer; contentType: string | null } | null> {
  const result = await fetchPublic(rawUrl, { accept, maxBytes, ...options });
  if (result.status < 200 || result.status >= 300 || !result.buffer) return null;
  return { finalUrl: result.finalUrl, buffer: result.buffer, contentType: result.contentType };
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
/** Share cards and logos published as og:image must not outrank real photos. */
const SHARE_CARD_HINT = /(^|[\/_.\-])(share|social|card|og|opengraph|logo|brand|seo)([\/_.\-]|$)/i;

function basenameOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
  } catch {
    return url;
  }
}

export function looksLikeShareCard(url: string): boolean {
  return SHARE_CARD_HINT.test(basenameOf(url));
}

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
      const url = resolveUrl(pageUrl, attrs.content);
      push(attrs.content, url && looksLikeShareCard(url) ? 20 : 60, null);
    } else if (key === "twitter:image" || key === "twitter:image:src") {
      const url = resolveUrl(pageUrl, attrs.content);
      push(attrs.content, url && looksLikeShareCard(url) ? 18 : 50, null);
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
  "Ballroom|Garden|Gardens|Barn|Terrace|Chapel|Pavilion|Lawn|Courtyard|Vineyard|Hall|Loft|Rooftop|Conservatory|Greenhouse|Patio|Veranda|Orchard|Meadow|Grove|Library|Atrium|Carriage House|Cellar|Deck|Pier|Boathouse|Studio|Solarium|Manor|Stable|Stables|Mill|Great Room|Dining Room|Lounge|Arbor|Gazebo|Porch|Pond|Lake|Lakeside|Waterfront|Cottage|Farmhouse|Silo|Tasting Room|Winery|Brewery|Loggia|Cloister|Parlor|Salon|Mezzanine|Observatory|Treehouse|Amphitheater|Overlook|Bluff|Beach|Dock|Hangar|Warehouse|Foundry|Theater|Theatre";
// Space names never cross a line break (headings, nav links, and paragraphs
// are separated by newlines after tag stripping), hence [ \t] not \s.
export const SPACE_RE = new RegExp(
  `\\b((?:The[ \\t]+)?(?:[A-Z][\\w'’-]+[ \\t]+){0,3}(?:${SPACE_WORDS}))\\b`,
  "g",
);
export const GENERIC_SPACE = /^(the\s+)?(photo\s+)?(garden|hall|lounge|deck|beach|lake|pond|studio|library|theater|theatre|estate|house)$/i;
/** Words that mark a navigation label or sentence fragment rather than a space name. */
const SPACE_STOP_WORDS = /\b(weddings?|events?|photos?|venues?|home|contact|about|welcome|our|your|us|at|in|of|and|the\s+the|[A-Z]{2})\b/i;
const CAPACITY_RE = /\b(\d{2,4})\s*(?:\+\s*)?(?:seated\s+|standing\s+)?(?:guests|people|persons|attendees)\b/gi;

/** <title> segments that are page labels, not business names. */
const GENERIC_TITLE_WORDS = new Set([
  "home",
  "homepage",
  "home page",
  "welcome",
  "weddings",
  "wedding",
  "wedding venue",
  "venue",
  "venues",
  "index",
  "untitled",
  "untitled document",
  "events",
  "event",
  "main",
  "default",
  "page",
  "official site",
  "official website",
  "new page",
  "coming soon",
]);
const TITLE_TOKEN_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "weddings",
  "wedding",
  "venue",
  "venues",
  "events",
  "event",
  "home",
  "welcome",
  "official",
  "site",
  "website",
  "inc",
  "llc",
]);

function distinctiveTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9'’]+/)
      .filter((token) => token.length >= 3 && !TITLE_TOKEN_STOP.has(token)),
  );
}

/**
 * A <title>-derived name is accepted only when it is not a generic page label
 * and shares a distinctive token with the prospect's name on file, so "Home"
 * or "Weddings" never become "I came across Home while…".
 */
export function titleDerivedName(title: string, fallbackName: string): string | null {
  const first = title.split(/\s*[|–—-]\s*/)[0]?.trim() ?? "";
  if (!first || first.length >= 80) return null;
  if (GENERIC_TITLE_WORDS.has(first.toLowerCase())) return null;
  const titleTokens = distinctiveTokens(first);
  if (titleTokens.size === 0) return null;
  const nameTokens = distinctiveTokens(fallbackName);
  for (const token of titleTokens) if (nameTokens.has(token)) return first;
  return null;
}

/** Phrases that mark a call-to-action rather than a fact about the venue. */
const FACT_IMPERATIVE =
  /^(click|tap|call|book|buy|subscribe|sign ?up|download|learn more|read more|contact us|visit|order|get started|join|follow|share|see more|view|enter|log ?in|register|donate|shop|schedule|request|reserve|inquire|get a quote|apply)\b/i;

/**
 * Facts come from attacker-controlled HTML. Keep only short, mostly-alphabetic
 * text with no URLs, mailboxes, markup, control characters, or imperatives.
 */
export function sanitizeFactText(value: unknown, maxLength = 160): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > maxLength) return null;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) return null;
  if (/[<>{}[\]\\|^~`]/.test(text)) return null;
  if (/https?:\/\/|www\.|@|\.(com|net|org|io|co|us)\b/i.test(text)) return null;
  const nonSpace = text.replace(/\s/g, "");
  const letters = (text.match(/[a-z]/gi) ?? []).length;
  if (nonSpace.length === 0 || letters / nonSpace.length < 0.5) return null;
  if (FACT_IMPERATIVE.test(text)) return null;
  return text;
}

export function sanitizeFacts(facts: VenueFacts, fallbackName: string, fallbackLocation: string | null): VenueFacts {
  const seen = new Set<string>();
  const spaces: string[] = [];
  for (const space of facts.spaces) {
    const clean = sanitizeFactText(space, 40);
    if (!clean) continue;
    const key = clean.toLowerCase().replace(/^the\s+/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    spaces.push(clean);
    if (spaces.length >= 6) break;
  }
  const capacity =
    typeof facts.capacity === "number" && Number.isInteger(facts.capacity) && facts.capacity >= 20 && facts.capacity <= 2000
      ? facts.capacity
      : null;
  return {
    name: sanitizeFactText(facts.name, 80) ?? fallbackName,
    location: sanitizeFactText(facts.location, 80) ?? fallbackLocation,
    spaces,
    style: sanitizeFactText(facts.style, 220),
    capacity,
    summary: sanitizeFactText(facts.summary, 220),
  };
}

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
      if (title) name = titleDerivedName(title, fallbackName);
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
        const inner = candidate.replace(/^The\s+/, "");
        if (SPACE_STOP_WORDS.test(inner)) continue;
        // "The Timber Barn" and "Timber Barn" are one space; keep the article.
        const key = candidate.toLowerCase().replace(/^the\s+/, "");
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
      `The ${key
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")}`,
    );

  return sanitizeFacts(
    {
      name: name ?? fallbackName,
      location: location ?? region,
      spaces: rankedSpaces,
      style,
      capacity,
      summary: null,
    },
    fallbackName,
    region,
  );
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
  return sanitizeFacts(
    {
      name: grounded(json.name) ?? input.heuristic.name,
      location: grounded(json.location) ?? input.heuristic.location,
      spaces: spaces.length > 0 ? spaces : input.heuristic.spaces,
      style: grounded(json.style) ?? input.heuristic.style,
      capacity: capacity ?? input.heuristic.capacity,
      summary: grounded(json.summary),
    },
    input.heuristic.name ?? input.prospectName,
    input.heuristic.location,
  );
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

const DEADLINE_WARNING = `Research stopped at the ${Math.round(RESEARCH_LIMITS.totalDeadlineMs / 1000)}s deadline; some pages or photos were skipped. Re-run research to try again.`;

export async function researchVenue(input: ResearchInput, deps: ResearchDeps): Promise<ResearchResult> {
  const warnings: string[] = [];
  const sourceUrls: string[] = [];
  const venueName = input.name;
  const now = () => deps.now?.() ?? Date.now();
  const startedAt = now();
  let deadlineHit = false;
  const pastDeadline = (): boolean => {
    if (deadlineHit) return true;
    if (now() - startedAt > RESEARCH_LIMITS.totalDeadlineMs) {
      deadlineHit = true;
      warnings.push(DEADLINE_WARNING);
    }
    return deadlineHit;
  };
  const emptyFacts = (): VenueFacts => ({ name: venueName, location: input.region, spaces: [], style: null, capacity: null, summary: null });

  const website = normalizeWebsiteUrl(input.website);
  if (!website) {
    return {
      status: "fetch_failed",
      sourceUrls,
      facts: emptyFacts(),
      warnings: [
        input.website
          ? `"${input.website}" is not a usable website address, so no venue photos or facts could be gathered.`
          : "The prospect has no website on file, so no venue photos or facts could be gathered.",
      ],
      images: [],
      pageText: "",
      pages: [],
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
      facts: emptyFacts(),
      warnings: [`Could not load ${hostnameOf(website)}; the site may block automated requests. Add images manually or retry later.`],
      images: [],
      pageText: "",
      pages: [],
    };
  }
  pages.push({ url: home.finalUrl, html: home.html });
  sourceUrls.push(home.finalUrl);

  for (const subpage of pickSubpages(home.html, home.finalUrl, RESEARCH_LIMITS.maxPages - 1)) {
    if (pastDeadline()) break;
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
  const pageTexts = pages.map((page) => ({ url: page.url, text: stripTags(page.html).slice(0, RESEARCH_LIMITS.pageTextChars) }));
  const pageText = pageTexts.map((page) => `# ${page.url}\n${page.text.slice(0, 4000)}`).join("\n\n");
  let facts = heuristic;
  if (deps.refineFacts && !pastDeadline()) {
    try {
      const refined = await deps.refineFacts({ heuristic, pageText, prospectName: venueName });
      if (refined) facts = sanitizeFacts(refined, venueName, input.region);
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
    if (pastDeadline()) break;
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

  return { status, sourceUrls, facts, warnings, images, pageText, pages: pageTexts };
}
