type TrustProxyValue = boolean | number | string;

export function trustProxySetting(env: NodeJS.ProcessEnv = process.env): TrustProxyValue {
  const raw = env.TRUST_PROXY?.trim();
  if (raw) {
    const lower = raw.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0) return numeric;
    return raw;
  }

  if (
    env.RAILWAY_PUBLIC_DOMAIN ||
    env.RAILWAY_STATIC_URL ||
    env.FLY_APP_NAME ||
    env.RENDER_EXTERNAL_URL
  ) {
    return 1;
  }

  return false;
}

/**
 * A request carrying X-Forwarded-For while trust proxy is off means every
 * caller shares the proxy's IP: per-IP rate limits collapse into one bucket
 * and one busy venue locks everyone out. Returns true when that should be
 * flagged (the caller logs it once).
 */
export function forwardedForIgnored(
  headers: Record<string, string | string[] | undefined>,
  trustSetting: TrustProxyValue,
): boolean {
  if (trustSetting !== false) return false;
  const forwarded = headers["x-forwarded-for"];
  return Boolean(Array.isArray(forwarded) ? forwarded.length : forwarded?.trim());
}
