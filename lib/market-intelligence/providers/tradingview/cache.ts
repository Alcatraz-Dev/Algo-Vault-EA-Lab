/**
 * Safe caching for TradingView MCP responses (PHASE 17).
 *
 * Caches ONLY non-time-sensitive capability classes (news, economic calendar,
 * fundamentals, screener results, research snapshots). Never used as a
 * substitute for live/execution data. Every cached response carries its source
 * timestamp, cache timestamp and freshness state via the provenance envelope.
 */

export type CacheableCapability =
    | "news"
    | "economic_calendar"
    | "fundamentals"
    | "filings"
    | "forecasts"
    | "financial_history"
    | "screener"
    | "watchlists"
    | "alerts"
    | "technical_snapshot";

const DEFAULT_TTL_MS: Record<CacheableCapability, number> = {
    news: 10 * 60 * 1000,
    economic_calendar: 30 * 60 * 1000,
    fundamentals: 6 * 60 * 60 * 1000,
    filings: 6 * 60 * 60 * 1000,
    forecasts: 24 * 60 * 60 * 1000,
    financial_history: 24 * 60 * 60 * 1000,
    screener: 15 * 60 * 1000,
    watchlists: 5 * 60 * 1000,
    alerts: 2 * 60 * 1000,
    technical_snapshot: 5 * 60 * 1000,
};

export interface CacheEntryMeta {
    /** ms epoch of the underlying provider data. */
    sourceTimestamp: number | null;
    /** ms epoch when this entry was cached. */
    cachedAt: number;
}

interface CacheEntry {
    data: unknown;
    meta: CacheEntryMeta;
    expiresAt: number;
}

const store = new Map<string, CacheEntry>();

export function defaultTtlFor(capability: CacheableCapability): number {
    return DEFAULT_TTL_MS[capability];
}

export function cacheKeyFor(
    capability: CacheableCapability,
    userId: string | null,
    args?: Record<string, unknown>,
): string {
    const stable = args
        ? Object.keys(args)
              .sort()
              .map((k) => `${k}=${JSON.stringify(args[k] ?? null)}`)
              .join("&")
        : "";
    return `${capability}:${userId ?? "global"}${stable ? `:${stable}` : ""}`;
}

export function getCached<T>(key: string, now = Date.now()): { data: T; meta: CacheEntryMeta } | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
        store.delete(key);
        return null;
    }
    return { data: entry.data as T, meta: entry.meta };
}

export function setCached<T>(key: string, data: T, ttlMs: number, meta?: Partial<CacheEntryMeta>, now = Date.now()): CacheEntryMeta {
    const entryMeta: CacheEntryMeta = {
        sourceTimestamp: meta?.sourceTimestamp ?? null,
        cachedAt: now,
    };
    store.set(key, { data, meta: entryMeta, expiresAt: now + Math.max(1_000, ttlMs) });
    // Opportunistic pruning to keep memory bounded in serverless instances.
    if (store.size > 500) {
        for (const [k, v] of store.entries()) {
            if (v.expiresAt <= now) store.delete(k);
        }
    }
    return entryMeta;
}

export function clearCacheForUser(userId: string): void {
    const prefix = new RegExp(`^[a-z_]+:${userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(:|$)`);
    for (const key of store.keys()) {
        if (prefix.test(key)) store.delete(key);
    }
}

/** Test hook. */
export function clearAllMcpCache(): void {
    store.clear();
}
