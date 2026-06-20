import crypto from "crypto";

const TOKEN_TTL_MS = 20 * 60 * 1000;

function uploadTokenSecret(): string {
  const secret =
    process.env.UPLOAD_TOKEN_SECRET ??
    process.env.SESSION_SECRET ??
    process.env.OWNER_SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("UPLOAD_TOKEN_SECRET or SESSION_SECRET must be set in production.");
  }
  return "glimpse-local-upload-token";
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

export function verifyCoupleUploadToken(token: string, venueSlug: string, now = Date.now()): boolean {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;

  let payload = "";
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return false;
  }

  const [purpose, slug, expiresRaw] = payload.split(":");
  const expiresAt = Number(expiresRaw);
  if (purpose !== "couple" || slug !== venueSlug || !Number.isFinite(expiresAt)) {
    return false;
  }
  if (expiresAt < now) return false;

  const expected = signPayload(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
