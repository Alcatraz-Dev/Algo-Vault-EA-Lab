/**
 * AlgoVault SDK Errors
 */

export class AlgoVaultError extends Error {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status?: number, code?: string, details?: unknown) {
    super(message);
    this.name = "AlgoVaultError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AlgoVaultAuthError extends AlgoVaultError {
  constructor(message: string = "Authentication failed", details?: unknown) {
    super(message, 401, "AUTH_ERROR", details);
    this.name = "AlgoVaultAuthError";
  }
}

export class AlgoVaultRateLimitError extends AlgoVaultError {
  retryAfter?: number;

  constructor(message: string = "Rate limit exceeded", retryAfter?: number, details?: unknown) {
    super(message, 429, "RATE_LIMIT_ERROR", details);
    this.name = "AlgoVaultRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class AlgoVaultTimeoutError extends AlgoVaultError {
  constructor(message: string = "Request timeout", details?: unknown) {
    super(message, undefined, "TIMEOUT_ERROR", details);
    this.name = "AlgoVaultTimeoutError";
  }
}

export class AlgoVaultNetworkError extends AlgoVaultError {
  constructor(message: string = "Network error", details?: unknown) {
    super(message, undefined, "NETWORK_ERROR", details);
    this.name = "AlgoVaultNetworkError";
  }
}
