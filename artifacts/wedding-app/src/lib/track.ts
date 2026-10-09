import {
  recordFunnelEvent,
  type FunnelEventBody,
  type FunnelEventBodyEvent,
} from "@workspace/api-client-react";

/*
 * Owner-funnel event tracking (POST /api/events). Fire-and-forget: a failed
 * or rate-limited call never surfaces to the visitor. The first-touch source
 * (utm, claim link, referrer) is captured once per browser and sent with
 * every event so the growth loop can attribute signups to outreach.
 */

export type FunnelEventName = FunnelEventBodyEvent;

export interface FirstTouch {
  /** Short attribution label, max 80 chars: "claim", "utm:newsletter/email", "referrer:example.com", "direct". */
  source: string;
  /** ISO timestamp of the first visit. */
  at: string;
  /** Path (with query) of the first page seen. */
  landing: string;
  /** Referrer hostname, when any. */
  referrer: string | null;
  utm: Record<string, string>;
  claimToken: string | null;
}

export const FIRST_TOUCH_KEY = "dreemer:first-touch";
const SOURCE_MAX = 80;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

function truncate(text: string, max = SOURCE_MAX): string {
  return text.length > max ? text.slice(0, max) : text;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Pure: derive the first-touch record from the page URL and referrer. */
export function deriveFirstTouch(pageUrl: string, referrer: string | null, now: Date = new Date()): FirstTouch {
  let url: URL;
  try {
    url = new URL(pageUrl, "http://localhost");
  } catch {
    url = new URL("http://localhost/");
  }
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = url.searchParams.get(key)?.trim();
    if (value) utm[key.replace("utm_", "")] = truncate(value, 60);
  }
  const claimMatch = /^\/claim\/([^/?#]+)/.exec(url.pathname);
  const claimToken = claimMatch ? decodeURIComponent(claimMatch[1]) : url.searchParams.get("claim")?.trim() || null;
  const ref = url.searchParams.get("ref")?.trim() || null;
  const referrerHost = hostOf(referrer);
  const ownHost = url.hostname;

  let source: string;
  if (claimToken) source = "claim";
  else if (utm.source) source = `utm:${utm.source}${utm.medium ? `/${utm.medium}` : ""}`;
  else if (ref) source = `ref:${ref}`;
  else if (referrerHost && referrerHost !== ownHost.replace(/^www\./, "")) source = `referrer:${referrerHost}`;
  else source = "direct";

  return {
    source: truncate(source),
    at: now.toISOString(),
    landing: truncate(`${url.pathname}${url.search}`, 200),
    referrer: referrerHost,
    utm,
    claimToken,
  };
}

function readStoredFirstTouch(): FirstTouch | null {
  try {
    const raw = localStorage.getItem(FIRST_TOUCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirstTouch>;
    if (typeof parsed?.source !== "string" || typeof parsed?.at !== "string") return null;
    return {
      source: truncate(parsed.source),
      at: parsed.at,
      landing: typeof parsed.landing === "string" ? parsed.landing : "/",
      referrer: typeof parsed.referrer === "string" ? parsed.referrer : null,
      utm: parsed.utm && typeof parsed.utm === "object" ? (parsed.utm as Record<string, string>) : {},
      claimToken: typeof parsed.claimToken === "string" ? parsed.claimToken : null,
    };
  } catch {
    return null;
  }
}

/**
 * Remember the first touch for this browser (once). A claim link always
 * wins over an earlier anonymous visit so outreach attribution survives a
 * prospect who browsed first and clicked their email later.
 */
export function rememberFirstTouch(): FirstTouch | null {
  if (typeof window === "undefined") return null;
  const current = deriveFirstTouch(window.location.href, document.referrer || null);
  const stored = readStoredFirstTouch();
  const next = !stored || (current.claimToken && !stored.claimToken) ? current : stored;
  try {
    if (next !== stored) localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(next));
  } catch {
    /* private mode or blocked storage: the event still carries the live value */
  }
  return next;
}

export function getFirstTouch(): FirstTouch | null {
  if (typeof window === "undefined") return null;
  return readStoredFirstTouch() ?? rememberFirstTouch();
}

/** Pure: assemble the request body for POST /api/events. */
export function buildFunnelEvent(
  event: FunnelEventName,
  properties: Record<string, unknown> | undefined,
  firstTouch: FirstTouch | null,
  path: string,
): FunnelEventBody {
  const body: FunnelEventBody = {
    event,
    properties: {
      ...properties,
      path: truncate(path, 200),
      ...(firstTouch
        ? {
            firstTouch: {
              source: firstTouch.source,
              at: firstTouch.at,
              landing: firstTouch.landing,
              referrer: firstTouch.referrer,
              utm: firstTouch.utm,
              claimToken: firstTouch.claimToken,
            },
          }
        : {}),
    },
  };
  if (firstTouch) body.source = truncate(firstTouch.source);
  return body;
}

/** Record a funnel event. Never throws, never blocks navigation. */
export function track(event: FunnelEventName, properties?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    const body = buildFunnelEvent(event, properties, getFirstTouch(), window.location.pathname + window.location.search);
    void recordFunnelEvent(body, { keepalive: true }).catch(() => undefined);
  } catch {
    /* tracking must never break the page */
  }
}

/** Record an event once per browser tab (e.g. landing_view survives re-renders and back navigation). */
export function trackOnce(key: string, event: FunnelEventName, properties?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const storageKey = `dreemer:tracked:${key}`;
  try {
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, "1");
  } catch {
    /* fall through: without sessionStorage we still record the event */
  }
  track(event, properties);
}
