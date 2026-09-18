/**
 * Shared error types for the still-image generation providers.
 *
 * Kept in its own module so provider clients (OpenAI, Gemini) can throw the
 * same blocked-content error without importing each other.
 */

/** Thrown when the provider refused the prompt or output on safety grounds. */
export class StillImageBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StillImageBlockedError";
  }
}

/**
 * Thrown when a provider HTTP call fails. `retryWithFallbackModel` marks the
 * failures that mean "this model is unavailable right now", which lets the
 * caller fall through to the next model in the configured chain.
 */
export class StillImageRequestError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryWithFallbackModel: boolean;

  constructor(params: {
    message: string;
    status: number;
    body: string;
    retryWithFallbackModel: boolean;
  }) {
    super(params.message);
    this.name = "StillImageRequestError";
    this.status = params.status;
    this.body = params.body;
    this.retryWithFallbackModel = params.retryWithFallbackModel;
  }
}
