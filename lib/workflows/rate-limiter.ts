/**
 * In-memory token-bucket rate limiter per (userId, nodeType).
 *
 * Works within a single serverless instance. Market-data providers keep
 * their own global protection via `lib/market-data/cache.ts` (marketDataCache),
 * so this limiter guards everything else (AI calls, HTTP requests, etc.).
 */

interface Bucket {
    tokens: number;
    lastRefill: number;
}

const buckets = new Map<string, Bucket>();

function keyOf(uid: string, nodeType: string): string {
    return `${uid}:${nodeType}`;
}

/**
 * Tries to consume one token. Returns remaining tokens (≥ 0) when allowed,
 * or -1 when rate limited.
 */
export function tryConsume(uid: string, nodeType: string, ratePerMinute: number, now = Date.now()): number {
    if (!(ratePerMinute > 0)) return 1;
    const key = keyOf(uid, nodeType);
    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = { tokens: ratePerMinute, lastRefill: now };
        buckets.set(key, bucket);
    }

    const elapsed = now - bucket.lastRefill;
    if (elapsed >= 60_000) {
        bucket.tokens = ratePerMinute;
        bucket.lastRefill = now;
    } else {
        const refill = (elapsed / 60_000) * ratePerMinute;
        bucket.tokens = Math.min(ratePerMinute, bucket.tokens + refill);
        bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) return -1;
    bucket.tokens -= 1;
    return bucket.tokens;
}

/** Clears the limiter (tests / admin reset). */
export function resetRateLimiter(): void {
    buckets.clear();
}

export function snapshotRateLimiterStats(): { size: number } {
    return { size: buckets.size };
}