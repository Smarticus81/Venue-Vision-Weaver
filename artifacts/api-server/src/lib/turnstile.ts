import { logger } from "./logger.js";

/*
 * Cloudflare Turnstile verification for public session creation.
 *
 * Optional by design (step0-merge-decisions E7): enforcement only switches on
 * when TURNSTILE_SECRET_KEY is set. The web app reads the site key from the
 * public venue payload (lib/venueResponse.ts turnstileSiteKey) and attaches
 * the response token to CreateSessionBody.turnstileToken.
 */

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerification =
  | { ok: true }
  | { ok: false; reason: "missing_token" | "invalid_token" | "verify_failed"; errorCodes: string[] };

export interface TurnstileDeps {
  fetch?: typeof fetch;
  secretKey?: string | null;
  timeoutMs?: number;
}

export function turnstileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY?.trim());
}

/**
 * Verify a Turnstile response token with Cloudflare. Returns ok when the
 * secret is unset (feature off). Network failures are reported as
 * verify_failed so the route can decide whether to fail open or closed.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp: string | null | undefined,
  deps: TurnstileDeps = {},
): Promise<TurnstileVerification> {
  const secret = (deps.secretKey === undefined ? process.env.TURNSTILE_SECRET_KEY : deps.secretKey)?.trim();
  if (!secret) return { ok: true };

  const response = token?.trim();
  if (!response) return { ok: false, reason: "missing_token", errorCodes: ["missing-input-response"] };

  const doFetch = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 6_000);
  try {
    const params = new URLSearchParams({ secret, response });
    if (remoteIp && remoteIp !== "unknown") params.set("remoteip", remoteIp);
    const res = await doFetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Turnstile siteverify returned a non-2xx status");
      return { ok: false, reason: "verify_failed", errorCodes: [`http-${res.status}`] };
    }
    const payload = (await res.json().catch(() => null)) as
      | { success?: boolean; "error-codes"?: string[] }
      | null;
    if (payload?.success === true) return { ok: true };
    const errorCodes = Array.isArray(payload?.["error-codes"]) ? payload["error-codes"] : [];
    const transient = errorCodes.some((code) => code === "internal-error" || code === "timeout-or-duplicate");
    return { ok: false, reason: transient ? "verify_failed" : "invalid_token", errorCodes };
  } catch (err) {
    logger.warn({ err }, "Turnstile siteverify request failed");
    return { ok: false, reason: "verify_failed", errorCodes: ["request-failed"] };
  } finally {
    clearTimeout(timer);
  }
}
