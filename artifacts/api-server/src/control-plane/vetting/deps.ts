import { resolveMx, resolveTxt } from "node:dns/promises";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { isIP } from "node:net";
import { logger } from "../../lib/logger.js";
import { rdapBaseUrl, waybackCdxUrl } from "../outreach/config.js";
import { fetchPublic, resolvePinnedTarget, resolveUrl, stripTags } from "../outreach/venueResearch.js";
import type { DnsInfo, FetchedSite, RdapInfo, TlsInfo, WaybackInfo } from "./checks.js";
import { normalizeWebsiteUrl } from "./domain.js";
import { placesEnabled, searchPlace, type PlacesSearchInput, type PlacesSearchResult } from "./places.js";

/**
 * Everything vetting needs from the network, behind one interface so the
 * checks and the orchestration run offline in tests (vetting.md 1.7).
 *
 * Every HTTP request goes through the outreach module's pinned fetch: the
 * hostname is resolved once, every resolved address must be public, the
 * connection is made to that exact address, and every redirect hop is
 * re-validated. TLS probes connect to the same pinned address.
 */

export const VETTING_LIMITS = {
  fetchTimeoutMs: 8_000,
  maxHtmlBytes: 3 * 1024 * 1024,
  maxJsonBytes: 1024 * 1024,
  maxSubpages: 2,
  tlsTimeoutMs: 6_000,
  pageTextChars: 40_000,
} as const;

export interface VettingDeps {
  /** Homepage + up to maxSubpages contact/about/team/faq pages; never throws for HTTP statuses, throws only for guard/DNS/connect/timeout. */
  fetchSite(website: string): Promise<FetchedSite>;
  /** JSON over the pinned fetch; null on network error (callers map it to an error outcome). */
  fetchJson(
    url: string,
    init?: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; json: unknown } | null>;
  resolveDns(domain: string): Promise<DnsInfo>;
  probeTls(hostname: string): Promise<TlsInfo>;
  rdap(domain: string): Promise<RdapInfo>;
  wayback(domain: string): Promise<WaybackInfo>;
  /** Undefined when Tier B is disabled or the daily cap is reached. */
  placesSearch?: (input: PlacesSearchInput) => Promise<PlacesSearchResult>;
  now(): Date;
}

/* ————— Pure parsers (exported for tests) ————— */

const SUBPAGE_RE = /contact|about|team|our-story|story|faq|meet|staff|owners?/i;

/** Same-origin links whose path or label looks like contact/about/team/faq; deduped, capped. */
export function pickVettingSubpages(html: string, pageUrl: string, max: number = VETTING_LIMITS.maxSubpages): string[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  const picked: string[] = [];
  const seen = new Set<string>([pageUrl.replace(/\/$/, "")]);
  for (const match of html.matchAll(/<a\b[^>]*href=("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[2] ?? match[3];
    const label = stripTags(match[4] ?? "");
    const url = resolveUrl(pageUrl, href);
    if (!url || !url.startsWith(origin)) continue;
    const normalized = url.replace(/\/$/, "");
    if (seen.has(normalized)) continue;
    let pathname = "";
    try {
      pathname = new URL(url).pathname;
    } catch {
      continue;
    }
    if (!SUBPAGE_RE.test(pathname) && !SUBPAGE_RE.test(label)) continue;
    if (/\.(pdf|jpe?g|png|webp|gif|svg|zip|mp4|mov)$/i.test(pathname)) continue;
    seen.add(normalized);
    picked.push(url);
    if (picked.length >= max) break;
  }
  return picked;
}

function isHtml(contentType: string | null): boolean {
  return !contentType || /html|xml/i.test(contentType);
}

/** RDAP domain object -> registration date + registrar (vetting.md 1.7). */
export function parseRdap(json: unknown, sourceUrl: string): RdapInfo {
  const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  let registeredAt: Date | null = null;
  const events = Array.isArray(record.events) ? (record.events as unknown[]) : [];
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as Record<string, unknown>;
    if (event.eventAction === "registration" && typeof event.eventDate === "string") {
      const date = new Date(event.eventDate);
      if (!Number.isNaN(date.getTime())) {
        registeredAt = date;
        break;
      }
    }
  }
  let registrar: string | null = null;
  const entities = Array.isArray(record.entities) ? (record.entities as unknown[]) : [];
  for (const raw of entities) {
    if (!raw || typeof raw !== "object") continue;
    const entity = raw as Record<string, unknown>;
    const roles = Array.isArray(entity.roles) ? entity.roles : [];
    if (!roles.includes("registrar")) continue;
    const vcard = Array.isArray(entity.vcardArray) ? (entity.vcardArray[1] as unknown) : null;
    if (Array.isArray(vcard)) {
      for (const field of vcard) {
        if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string" && field[3].trim()) {
          registrar = field[3].trim();
          break;
        }
      }
    }
    if (!registrar && typeof entity.handle === "string") registrar = entity.handle;
    if (registrar) break;
  }
  return { registeredAt, registrar, sourceUrl, error: null };
}

