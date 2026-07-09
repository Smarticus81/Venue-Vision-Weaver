export function clerkPublishableKey(): string {
  return (
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

/**
 * The Clerk frontend-API origin is base64-encoded inside the publishable key
 * (`pk_test_`/`pk_live_` + base64("<host>$")). The CSP must allow it for
 * clerk-js to load and talk to Clerk from the browser.
 */
export function clerkFrontendApiOrigin(): string | null {
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/=]+)$/.exec(clerkPublishableKey());
  if (!match) return null;
  try {
    const host = Buffer.from(match[1], "base64").toString("utf8").replace(/\$$/, "");
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
      return null;
    }
    return `https://${host}`;
  } catch {
    return null;
  }
}

/**
 * Production Clerk keys only work on the instance's domain (and subdomains).
 * When APP_BASE_URL points anywhere else — e.g. the *.up.railway.app URL
 * while the key belongs to the custom domain — browsers get a 400 from
 * Clerk's API and owner sign-in pages cannot initialize. Returns the
 * expected domain when such a mismatch is detected, otherwise null.
 */
export function clerkDomainMismatch(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!clerkPublishableKey().startsWith("pk_live_")) return null;
  const origin = clerkFrontendApiOrigin();
  if (!origin) return null;
  const domain = new URL(origin).hostname.replace(/^clerk\./, "");
  const base = env.APP_BASE_URL?.trim();
  if (!base) return null;
  try {
    const hostname = new URL(base.includes("://") ? base : `https://${base}`).hostname.toLowerCase();
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return null;
    return domain;
  } catch {
    return null;
  }
}
