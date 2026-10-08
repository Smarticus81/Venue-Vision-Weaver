import {
  DISPOSABLE_DOMAINS,
  DISPOSABLE_PATTERNS,
  FREE_MAIL_DOMAINS,
  MX_PROVIDERS,
  ROLE_LOCAL_PARTS,
} from "./lists.js";

/**
 * Pure string helpers for domains, mailboxes, phones, and prospect websites
 * (vetting.md 1.3). No network, no database.
 */

/** Second-level labels that act like a public suffix under a two-letter TLD (co.uk, com.au, ...). */
const SECOND_LEVEL_SUFFIXES = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);

/**
 * Last two labels of a hostname, or last three when the second-level label is
 * a known public suffix under a 2-letter TLD. Lowercases, strips a leading
 * "www." and a trailing dot.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1]!;
  const sld = labels[labels.length - 2]!;
  if (tld.length === 2 && SECOND_LEVEL_SUFFIXES.has(sld)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

const EMAIL_RE = /^([^\s@]+)@([^\s@]+\.[^\s@]{2,})$/;

/** Lowercased { local, domain }, or null when the address is malformed. */
export function splitEmail(email: string): { local: string; domain: string } | null {
  const match = email.trim().toLowerCase().match(EMAIL_RE);
  if (!match) return null;
  return { local: match[1]!, domain: match[2]! };
}

const FREE_MAIL = new Set(FREE_MAIL_DOMAINS);
const DISPOSABLE = new Set(DISPOSABLE_DOMAINS);

export function isFreeMail(domain: string): boolean {
  const lower = domain.trim().toLowerCase();
  return FREE_MAIL.has(lower) || FREE_MAIL.has(registrableDomain(lower));
}

export function isDisposable(domain: string): boolean {
  const lower = domain.trim().toLowerCase();
  return DISPOSABLE.has(lower) || DISPOSABLE.has(registrableDomain(lower)) || DISPOSABLE_PATTERNS.test(lower);
}

const ROLE = new Set(ROLE_LOCAL_PARTS);

/**
 * Role mailbox when the local part (minus digits, separators and a +suffix)
 * is a role word, or when every separator-delimited token is one
 * ("weddings.team"). "dana" and "dana.whitfield" are named.
 */
export function isRoleMailbox(local: string): boolean {
  const base = local.toLowerCase().replace(/\+.*$/, "").replace(/\d+/g, "");
  const joined = base.replace(/[.\-_]/g, "");
  if (!joined) return false;
  if (ROLE.has(joined)) return true;
  const tokens = base.split(/[.\-_]+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => ROLE.has(token));
}

/** Provider label for a set of MX exchanges; "other" when none is recognised. */
export function mxProvider(exchanges: string[]): { provider: string; freeMail: boolean } {
  for (const exchange of exchanges) {
    const host = exchange.trim().toLowerCase().replace(/\.$/, "");
    for (const rule of MX_PROVIDERS) {
      if (rule.pattern.test(host)) return { provider: rule.provider, freeMail: Boolean(rule.freeMail) };
    }
  }
  return { provider: "other", freeMail: false };
}

/**
 * Digits only. A 10-digit number or an 11-digit number with a leading 1 is a
 * US number (returned as 10 digits). Other lengths are accepted only with an
 * explicit "+" prefix (11-15 digits). Anything else is null.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (trimmed.startsWith("+") && digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Canonical https URL for a prospect website as agents type it: prepends the
 * scheme when missing ("www.venue.com", "venue.com/weddings"), requires a
 * dotted hostname with valid labels, lowercases the host, drops the fragment.
 * Null when the value cannot be a public website.
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z0-9.-]+:\d+/i.test(value)) return null; // mailto:, javascript:, ...
    value = `https://${value.replace(/^\/+/, "")}`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const isIpv6 = host.startsWith("[");
  if (!isIpv6) {
    const labels = host.split(".");
    if (labels.length < 2 || labels.some((label) => !HOST_LABEL.test(label))) return null;
    const tld = labels[labels.length - 1]!;
    if (!/^[a-z]{2,}$/i.test(tld) && !/^\d{1,3}$/.test(tld)) return null;
  }
  url.hostname = host;
  url.hash = "";
  return url.toString();
}

/** registrableDomain of the prospect's website, or null when there is none. */
export function websiteDomain(website: string | null | undefined): string | null {
  const normalized = normalizeWebsiteUrl(website);
  if (!normalized) return null;
  try {
    return registrableDomain(new URL(normalized).hostname);
  } catch {
    return null;
  }
}

/** Hostname of a URL without a leading "www.", or the input when it is not a URL. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