/** CDX JSON ([["timestamp"],["YYYYMMDDhhmmss"]]) -> first capture date. */
export function parseCdx(json: unknown, sourceUrl: string): WaybackInfo {
  if (!Array.isArray(json)) return { firstCaptureAt: null, sourceUrl, error: null };
  for (const row of json.slice(1)) {
    const stamp = Array.isArray(row) ? row[0] : null;
    if (typeof stamp === "string" && /^\d{14}$/.test(stamp)) {
      const date = new Date(
        Date.UTC(
          Number(stamp.slice(0, 4)),
          Number(stamp.slice(4, 6)) - 1,
          Number(stamp.slice(6, 8)),
          Number(stamp.slice(8, 10)),
          Number(stamp.slice(10, 12)),
          Number(stamp.slice(12, 14)),
        ),
      );
      if (!Number.isNaN(date.getTime())) return { firstCaptureAt: date, sourceUrl, error: null };
    }
  }
  return { firstCaptureAt: null, sourceUrl, error: null };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function dnsCode(err: unknown): string | null {
  return err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
    ? ((err as { code: string }).code)
    : null;
}

/** ENOTFOUND/ENODATA mean "no such record", not a lookup failure. */
const DNS_EMPTY_CODES = new Set(["ENOTFOUND", "ENODATA", "ENOTIMP", "SERVFAIL_EMPTY"]);

/* ————— Default (network) deps ————— */

export function defaultVettingDeps(): VettingDeps {
  const deps: VettingDeps = {
    async fetchSite(website) {
      const requestedUrl = normalizeWebsiteUrl(website) ?? website;
      let home;
      try {
        home = await fetchPublic(requestedUrl, {
          accept: "text/html,application/xhtml+xml",
          maxBytes: VETTING_LIMITS.maxHtmlBytes,
          timeoutMs: VETTING_LIMITS.fetchTimeoutMs,
        });
      } catch (err) {
        return { requestedUrl, finalUrl: null, status: null, contentType: null, pages: [], error: errorMessage(err) };
      }
      const base: FetchedSite = {
        requestedUrl,
        finalUrl: home.finalUrl,
        status: home.status,
        contentType: home.contentType,
        pages: [],
        error: null,
      };
      if (home.status < 200 || home.status >= 300 || !home.buffer || !isHtml(home.contentType)) return base;
      const html = home.buffer.toString("utf8");
      base.pages.push({ url: home.finalUrl, html, text: stripTags(html).slice(0, VETTING_LIMITS.pageTextChars) });
      for (const subpage of pickVettingSubpages(html, home.finalUrl)) {
        try {
          const fetched = await fetchPublic(subpage, {
            accept: "text/html,application/xhtml+xml",
            maxBytes: VETTING_LIMITS.maxHtmlBytes,
            timeoutMs: VETTING_LIMITS.fetchTimeoutMs,
          });
          if (fetched.status < 200 || fetched.status >= 300 || !fetched.buffer || !isHtml(fetched.contentType)) continue;
          const subHtml = fetched.buffer.toString("utf8");
          base.pages.push({ url: fetched.finalUrl, html: subHtml, text: stripTags(subHtml).slice(0, VETTING_LIMITS.pageTextChars) });
        } catch (err) {
          logger.debug({ err, subpage }, "Vetting: subpage fetch failed");
        }
      }
      return base;
    },

    async fetchJson(url, init = {}) {
      try {
        const result = await fetchPublic(url, {
          accept: "application/json, application/rdap+json;q=0.9, */*;q=0.1",
          maxBytes: VETTING_LIMITS.maxJsonBytes,
          timeoutMs: VETTING_LIMITS.fetchTimeoutMs,
          method: init.method ?? "GET",
          headers: init.headers,
          body: init.body,
        });
        let json: unknown = null;
        if (result.buffer) {
          try {
            json = JSON.parse(result.buffer.toString("utf8"));
          } catch {
            json = null;
          }
        }
        return { status: result.status, json };
      } catch (err) {
        logger.debug({ err, url }, "Vetting: JSON fetch failed");
        return null;
      }
    },

    async resolveDns(domain) {
      const host = domain.trim().toLowerCase().replace(/\.$/, "");
      const lookupTxt = async (name: string): Promise<string[] | "error"> => {
        try {
          const records = await resolveTxt(name);
          return records.map((chunks) => chunks.join(""));
        } catch (err) {
          const code = dnsCode(err);
          if (code && DNS_EMPTY_CODES.has(code)) return [];
          return "error";
        }
      };
      let mx: string[] = [];
      try {
        const records = await resolveMx(host);
        mx = records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange.toLowerCase().replace(/\.$/, ""));
      } catch (err) {
        const code = dnsCode(err);
        if (!code || !DNS_EMPTY_CODES.has(code)) {
          return { mx: [], spf: false, dmarc: false, error: `MX lookup failed (${code ?? errorMessage(err)})` };
        }
      }
      // A domain with no MX but an A record still receives mail in theory; we treat "no MX" as the venue's problem (checkMx).
      const [spfRecords, dmarcRecords] = await Promise.all([lookupTxt(host), lookupTxt(`_dmarc.${host}`)]);
      if (spfRecords === "error" || dmarcRecords === "error") {
        return { mx, spf: false, dmarc: false, error: "TXT lookup failed" };
      }
      return {
        mx,
        spf: spfRecords.some((record) => /^v=spf1\b/i.test(record.trim())),
        dmarc: dmarcRecords.some((record) => /^v=DMARC1\b/i.test(record.trim())),
        error: null,
      };
    },

    async probeTls(hostname) {
      const servername = hostname.replace(/^\[|\]$/g, "").toLowerCase();
      let address = servername;
      try {
        const target = await resolvePinnedTarget(new URL(`https://${servername}/`));
        address = target.address;
      } catch (err) {
        return { ok: false, issuer: null, validFrom: null, validTo: null, error: errorMessage(err), servername };
      }
      return new Promise<TlsInfo>((resolve) => {
        let settled = false;
        const finish = (info: TlsInfo) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(info);
        };
        const socket: TLSSocket = tlsConnect({
          host: address,
          port: 443,
          ...(isIP(servername) ? {} : { servername }),
          rejectUnauthorized: false,
        });
        socket.setTimeout(VETTING_LIMITS.tlsTimeoutMs, () => finish({ ok: false, issuer: null, validFrom: null, validTo: null, error: "TLS handshake timed out", servername }));
        socket.once("secureConnect", () => {
          const cert = socket.getPeerCertificate();
          const issuer = cert && cert.issuer ? (cert.issuer.O ?? cert.issuer.CN ?? null) : null;
          const validFrom = cert?.valid_from ? new Date(cert.valid_from) : null;
          const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
          finish({
            ok: socket.authorized,
            issuer: typeof issuer === "string" ? issuer : null,
            validFrom: validFrom && !Number.isNaN(validFrom.getTime()) ? validFrom : null,
            validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo : null,
            error: socket.authorized ? null : (socket.authorizationError ? String(socket.authorizationError) : null),
            servername,
          });
        });
        socket.once("error", (err) => finish({ ok: false, issuer: null, validFrom: null, validTo: null, error: errorMessage(err), servername }));
      }).then((info) => {
        // An unverified chain is a warning for checkTls, not a probe failure: keep ok=false, clear the error.
        if (!info.ok && info.validTo) return { ...info, error: null };
        return info;
      });
    },

    async rdap(domain) {
      const sourceUrl = `${rdapBaseUrl()}/domain/${encodeURIComponent(domain.toLowerCase())}`;
      const response = await deps.fetchJson(sourceUrl);
      if (!response) return { registeredAt: null, registrar: null, sourceUrl, error: "RDAP request failed (network)" };
      if (response.status === 404) return { registeredAt: null, registrar: null, sourceUrl, error: null };
      if (response.status < 200 || response.status >= 300) {
        return { registeredAt: null, registrar: null, sourceUrl, error: `RDAP answered HTTP ${response.status}` };
      }
      return parseRdap(response.json, sourceUrl);
    },

    async wayback(domain) {
      const sourceUrl = `${waybackCdxUrl()}?url=${encodeURIComponent(domain.toLowerCase())}&output=json&fl=timestamp&limit=1`;
      const response = await deps.fetchJson(sourceUrl);
      if (!response) return { firstCaptureAt: null, sourceUrl, error: "Wayback CDX request failed (network or timeout)" };
      if (response.status < 200 || response.status >= 300) {
        return { firstCaptureAt: null, sourceUrl, error: `Wayback CDX answered HTTP ${response.status}` };
      }
      return parseCdx(response.json, sourceUrl);
    },

    now: () => new Date(),
  };

  if (placesEnabled()) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY!.trim();
    deps.placesSearch = (input) => searchPlace(input, { fetchJson: deps.fetchJson, apiKey, now: deps.now() });
  }
  return deps;
}
