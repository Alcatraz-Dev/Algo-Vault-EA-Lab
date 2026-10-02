/**
 * Rate limiting for TradingView MCP calls.
 *
 * The official service is rate-limited to ~100 requests/min per user (docs).
 * We enforce a slightly lower per-user budget and a small global ceiling so a
 * burst of users cannot exhaust the upstream. Reuses the token-bucket pattern
 * already used by lib/workflows/rate-limiter.ts.
 */

const DEFAULT_PER_USER_PER_MINUTE = 60; // conservative vs upstream ~100
const DEFAULT_GLOBAL_PER_MINUTE = 300;

interface Bucket {
    tokens: number;
    lastRefill: number;
}

const userBuckets = new Map<string, Bucket>();
let globalBucket: Bucket = { tokens: DEFAULT_GLOBAL_PER_MINUTE, lastRefill: Date.now() };

export interface RateLimitDecision {
    allowed: boolean;
    scope: "user" | "global" | null;
    retryAfterMs: number;
}

function refill(bucket: Bucket, ratePerMinute: number, now: number): void {
    const elapsed = now - bucket.lastRefill;
    if (elapsed >= 60_000) {
        bucket.tokens = ratePerMinute;
        bucket.lastRefill = now;
    } else {
        const refillAmount = (elapsed / 60_000) * ratePerMinute;
        bucket.tokens = Math.min(ratePerMinute, bucket.tokens + refillAmount);
        bucket.lastRefill = now;
    }
}

export function tryConsumeMcpBudget(
    userId: string,
    now = Date.now(),
    perUserPerMinute = DEFAULT_PER_USER_PER_MINUTE,
    globalPerMinute = DEFAULT_GLOBAL_PER_MINUTE,
): RateLimitDecision {
    // Global ceiling first.
    refill(globalBucket, globalPerMinute, now);
    if (globalBucket.tokens < 1) {
        return { allowed: false, scope: "global", retryAfterMs: 60_000 - (now - globalBucket.lastRefill) };
    }

    let bucket = userBuckets.get(userId);
    if (!bucket) {
        bucket = { tokens: perUserPerMinute, lastRefill: now };
        userBuckets.set(userId, bucket);
    }
    refill(bucket, perUserPerMinute, now);
    if (bucket.tokens < 1) {
        return { allowed: false, scope: "user", retryAfterMs: 60_000 - (now - bucket.lastRefill) };
    }

    bucket.tokens -= 1;
    globalBucket.tokens -= 1;
    return { allowed: true, scope: null, retryAfterMs: 0 };
}

/** Test hook. */
export function resetMcpRateLimiter(): void {
    userBuckets.clear();
    globalBucket = { tokens: DEFAULT_GLOBAL_PER_MINUTE, lastRefill: Date.now() };
}
