/**
 * Shared error types for the still-image generation providers.
 *
 * Kept in its own module so provider clients (OpenAI, Gemini) can throw the
 * same errors without importing each other.
 */

/** Thrown when the provider refused the prompt or output on safety grounds. */
export class StillImageBlockedError extends Error {
  readonly model: string | null;

  constructor(message: string, model: string | null = null) {
    super(message);
    this.name = "StillImageBlockedError";
    this.model = model;
  }
}

/**
 * Thrown when a provider HTTP call fails. `retryWithFallbackModel` marks the
 * failures that mean "this model is unavailable right now" (or did not answer
 * in time), which lets the caller fall through to the next model in the
 * configured chain. `status` is 0 when no HTTP response arrived (timeout or
 * network error).
 */
export class StillImageRequestError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryWithFallbackModel: boolean;
  readonly timedOut: boolean;
  readonly model: string | null;

  constructor(params: {
    message: string;
    status: number;
    body: string;
    retryWithFallbackModel: boolean;
    timedOut?: boolean;
    model?: string | null;
  }) {
    super(params.message);
    this.name = "StillImageRequestError";
    this.status = params.status;
    this.body = params.body;
    this.retryWithFallbackModel = params.retryWithFallbackModel;
    this.timedOut = params.timedOut ?? false;
    this.model = params.model ?? null;
  }
}

/** True for the DOMException/Error a fetch rejects with when its AbortSignal fires. */
export function isAbortOrTimeoutError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Model ids whose failures should move the chain to the next model. Only an
 * explicit "this model does not exist / is not available to you" answer, a
 * 404, a 429 rate limit, a 5xx outage, or no answer at all qualify. A plain
 * 400 that merely mentions "model" or an unsupported parameter value is a
 * request bug, and silently rerouting production to a weaker model would hide
 * it, so it does not.
 */
const MODEL_UNAVAILABLE_CODES = new Set([
  "model_not_found",
  "invalid_model",
  "model_not_available",
  "unsupported_model",
  "NOT_FOUND",
  "UNAVAILABLE",
]);

function errorCodesFromBody(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; status?: unknown; type?: unknown };
    };
    return [parsed.error?.code, parsed.error?.status, parsed.error?.type]
      .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
      .map(String);
  } catch {
    return [];
  }
}

export function isModelAvailabilityFailure(status: number, body: string): boolean {
  if (status === 0 || status === 404 || status === 429 || status >= 500) return true;
  if (status === 400 || status === 403) {
    return errorCodesFromBody(body).some((code) => MODEL_UNAVAILABLE_CODES.has(code));
  }
  return false;
}

/**
 * A storage read or write failed while assembling or saving a gallery. Kept
 * distinct from "the photos are missing" so a transient bucket outage is not
 * reported to the couple as a problem with their photos.
 */
export class GalleryStorageError extends Error {
  readonly objectKey: string | null;

  constructor(message: string, objectKey: string | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GalleryStorageError";
    this.objectKey = objectKey;
  }
}

/** The session ran past SESSION_DEADLINE_MS and was stopped. */
export class SessionDeadlineError extends Error {
  readonly deadlineMs: number;

  constructor(deadlineMs: number) {
    super(`Gallery session exceeded its ${Math.round(deadlineMs / 1000)}s deadline`);
    this.name = "SessionDeadlineError";
    this.deadlineMs = deadlineMs;
  }
}

const RENDER_MODEL = Symbol.for("dreemer.renderModel");

/** Remember which image model an error came from (render telemetry reads it back). */
export function tagErrorWithModel<T>(err: T, model: string): T {
  if (err && typeof err === "object" && !(RENDER_MODEL in err)) {
    Object.defineProperty(err, RENDER_MODEL, { value: model, enumerable: false });
  }
  return err;
}

/** The image model an error came from, when known. */
export function modelForError(err: unknown): string | null {
  if (err && typeof err === "object") {
    const tagged = (err as Record<symbol, unknown>)[RENDER_MODEL];
    if (typeof tagged === "string") return tagged;
    const model = (err as { model?: unknown }).model;
    if (typeof model === "string" && model) return model;
  }
  return null;
}
