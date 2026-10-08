/**
 * Send-path error classes shared by the outreach sender and the action layer.
 *
 * A DeferredSendError is a precondition that time, configuration, or an
 * operator edit can fix (daily cap reached, contact gap, guard paused, reply-to
 * missing, vetting needs a decision, too few cited facts). The email stays a
 * draft with lastError set and the governed action goes back to "pending" so
 * the reviewed draft is never destroyed. Anything else (a blocked recipient,
 * a failed vetting, a provider rejection) marks the email and action failed.
 */
export class DeferredSendError extends Error {
  readonly deferred = true as const;

  constructor(message: string) {
    super(message);
    this.name = "DeferredSendError";
  }
}

export function isDeferredSendError(err: unknown): err is DeferredSendError {
  return err instanceof DeferredSendError || (err instanceof Error && (err as { deferred?: unknown }).deferred === true);
}
