import { stripTags, resolveUrl } from "../outreach/venueResearch.js";
import {
  CANADA_POSTAL,
  CANADA_PROVINCES,
  COMING_SOON,
  MARKETPLACE_HOSTS,
  OWNER_TITLE_RE,
  PARKING_SIGNATURES,
  SOCIAL_HOSTS,
  WEDDING_WORDS,
  normalizeCountryCode,
} from "./lists.js";
import {
  isDisposable,
  isFreeMail,
  isRoleMailbox,
  mxProvider,
  normalizePhone,
  registrableDomain,
  splitEmail,
  websiteDomain,
} from "./domain.js";
import type { VettingCheck, VettingCheckKey, VettingEvidence } from "./types.js";

/**
 * One pure function per Tier A check (vetting.md 1.4). Every input has
 * already been fetched by VettingDeps; nothing here touches the network, so
 * the whole file runs against the offline fixtures in tests.
 */

export interface FetchedSite {
  requestedUrl: string;
  /** Null when DNS/connect/timeout failed. */
  finalUrl: string | null;
  /** HTTP status of the final hop, null when unreachable. */
  status: number | null;
  contentType: string | null;
  /** Homepage first, then up to 2 subpages (contact/about/team/faq); empty on non-2xx. */
  pages: Array<{ url: string; html: string; text: string }>;
  /** Network/DNS/timeout/SSRF-guard message; null for HTTP responses. */
  error: string | null;
}

export interface TlsInfo {
  ok: boolean;
  issuer: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  error: string | null;
  servername: string;
}

export interface RdapInfo {
  registeredAt: Date | null;
  registrar: string | null;
  sourceUrl: string;
  error: string | null;
}

export interface WaybackInfo {
  firstCaptureAt: Date | null;
  sourceUrl: string;
  error: string | null;
}

export interface DnsInfo {
  mx: string[];
  spf: boolean;
  dmarc: boolean;
  error: string | null;
}

export interface NapFindings {
  name: string | null;
  phone: string | null;
  address: string | null;
  /** "City, ST" when the site states it (JSON-LD addressLocality/addressRegion); feeds the Places query. */
  locality: string | null;
  country: string | null;
  sourceUrl: string | null;
  sourceKind: "json_ld" | "website";
}

/* ————— Small text helpers ————— */

export function visibleWordCount(text: string): number {
  return text
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word)).length;
}

/** Up to `radius` characters either side of the first case-insensitive match, whitespace collapsed. */
export function excerptAround(text: string, needle: string, radius = 60): string {
  if (!needle) return text.slice(0, radius * 2).replace(/\s+/g, " ").trim();
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return text.slice(0, radius * 2).replace(/\s+/g, " ").trim();
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

function clip(value: string, max = 240): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function evidence(url: string, observedAt: Date, excerpt?: string | null): VettingEvidence {
  return { url, observedAt: observedAt.toISOString(), ...(excerpt ? { excerpt: clip(excerpt) } : {}) };
}

function check(
  key: VettingCheckKey,
  outcome: VettingCheck["outcome"],
  points: number,
  detail: string,
  options: { hardFail?: boolean; evidence?: VettingEvidence[]; data?: VettingCheck["data"] } = {},
): VettingCheck {
  return {
    key,
    outcome,
    points,
    hardFail: options.hardFail ?? false,
    detail,
    evidence: options.evidence ?? [],
    ...(options.data ? { data: options.data } : {}),
  };
}

function titleOf(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1] ?? "").replace(/\s+/g, " ").trim() : "";
}

