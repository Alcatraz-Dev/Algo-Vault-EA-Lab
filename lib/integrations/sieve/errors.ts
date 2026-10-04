// Sieve scrape API — typed errors.
//
// The contract maps upstream HTTP statuses to distinct, actionable outcomes
// (fix request / tell user / wait / retry). Keeping that mapping in one pure
// function means the tests exercise the real classification, not a copy.

export type SieveErrorCode =
  | "NOT_CONFIGURED"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "INSUFFICIENT_CREDITS"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_STATUS"
  | "RUN_REFUSED"
  | "TURN_IN_FLIGHT"
  | "UNKNOWN_ERROR";

export interface SieveErrorOptions {
  status?: number;
  retryAfterSeconds?: number;
  /** Whether retrying the SAME request is safe (429/5xx only). */
  safeToRetry?: boolean;
  body?: unknown;
}

export class SieveError extends Error {
  readonly code: SieveErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly safeToRetry: boolean;
  readonly body?: unknown;

  constructor(code: SieveErrorCode, message: string, options: SieveErrorOptions = {}) {
    super(message);
    this.name = "SieveError";
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.safeToRetry = options.safeToRetry ?? false;
    this.body = options.body;
  }
}

export class SieveNotConfiguredError extends SieveError {
  constructor() {
    super("NOT_CONFIGURED", "Sieve is not configured. Set SIEVE_API_KEY to enable it.");
    this.name = "SieveNotConfiguredError";
  }
}

/**
 * Pure HTTP → error classification. `safeToRetry` is intentionally only true
 * for 429 and 5xx: those are the only responses where the server confirms no
 * run was created. A timeout or network error is NOT safe to retry for
 * POST /api/scrapes, because the first call may have succeeded.
 */
export function mapHttpError(status: number, body?: unknown, retryAfterSeconds?: number): SieveError {
  const detail = typeof body === "string" ? body : body ? JSON.stringify(body) : "";

  if (status === 400) {
    return new SieveError("BAD_REQUEST", `Sieve rejected the request (400). ${detail}`.trim(), {
      status,
      body,
    });
  }
  if (status === 401) {
    return new SieveError("UNAUTHORIZED", "Sieve API key is missing or revoked (401).", {
      status,
      body,
    });
  }
  if (status === 402) {
    return new SieveError("INSUFFICIENT_CREDITS", "Sieve account is out of credits (402).", {
      status,
      body,
    });
  }
  if (status === 404) {
    return new SieveError("NOT_FOUND", "Sieve resource not found or not owned (404).", {
      status,
      body,
    });
  }
  if (status === 409) {
    return new SieveError(
      "TURN_IN_FLIGHT",
      "A Sieve follow-up turn is already in flight (409). Wait, then resend.",
      { status, body, safeToRetry: true },
    );
  }
  if (status === 429) {
    return new SieveError("RATE_LIMITED", "Sieve rate limit reached (429).", {
      status,
      body,
      retryAfterSeconds,
      safeToRetry: true,
    });
  }
  if (status >= 500) {
    return new SieveError("SERVER_ERROR", `Sieve upstream error (${status}).`, {
      status,
      body,
      retryAfterSeconds,
      safeToRetry: true,
    });
  }
  return new SieveError("UNKNOWN_ERROR", `Sieve HTTP ${status}. ${detail}`.trim(), {
    status,
    body,
  });
}

export function isSieveError(value: unknown): value is SieveError {
  return value instanceof SieveError;
}
