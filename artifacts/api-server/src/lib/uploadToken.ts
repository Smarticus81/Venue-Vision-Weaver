import crypto from "crypto";

const TOKEN_TTL_MS = 20 * 60 * 1000;

export const COUPLE_UPLOAD_TOKEN_TTL_MS = TOKEN_TTL_MS;

function uploadTokenSecret(): string {
  // SESSION_SECRET / OWNER_SESSION_SECRET are legacy aliases kept for one
  // release so an existing deploy keeps verifying tokens after the rename.
  const secret =
    process.env.UPLOAD_TOKEN_SECRET ??
    process.env.SESSION_SECRET ??
    process.env.OWNER_SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("UPLOAD_TOKEN_SECRET or SESSION_SECRET must be set in production.");
  }
  return "dreemer-local-upload-token";
}

function signPayload(payload: string): string {
  return crypto
    .createHmac("sha256", uploadTokenSecret())
    .update(payload)
    .digest("base64url");
}

export function createCoupleUploadToken(venueSlug: string, now = Date.now()): string {
  const expiresAt = now + TOKEN_TTL_MS;
  const payload = `couple:${venueSlug}:${expiresAt}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signPayload(payload)}`;
}

/**
 * Verify a couple upload token for a venue and return its expiry (epoch ms),
 * or null when the token is malformed, forged, for another venue, or expired.
 * The expiry lets the upload-intent row live exactly as long as the token
 * window instead of a blanket 24 hours.
 */
export function coupleUploadTokenExpiry(
  token: string,
  venueSlug: string,
  now = Date.now(),
): number | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  let payload = "";
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const [purpose, slug, expiresRaw] = payload.split(":");
  const expiresAt = Number(expiresRaw);
  if (purpose !== "couple" || slug !== venueSlug || !Number.isFinite(expiresAt)) {
    return null;
  }
  if (expiresAt < now) return null;

  const expected = signPayload(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  const valid =
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  return valid ? expiresAt : null;
}

export function verifyCoupleUploadToken(token: string, venueSlug: string, now = Date.now()): boolean {
  return coupleUploadTokenExpiry(token, venueSlug, now) !== null;
}
