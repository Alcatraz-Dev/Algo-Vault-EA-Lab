/**
 * Market data cache and rate-limit protection.
 *
 * Prevents unnecessary API calls by:
 * 1. Deduplicating in-flight requests (same symbol+timeframe)
 * 2. Serving cached data within TTL windows
 * 3. Tracking request counts for rate-limit awareness
 */

import { Timeframe, MarketCandle } from "./types";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  provider: string;
}

interface InFlightEntry<T> {
  promise: Promise<T | null>;
  subscribers: number;
}

const DEFAULT_TTL_MS: Record<Timeframe, number> = {
  M1: 15000,
  M3: 15000,
  M5: 30000,
  M15: 60000,
  M30: 120000,
  H1: 300000,
  H4: 600000,
  D1: 1800000,
};

export class MarketDataCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private inFlight = new Map<string, InFlightEntry<unknown>>();
  private requestLog: number[] = [];
  private readonly maxRequestsPerMinute: number;

  constructor(maxRequestsPerMinute: number = 60) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
  }

  /**
   * Check if we're approaching rate limits.
   */
  isRateLimited(): boolean {
    this.cleanupRequestLog();
    return this.requestLog.length >= this.maxRequestsPerMinute;
  }

  /**
   * Get remaining request budget for the current minute.
   */
  getRemainingBudget(): number {
    this.cleanupRequestLog();
    return Math.max(0, this.maxRequestsPerMinute - this.requestLog.length);
  }

  /**
   * Record an API request.
   */
  recordRequest(): void {
    this.requestLog.push(Date.now());
  }

  private cleanupRequestLog(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.requestLog = this.requestLog.filter((t) => t > oneMinuteAgo);
  }

  /**
   * Get cached data or fetch it using a deduplicated promise.
   */
  async get<T>(
    key: string,
    ttl: number,
    fetcher: () => Promise<T | null>,
    provider: string = "twelvedata"
  ): Promise<T | null> {
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const existing = this.inFlight.get(key) as InFlightEntry<T> | undefined;
    if (existing) {
      existing.subscribers++;
      return existing.promise;
    }

    const promise = (async () => {
      this.recordRequest();
      const result = await fetcher();
      if (result) {
        this.cache.set(key, { data: result, expiresAt: Date.now() + ttl, provider });
      }
      return result;
    })();

    this.inFlight.set(key, { promise, subscribers: 1 });

    try {
      return await promise;
    } finally {
      const entry = this.inFlight.get(key);
      if (entry) {
        entry.subscribers--;
        if (entry.subscribers <= 0) {
          this.inFlight.delete(key);
        }
      }
    }
  }

  /**
   * Get candles with caching and deduplication.
   */
  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    fetcher: (symbol: string, timeframe: Timeframe, limit: number) => Promise<MarketCandle[] | null>
  ): Promise<MarketCandle[] | null> {
    const key = `candles:${symbol}:${timeframe}:${limit}`;
    const ttl = DEFAULT_TTL_MS[timeframe];
    return this.get(key, ttl, () => fetcher(symbol, timeframe, limit));
  }

  /**
   * Get a quote with caching and deduplication.
   */
  async getQuote(
    symbol: string,
    fetcher: (symbol: string) => Promise<unknown | null>
  ): Promise<unknown | null> {
    const key = `quote:${symbol}`;
    return this.get(key, 15000, () => fetcher(symbol));
  }

  /**
   * Invalidate cache for a specific symbol or all.
   */
  invalidate(symbol?: string, timeframe?: Timeframe): void {
    if (!symbol) {
      this.cache.clear();
      return;
    }
    const prefix = timeframe ? `${symbol}:${timeframe}` : `${symbol}:`;
    for (const key of this.cache.keys()) {
      if (key.includes(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all in-flight requests for a symbol.
   */
  clearInFlight(symbol?: string): void {
    if (!symbol) {
      this.inFlight.clear();
      return;
    }
    for (const key of this.inFlight.keys()) {
      if (key.includes(symbol)) {
        this.inFlight.delete(key);
      }
    }
  }

  getStats(): { cacheSize: number; inFlightSize: number; requestCount: number } {
    this.cleanupRequestLog();
    return {
      cacheSize: this.cache.size,
      inFlightSize: this.inFlight.size,
      requestCount: this.requestLog.length,
    };
  }
}

export const marketDataCache = new MarketDataCache(60);