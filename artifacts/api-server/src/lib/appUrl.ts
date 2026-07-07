import { logger } from "./logger.js";

const PLACEHOLDER_HOSTS = new Set([
  "your-domain.com",
  "example.com",
  "localhost",
  "127.0.0.1",
]);

function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withProto = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    return u.origin;
  } catch {
    return null;
  }
}

function isPlaceholderHost(hostname: string): boolean {
  return PLACEHOLDER_HOSTS.has(hostname.toLowerCase());
}

let warnedPlaceholder = false;

/**
 * Public URL for share links, emails, and Stripe redirects.
 * Prefers APP_BASE_URL / PUBLIC_APP_URL when set to a real host;
 * otherwise uses Railway's injected domain in production.
 */
export function getAppBaseUrl(): string {
  const candidates = [
    process.env.APP_BASE_URL,
    process.env.PUBLIC_APP_URL,
    process.env.RAILWAY_STATIC_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
      : undefined,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const origin = normalizeOrigin(raw);
    if (!origin) continue;
    const host = new URL(origin).hostname;
    if (isPlaceholderHost(host)) continue;
    return origin;
  }

  const fallback = normalizeOrigin(process.env.APP_BASE_URL ?? "") ?? "http://localhost:5000";
  const host = new URL(fallback).hostname;

  if (
    process.env.NODE_ENV === "production" &&
    isPlaceholderHost(host) &&
    !warnedPlaceholder
  ) {
    warnedPlaceholder = true;
    logger.error(
      {
        appBaseUrl: process.env.APP_BASE_URL,
        railwayPublicDomain: process.env.RAILWAY_PUBLIC_DOMAIN,
      },
      "APP_BASE_URL is a placeholder - set APP_BASE_URL or RAILWAY_PUBLIC_DOMAIN to your live site URL for email and share links",
    );
  }

  return fallback;
}

export function shareUrlForToken(shareToken: string | null | undefined): string {
  if (!shareToken) return getAppBaseUrl();
  return `${getAppBaseUrl()}/v/${shareToken}`;
}

export function ownerProfileUrlForSlug(slug: string): string {
  return `${getAppBaseUrl()}/profile/${slug}`;
}