function hrefsAndSrcs(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/\b(?:href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const resolved = resolveUrl(pageUrl, match[2] ?? match[3] ?? match[4]);
    if (resolved) out.push(resolved);
  }
  return out;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/* ————— Site ————— */

export function checkSiteReachable(site: FetchedSite, website: string | null, now: Date): VettingCheck {
  const key = "site_reachable";
  if (!website) return check(key, "fail", 0, "no website on file", { hardFail: true });
  if (!site.finalUrl) {
    return check(key, "fail", 0, site.error ?? `could not connect to ${website}`, {
      hardFail: true,
      evidence: [evidence(site.requestedUrl, now, site.error ?? undefined)],
    });
  }
  const status = site.status ?? 0;
  const ev = [evidence(site.finalUrl, now, status ? `HTTP ${status}` : undefined)];
  if (status === 404 || status === 410) {
    return check(key, "fail", 0, `site answered ${status}; the page does not exist`, { hardFail: true, evidence: ev });
  }
  if (status === 401 || status === 403 || status === 406 || status === 429 || status >= 500) {
    return check(
      key,
      "error",
      0,
      `site answered ${status}; likely bot protection or an outage. Re-run later or override after a manual look.`,
      { evidence: ev, data: { status } },
    );
  }
  if (status < 200 || status >= 300) {
    return check(key, "error", 0, `site answered ${status}; could not evaluate the page`, { evidence: ev, data: { status } });
  }
  if (site.contentType && !/html|xml/i.test(site.contentType)) {
    return check(key, "fail", 0, `site answered with ${site.contentType.split(";")[0]} instead of an HTML page`, {
      hardFail: true,
      evidence: ev,
    });
  }
  if (site.pages.length === 0) {
    return check(key, "error", 0, "site answered but no page body could be read", { evidence: ev, data: { status } });
  }
  const requestedHost = hostOf(site.requestedUrl);
  const finalHost = hostOf(site.finalUrl);
  if (requestedHost && finalHost && registrableDomain(requestedHost) !== registrableDomain(finalHost)) {
    return check(
      key,
      "warn",
      2,
      `${registrableDomain(requestedHost)} redirects to ${registrableDomain(finalHost)} (another brand or a parent company)`,
      { evidence: ev, data: { status, redirectedTo: registrableDomain(finalHost) } },
    );
  }
  return check(key, "pass", 5, `site reachable (HTTP ${status})`, { evidence: ev, data: { status } });
}

export function checkNotParked(site: FetchedSite, now: Date = new Date()): VettingCheck {
  const key = "site_not_parked";
  const home = site.pages[0];
  if (!home) return check(key, "skip", 0, "no page to inspect");
  const title = titleOf(home.html);
  const haystacks = [home.text, title];
  for (const signature of PARKING_SIGNATURES) {
    for (const hay of haystacks) {
      const match = hay.match(signature);
      if (match) {
        return check(key, "fail", 0, `parked or placeholder page: "${clip(match[0], 80)}"`, {
          hardFail: true,
          evidence: [evidence(home.url, now, excerptAround(hay, match[0]))],
        });
      }
    }
  }
  const words = visibleWordCount(home.text);
  const comingSoon = home.text.match(COMING_SOON) ?? title.match(COMING_SOON);
  if (comingSoon && words < 150) {
    return check(key, "fail", 0, `placeholder page: "${clip(comingSoon[0], 80)}" with almost no content`, {
      hardFail: true,
      evidence: [evidence(home.url, now, excerptAround(home.text, comingSoon[0]))],
    });
  }
  const hasImages = /<img\b/i.test(home.html);
  if (words < 60 && !hasImages) {
    return check(key, "warn", 0, `empty shell: ${words} visible words and no images on the homepage`, {
      evidence: [evidence(home.url, now, clip(home.text, 120))],
      data: { words },
    });
  }
  return check(key, "pass", 0, `real page: ${words} visible words${hasImages ? " and images" : ""}`, {
    evidence: [evidence(home.url, now)],
    data: { words },
  });
}

export function checkTls(tls: TlsInfo | null, finalUrl: string | null, now: Date): VettingCheck {
  const key = "tls_valid";
  if (!finalUrl) return check(key, "skip", 0, "site unreachable; TLS not probed");
  if (finalUrl.startsWith("http:")) return check(key, "warn", 0, "site has no HTTPS", { evidence: [evidence(finalUrl, now)] });
  if (!tls) return check(key, "skip", 0, "TLS not probed");
  const url = `tls://${tls.servername}`;
  if (tls.error) return check(key, "error", 0, `TLS probe failed: ${tls.error}`, { evidence: [evidence(url, now)] });
  if (tls.validTo && tls.validTo.getTime() < now.getTime()) {
    return check(key, "warn", 0, `certificate expired ${tls.validTo.toISOString().slice(0, 10)}`, {
      evidence: [evidence(url, now, `${tls.issuer ?? "unknown issuer"} · valid to ${tls.validTo.toISOString()}`)],
    });
  }
  if (tls.validFrom && tls.validFrom.getTime() > now.getTime()) {
    return check(key, "warn", 0, `certificate not yet valid (from ${tls.validFrom.toISOString().slice(0, 10)})`, {
      evidence: [evidence(url, now)],
    });
  }
  if (!tls.ok) return check(key, "warn", 0, "certificate did not verify (self-signed or wrong name)", { evidence: [evidence(url, now)] });
  return check(key, "pass", 4, `valid certificate from ${tls.issuer ?? "an unknown issuer"}`, {
    evidence: [evidence(url, now, `${tls.issuer ?? "unknown issuer"} · valid to ${tls.validTo?.toISOString() ?? "?"}`)],
    data: { issuer: tls.issuer, validTo: tls.validTo?.toISOString() ?? null },
  });
}

/* ————— Age and history ————— */

export function checkDomainAge(rdap: RdapInfo | null, domain: string, now: Date): VettingCheck {
  const key = "domain_age";
  if (!rdap || rdap.error) {
    return check(key, "error", 0, `RDAP lookup for ${domain} failed${rdap?.error ? `: ${rdap.error}` : ""}`, {
      evidence: rdap ? [evidence(rdap.sourceUrl, now)] : [],
    });
  }
  if (!rdap.registeredAt) {
    return check(key, "skip", 0, `no registration date available for ${domain} (ccTLD without RDAP or not found)`, {
      evidence: [evidence(rdap.sourceUrl, now)],
    });
  }
  const days = daysBetween(rdap.registeredAt, now);
  const registered = rdap.registeredAt.toISOString();
  const ev = [evidence(rdap.sourceUrl, now, `registered ${registered} via ${rdap.registrar ?? "unknown registrar"}`)];
  const data = { registeredAt: registered, ageDays: days, registrar: rdap.registrar, freshDomain: days < 90 };
  if (days >= 730) return check(key, "pass", 15, `${Math.floor(days / 365)}-year-old domain`, { evidence: ev, data });
  if (days >= 365) return check(key, "pass", 10, "1-year-old domain", { evidence: ev, data });
  if (days >= 90) return check(key, "pass", 4, `domain registered ${days} days ago`, { evidence: ev, data });
  return check(key, "warn", 0, `domain registered only ${days} days ago`, { evidence: ev, data });
}

export function checkSiteHistory(wayback: WaybackInfo | null, now: Date): VettingCheck {
  const key = "site_history";
  if (!wayback || wayback.error) {
    return check(key, "error", 0, `Wayback CDX lookup failed${wayback?.error ? `: ${wayback.error}` : ""}`, {
      evidence: wayback ? [evidence(wayback.sourceUrl, now)] : [],
    });
  }
  if (!wayback.firstCaptureAt) {
    return check(key, "skip", 0, "no archive captures; proves nothing", {
      evidence: [evidence(wayback.sourceUrl, now)],
      data: { noCaptures: true },
    });
  }
  const days = daysBetween(wayback.firstCaptureAt, now);
  const stamp = wayback.firstCaptureAt.toISOString();
  const ev = [evidence(wayback.sourceUrl, now, `first capture ${stamp}`)];
  const data = { firstCaptureAt: stamp, ageDays: days };
  if (days >= 730) return check(key, "pass", 6, `archived since ${stamp.slice(0, 4)}`, { evidence: ev, data });
  if (days >= 365) return check(key, "pass", 3, `archived for about a year`, { evidence: ev, data });
  return check(key, "pass", 0, `first archived ${days} days ago`, { evidence: ev, data });
}

/* ————— Mail ————— */

export function checkMx(dns: DnsInfo | null, contactDomain: string, now: Date = new Date()): VettingCheck {
  const key = "mx_present";
  const url = `dns:MX ${contactDomain}`;
  if (!dns || dns.error) {
    return check(key, "error", 0, `DNS lookup for ${contactDomain} failed${dns?.error ? `: ${dns.error}` : ""}`, {
      evidence: [evidence(url, now)],
    });
  }
  if (dns.mx.length === 0) {
    return check(key, "fail", 0, `no MX records on ${contactDomain}; mail would bounce`, {
      hardFail: true,
      evidence: [evidence(url, now, "no MX records")],
    });
  }
  const provider = mxProvider(dns.mx);
  const freeMail = provider.freeMail || isFreeMail(contactDomain);
  return check(
    key,
    "pass",
    freeMail ? 5 : 10,
    freeMail ? `mail on a consumer provider (${provider.provider})` : `business mail via ${provider.provider}`,
    {
      evidence: [evidence(url, now, dns.mx[0])],
      data: { mxProvider: provider.provider, freeMail },
    },
  );
}

export function checkSpfDmarc(dns: DnsInfo | null, contactDomain: string, now: Date = new Date()): VettingCheck {
  const key = "spf_dmarc";
  if (!dns || dns.error) return check(key, "skip", 0, "DNS unavailable; SPF/DMARC not checked");
  if (isFreeMail(contactDomain)) return check(key, "skip", 0, "free-mail domain; SPF/DMARC are the provider's");
  const points = (dns.spf ? 3 : 0) + (dns.dmarc ? 3 : 0);
  const parts = [`SPF ${dns.spf ? "present" : "missing"}`, `DMARC ${dns.dmarc ? "present" : "missing"}`];
  return check(key, dns.spf && dns.dmarc ? "pass" : "warn", points, parts.join(", "), {
    evidence: [evidence(`dns:TXT ${contactDomain}`, now, parts.join(" · "))],
    data: { spf: dns.spf, dmarc: dns.dmarc },
  });
}

export function checkMailboxClass(email: string, website: string | null): VettingCheck {
  const key = "mailbox_class";
  const parts = splitEmail(email);
  if (!parts) return check(key, "fail", 0, "malformed email", { hardFail: true });
  if (isDisposable(parts.domain)) {
    return check(key, "fail", 0, `${parts.domain} is a disposable mailbox provider`, { hardFail: true, data: { disposable: true } });
  }
  const mailDomain = registrableDomain(parts.domain);
  const siteDomain = websiteDomain(website);
  if (siteDomain && mailDomain === siteDomain) {
    return check(key, "pass", 8, `mailbox domain matches the website (${siteDomain})`, {
      data: { domainMatchesWebsite: true, freeMail: false },
    });
  }
  if (isFreeMail(parts.domain)) {
    return check(key, "warn", 0, "free-mail address; lean on other signals", { data: { domainMatchesWebsite: false, freeMail: true } });
  }
  if (!siteDomain) {
    return check(key, "warn", 0, `business mailbox on ${mailDomain}; no website on file to compare it with`, {
      data: { domainMatchesWebsite: false, freeMail: false },
    });
  }
  return check(key, "warn", 0, `mailbox domain ${mailDomain} does not match site ${siteDomain}`, {
    data: { domainMatchesWebsite: false, freeMail: false },
  });
}

export function checkMailboxRole(email: string): VettingCheck {
  const key = "mailbox_role";
  const parts = splitEmail(email);
  if (!parts) return check(key, "warn", 0, "malformed email", { data: { role: false } });
  if (isRoleMailbox(parts.local)) {
    return check(key, "pass", 5, `role mailbox (${parts.local}@) — normal for venues, lower reply rate`, { data: { role: true } });
  }
  return check(key, "pass", 10, `named mailbox (${parts.local}@)`, { data: { role: false } });
}

export function checkEmailPublished(
  site: FetchedSite,
  email: string,
  emailSourceUrl: string | null,
  now: Date = new Date(),
): VettingCheck {
  const key = "email_published";
  const needle = email.trim().toLowerCase();
  for (const page of site.pages) {
    const html = page.html.toLowerCase();
    if (html.includes(needle) || html.includes(`mailto:${needle}`)) {
      const excerpt = page.text.toLowerCase().includes(needle)
        ? excerptAround(page.text, needle)
        : excerptAround(stripTags(page.html.replace(/mailto:/gi, " ")), needle);
      return check(key, "pass", 6, `${email} is published on the venue's own site`, {
        evidence: [evidence(page.url, now, excerpt)],
        data: { published: true },
      });
    }
  }
  return check(
    key,
    "warn",
    0,
    `${email} not found on the venue's own pages${emailSourceUrl ? `; agent cited ${emailSourceUrl}` : ""}`,
    { evidence: emailSourceUrl ? [evidence(emailSourceUrl, now, "agent-cited source, not verified")] : [], data: { published: false } },
  );
}

/* ————— NAP ————— */

const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const US_ADDRESS_RE = /\d{1,6}\s+[A-Z][\w.'’ -]{2,40},?\s+[A-Z][\w.'’ -]{2,30},\s*[A-Z]{2}\s+\d{5}(-\d{4})?/;
const PLACE_TYPES = new Set([
  "localbusiness",
  "eventvenue",
  "place",
  "organization",
  "hotel",
  "restaurant",
  "winery",
  "resort",
  "lodgingbusiness",
  "bedandbreakfast",
  "foodestablishment",
  "touristattraction",
]);

function jsonLdNodes(html: string): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const block of html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []) {
    const inner = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      const data = JSON.parse(inner) as unknown;
      const roots: unknown[] = Array.isArray(data) ? data : [data];
      for (const root of roots) {
        if (!root || typeof root !== "object") continue;
        const record = root as Record<string, unknown>;
        nodes.push(record);
        const graph = Array.isArray(record["@graph"]) ? (record["@graph"] as unknown[]) : [];
        for (const item of graph) {
          if (item && typeof item === "object") nodes.push(item as Record<string, unknown>);
        }
      }
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }
  return nodes;
}

