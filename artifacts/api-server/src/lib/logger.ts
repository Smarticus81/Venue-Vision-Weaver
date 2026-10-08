import crypto from "crypto";
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Path segments that look like bearer-style tokens (share tokens, upload
 * tokens, unsubscribe and claim tokens) are replaced before a URL is logged.
 * Query strings are dropped entirely. Object keys such as `uuid.jpg` keep
 * their extension and are left alone: they are not credentials.
 */
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;
const TOKEN_PATH_PREFIXES = ["/v/", "/by-token/", "/unsubscribe/", "/claim/", "/tokens/"];

export function redactUrlForLog(url: string | undefined): string | undefined {
  if (!url) return url;
  const [path] = url.split("?");
  const segments = path.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) continue;
    const prefix = `/${segments[index - 1]}/`;
    const afterTokenPrefix = TOKEN_PATH_PREFIXES.includes(prefix);
    if ((afterTokenPrefix && segment.length >= 8) || TOKEN_SEGMENT.test(segment)) {
      segments[index] = "[redacted]";
    }
  }
  return segments.join("/");
}

/** Stable short fingerprint so an address can be correlated across lines without being readable. */
export function fingerprintForLog(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12)}`;
}

const RECIPIENT_KEYS = ["email", "to", "coupleEmail", "ownerEmail", "recipient", "contactEmail"];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      ...RECIPIENT_KEYS,
      ...RECIPIENT_KEYS.map((key) => `*.${key}`),
    ],
    censor: (value: unknown, path: string[]) => {
      const key = path[path.length - 1] ?? "";
      if (RECIPIENT_KEYS.includes(key) && typeof value === "string") return fingerprintForLog(value);
      return "[Redacted]";
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
