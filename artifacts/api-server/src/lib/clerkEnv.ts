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