function typeMatches(node: Record<string, unknown>): boolean {
  const raw = node["@type"];
  const types = Array.isArray(raw) ? raw : [raw];
  return types.some((type) => typeof type === "string" && PLACE_TYPES.has(type.toLowerCase()));
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractNap(site: FetchedSite): NapFindings {
  for (const page of site.pages) {
    for (const node of jsonLdNodes(page.html)) {
      const address = (node.address && typeof node.address === "object" && !Array.isArray(node.address)
        ? node.address
        : Array.isArray(node.address) && node.address[0] && typeof node.address[0] === "object"
          ? node.address[0]
          : null) as Record<string, unknown> | null;
      const hasStreet = Boolean(address && str(address.streetAddress));
      if (!typeMatches(node) && !hasStreet) continue;
      const name = str(node.name);
      const phone = str(node.telephone);
      let formatted: string | null = null;
      let locality: string | null = null;
      let country: string | null = null;
      if (address) {
        const parts = [str(address.streetAddress), str(address.addressLocality), str(address.addressRegion), str(address.postalCode)].filter(
          (part): part is string => Boolean(part),
        );
        formatted = parts.length > 0 ? parts.join(", ") : null;
        const city = str(address.addressLocality);
        const region = str(address.addressRegion);
        locality = city ? (region ? `${city}, ${region}` : city) : null;
        const rawCountry = address.addressCountry;
        country =
          typeof rawCountry === "string"
            ? rawCountry
            : rawCountry && typeof rawCountry === "object"
              ? str((rawCountry as Record<string, unknown>).name)
              : null;
      }
      if (name || phone || formatted) {
        return { name, phone, address: formatted, locality, country, sourceUrl: page.url, sourceKind: "json_ld" };
      }
    }
  }
  for (const page of site.pages) {
    const footer = page.text.slice(-3000);
    const phone = footer.match(PHONE_RE)?.[0]?.trim() ?? null;
    const address = footer.match(US_ADDRESS_RE)?.[0]?.replace(/\s+/g, " ").trim() ?? null;
    if (phone || address) {
      return {
        name: null,
        phone,
        address,
        locality: address ? localityFromUsAddress(address) : null,
        country: address ? "US" : null,
        sourceUrl: page.url,
        sourceKind: "website",
      };
    }
  }
  return { name: null, phone: null, address: null, locality: null, country: null, sourceUrl: null, sourceKind: "website" };
}

/** "214 River Road, Hudson, NY 12534" -> "Hudson, NY". */
function localityFromUsAddress(address: string): string | null {
  const match = address.match(/,\s*([A-Z][\w.'’ -]{2,30}),\s*([A-Z]{2})\s+\d{5}/);
  return match ? `${match[1]!.trim()}, ${match[2]}` : null;
}

export function checkNap(nap: NapFindings, prospectPhone: string | null, now: Date = new Date()): VettingCheck {
  const key = "nap";
  const ev = nap.sourceUrl ? [evidence(nap.sourceUrl, now, [nap.phone, nap.address].filter(Boolean).join(" · ") || undefined)] : [];
  if (!nap.phone && !nap.address) {
    return check(key, "warn", 0, "no phone or street address found on the site", { data: { phone: null, address: null } });
  }
  const sitePhone = normalizePhone(nap.phone);
  const recordPhone = normalizePhone(prospectPhone);
  const found = nap.phone && nap.address ? "address and phone on site" : nap.phone ? "phone on site" : "address on site";
  const data = { phone: nap.phone, address: nap.address, source: nap.sourceKind, phoneConsistent: Boolean(sitePhone && recordPhone && sitePhone === recordPhone) };
  if (sitePhone && recordPhone) {
    if (sitePhone === recordPhone) return check(key, "pass", 12, `${found}; phone matches the prospect record`, { evidence: ev, data });
    return check(key, "warn", 8, `${found}; phone on site differs from prospect record`, { evidence: ev, data });
  }
  return check(key, "pass", 8, found, { evidence: ev, data });
}

/* ————— Presence ————— */

export function checkMarketplacePresence(site: FetchedSite, now: Date = new Date()): VettingCheck {
  const key = "marketplace_presence";
  const found = new Map<string, { url: string; pageUrl: string }>();
  for (const page of site.pages) {
    for (const url of hrefsAndSrcs(page.html, page.url)) {
      const host = hostOf(url);
      if (!host) continue;
      for (const rule of MARKETPLACE_HOSTS) {
        if (rule.host.test(host) && !found.has(rule.label)) found.set(rule.label, { url, pageUrl: page.url });
      }
    }
  }
  if (found.size === 0) return check(key, "warn", 0, "no wedding marketplace links or badges on the site");
  const labels = [...found.keys()];
  return check(key, "pass", 8, `listed on ${labels.join(", ")}`, {
    evidence: [...found.entries()].map(([label, hit]) => evidence(hit.url, now, `${label} link on ${hit.pageUrl}`)),
    data: { marketplaces: labels.join(",") },
  });
}

export function checkSocialHandles(site: FetchedSite, now: Date = new Date()): VettingCheck {
  const key = "social_handles";
  const handles = new Map<string, { url: string; pageUrl: string }>();
  for (const page of site.pages) {
    for (const url of hrefsAndSrcs(page.html, page.url)) {
      const host = hostOf(url);
      if (!host) continue;
      for (const rule of SOCIAL_HOSTS) {
        if (!rule.host.test(host)) continue;
        let handle: string | null = null;
        try {
          handle = rule.handleFrom(new URL(url));
        } catch {
          handle = null;
        }
        if (handle) {
          const id = `${rule.label}:${handle}`;
          if (!handles.has(id)) handles.set(id, { url, pageUrl: page.url });
        }
      }
    }
  }
  if (handles.size === 0) return check(key, "warn", 0, "no social profiles linked from the site");
  return check(key, "pass", 4, `social profiles: ${[...handles.keys()].join(", ")}`, {
    evidence: [...handles.entries()].map(([id, hit]) => evidence(hit.url, now, `${id} linked from ${hit.pageUrl}`)),
    data: { handles: [...handles.keys()].join(",") },
  });
}

export function checkWeddingSignal(site: FetchedSite, now: Date = new Date()): VettingCheck {
  const key = "wedding_signal";
  let mentions = 0;
  let firstPage: string | null = null;
  let firstHit: string | null = null;
  for (const page of site.pages) {
    const hits = page.text.match(WEDDING_WORDS) ?? [];
    if (hits.length > 0 && !firstPage) {
      firstPage = page.url;
      firstHit = hits[0] ?? null;
    }
    mentions += hits.length;
  }
  const ev = firstPage ? [evidence(firstPage, now, firstHit ? excerptAround(site.pages.find((p) => p.url === firstPage)!.text, firstHit) : undefined)] : [];
  if (mentions >= 3) return check(key, "pass", 5, `mentions weddings ${mentions} times`, { evidence: ev, data: { mentions } });
  if (mentions > 0) return check(key, "warn", 2, `mentions weddings only ${mentions} time(s)`, { evidence: ev, data: { mentions } });
  return check(key, "warn", 0, "site never mentions weddings — confirm fit", { data: { mentions } });
}

export function checkContactNamePublished(site: FetchedSite, contactName: string | null, now: Date = new Date()): VettingCheck {
  const key = "contact_name_published";
  const name = contactName?.replace(/\s+/g, " ").trim() ?? "";
  if (!name) return check(key, "skip", 0, "no contact name on file");
  const tokens = name.split(" ").filter(Boolean);
  const first = tokens[0] ?? "";
  for (const page of site.pages) {
    const lower = page.text.toLowerCase();
    if (tokens.length >= 2) {
      const index = lower.indexOf(name.toLowerCase());
      if (index >= 0) {
        return check(key, "pass", 4, `"${name}" appears on the site`, {
          evidence: [evidence(page.url, now, excerptAround(page.text, name))],
          data: { verified: true },
        });
      }
    }
    if (first.length >= 2) {
      const firstRe = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      for (const match of page.text.matchAll(firstRe)) {
        const start = Math.max(0, (match.index ?? 0) - 80);
        const end = Math.min(page.text.length, (match.index ?? 0) + first.length + 80);
        const window = page.text.slice(start, end);
        if (OWNER_TITLE_RE.test(window)) {
          return check(key, "pass", 4, `"${first}" appears with a title on the site`, {
            evidence: [evidence(page.url, now, window.replace(/\s+/g, " ").trim())],
            data: { verified: true },
          });
        }
      }
    }
  }
  return check(key, "warn", 0, `'${name}' not found on the site; greeting will be generic until verified`, {
    data: { verified: false },
  });
}

/* ————— Region ————— */

export function checkBlockedRegion(nap: NapFindings, prospectRegion: string | null, blockedCountries: string[]): VettingCheck {
  const key = "blocked_region";
  const blocked = new Set(blockedCountries.map((code) => code.trim().toUpperCase()).filter(Boolean));
  const country = normalizeCountryCode(nap.country);
  const canadaBlocked = blocked.has("CA");
  const canadianHints =
    canadaBlocked &&
    ((nap.address && CANADA_POSTAL.test(nap.address)) ||
      (prospectRegion && (CANADA_POSTAL.test(prospectRegion) || CANADA_PROVINCES.test(prospectRegion))));
  if ((country && blocked.has(country)) || canadianHints) {
    const code = country && blocked.has(country) ? country : "CA";
    const detail =
      code === "CA"
        ? "Canada: CASL consent rules apply; excluded until legal review (policy vetting_blocked_countries)"
        : `${code} is excluded by policy vetting_blocked_countries until legal review`;
    return check(key, "fail", 0, detail, { hardFail: true, data: { country: code } });
  }
  return check(key, "pass", 0, country ? `${country} is not a blocked region` : "no blocked-region signal", {
    data: { country: country ?? null },
  });
}
