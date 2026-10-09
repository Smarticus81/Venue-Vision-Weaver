/**
 * Reads the API's ErrorEnvelope ({ error, code }) off whatever the generated
 * client or a raw fetch threw, and maps the spend codes to owner-facing copy
 * (the server's 402 text is written for couples).
 */

export interface ApiFailure {
  status: number | null;
  message: string | null;
  code: string | null;
}

export function describeApiError(err: unknown): ApiFailure {
  if (!err || typeof err !== "object") {
    return { status: null, message: typeof err === "string" ? err : null, code: null };
  }
  const anyErr = err as {
    status?: unknown;
    data?: unknown;
    message?: unknown;
  };
  const data =
    anyErr.data && typeof anyErr.data === "object"
      ? (anyErr.data as { error?: unknown; code?: unknown })
      : null;
  const status = typeof anyErr.status === "number" ? anyErr.status : null;
  const message =
    data && typeof data.error === "string"
      ? data.error
      : typeof anyErr.message === "string"
        ? anyErr.message
        : null;
  const code = data && typeof data.code === "string" ? data.code : null;
  return { status, message, code };
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const { message } = describeApiError(err);
  if (!message) return fallback;
  // The generated client prefixes "HTTP 4xx ...: " when no envelope exists.
  return message.replace(/^HTTP \d{3}[^:]*:\s*/, "") || fallback;
}

export function isNotImplemented(err: unknown): boolean {
  return describeApiError(err).status === 501;
}

/**
 * True when the server does not offer an endpoint at all: 501, or the API's
 * catch-all `{ error: "Not found" }` 404 for an unmatched /api path. A 404
 * about a specific record ("Session not found") is a real answer, not this.
 */
export function isFeatureUnavailable(err: unknown): boolean {
  const { status, message, code } = describeApiError(err);
  if (status === 501) return true;
  return status === 404 && !code && (message === "Not found" || message === null);
}

export interface OwnerSpendCopy {
  title: string;
  body: string;
  /** Which upgrade action fixes it. */
  fix: "plan" | "credits";
}

/** Owner-specific copy for the two 402 reasons the session endpoint returns. */
export function ownerSpendCopy(code: string | null | undefined, venueName?: string | null): OwnerSpendCopy | null {
  const at = venueName ? ` at ${venueName}` : "";
  switch (code) {
    case "trial_expired":
      return {
        title: "Your free trial has ended",
        body: `Pick a plan or add a credit pack to keep making galleries${at}. Your remaining credits stay on the account.`,
        fix: "plan",
      };
    case "insufficient_credits":
      return {
        title: "You're out of credits",
        body: `Each gallery uses one credit. Add a pack of ten or pick a monthly plan to keep going${at}.`,
        fix: "credits",
      };
    default:
      return null;
  }
}
