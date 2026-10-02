/**
 * AlgoVault Rate Limiting Engine
 * In-memory sliding window rate limiter for API endpoints.
 * Production defense-in-depth against scraping, automated bot flooding, and API abuse.
 */

interface RateLimitRecord {
  tokens: number;
  lastReset: number;
}

const store = new Map<string, RateLimitRecord>();

export interface RateLimitOptions {
  windowMs?: number; // Time window in milliseconds (default 60000ms = 1 min)
  max?: number;      // Maximum requests per window (default 60 requests)
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export function checkRateLimit(
  identifier: string,
  options: RateLimitOptions = {}
): RateLimitResult {
  const windowMs = options.windowMs || 60_000;
  const max = options.max || 60;
  const now = Date.now();

  const record = store.get(identifier);

  if (!record || now - record.lastReset > windowMs) {
    store.set(identifier, {
      tokens: max - 1,
      lastReset: now,
    });
    return {
      success: true,
      limit: max,
      remaining: max - 1,
      reset: Math.ceil((now + windowMs) / 1000),
    };
  }

  if (record.tokens > 0) {
    record.tokens -= 1;
    store.set(identifier, record);
    return {
      success: true,
      limit: max,
      remaining: record.tokens,
      reset: Math.ceil((record.lastReset + windowMs) / 1000),
    };
  }

  return {
    success: false,
    limit: max,
    remaining: 0,
    reset: Math.ceil((record.lastReset + windowMs) / 1000),
  };
}

/**
 * Utility to extract client IP from Next.js Request headers.
 */
export function getClientIp(req: Request): string {
  const xForwardedFor = req.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim();
  }
  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) {
    return xRealIp.trim();
  }
  return "127.0.0.1";
}
