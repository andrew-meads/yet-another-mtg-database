/**
 * Error thrown by client fetch hooks when an API route responds with a non-2xx
 * status. Carries the HTTP status so callers can react to specific outcomes —
 * notably 404, which the entity detail pages turn into Next's not-found page.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** True when `error` is an ApiError for a 404 response. */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * TanStack Query `retry` policy: keep the default three attempts for transient
 * failures, but give up immediately on a 404 — a missing entity won't appear by
 * retrying, and the page wants to show not-found right away.
 */
export function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  return !isNotFoundError(error) && failureCount < 3;
}
