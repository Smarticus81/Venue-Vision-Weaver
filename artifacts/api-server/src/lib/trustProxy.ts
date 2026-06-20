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
