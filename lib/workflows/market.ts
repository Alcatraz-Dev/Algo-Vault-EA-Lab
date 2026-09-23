/**
 * Market data provider for workflow nodes.
 *
 * Every fetch goes through a per-run snapshot cache ("fetch once"), which
 * itself sits on top of the canonical `lib/market-data/cache.ts` (dedupe +
 * TTL + provider rate limiting). Symbol normalization reuses
 * `lib/market-data/twelvedata/symbol-map.ts`.
 *
 * Failure behaviour is honest: when a provider request fails, the node fails
 * with the reason — never a fabricated quote.
 */

import { marketDataCache } from "@/lib/market-data/cache";
import { fetchQuote, fetchTimeSeries, timeframeToTwelveDataInterval, TimeSeriesBar, TimeSeriesResponse } from "@/lib/market-data/twelvedata/rest-client";
import { normalizeSymbolInput, toTwelveDataSymbol } from "@/lib/market-data/twelvedata/symbol-map";
import { Timeframe, MarketCandle, SupportedSymbol } from "@/lib/market-data/types";
import { MarketSnapshotCache, SnapshotEntry } from "./types";

export function createSnapshotCache(): MarketSnapshotCache {
    const entries = new Map<string, SnapshotEntry>();
    return {
        entries,
        async getOrFetch<T>(key: string, fetcher: () => Promise<T | null>): Promise<T | null> {
            const existing = entries.get(key) as SnapshotEntry & { data: T } | undefined;
            if (existing && existing.fetchedAt > 0) return existing.data;
            const data = await fetcher();
            if (data !== null && data !== undefined) {
                entries.set(key, { kind: "candles", symbol: key, data, fetchedAt: Date.now(), provider: "twelvedata" } as SnapshotEntry);
            }
            return data;
        },
    };
}

function normalizeSymbol(raw: string): SupportedSymbol | null {
    return normalizeSymbolInput(String(raw || "").trim().toUpperCase());
}

function toTdSymbol(raw: string): string | null {
    const supported = normalizeSymbol(raw);
    if (!supported) return null;
    return toTwelveDataSymbol(supported);
}

const TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

function toTimeframe(raw: string): Timeframe | null {
    const value = String(raw || "").trim().toUpperCase() as Timeframe;
    return TIMEFRAMES.includes(value) ? value : null;
}

export interface QuoteResult {
    symbol: string;
    bid: number;
    ask: number;
    spread: number;
    timestamp: number;
    changePercent: number | null;
}

export async function fetchWorkflowQuote(symbolRaw: string): Promise<{ ok: boolean; quote?: QuoteResult; error?: string }> {
    const symbol = normalizeSymbol(symbolRaw);
    const td = symbol ? toTwelveDataSymbol(symbol) : null;
    if (!symbol || !td) return { ok: false, error: `Unsupported symbol "${symbolRaw}".` };
    if (marketDataCache.isRateLimited()) return { ok: false, error: "Market data rate limit reached for this provider." };

    const raw = await marketDataCache.getQuote(td, () => fetchQuote(td));
    if (!raw || typeof raw !== "object") return { ok: false, error: "Quote unavailable from provider." };

    const obj = raw as Record<string, unknown>;
    const bid = Number(obj.bid);
    const ask = Number(obj.ask);
    const changePercent = obj.percent_change !== undefined ? Number(obj.percent_change) : null;
    if (!(bid > 0) || !(ask > 0)) return { ok: false, error: "Provider returned an incomplete quote." };

    return {
        ok: true,
        quote: {
            symbol,
            bid,
            ask,
            spread: Number(((ask - bid)).toFixed(6)),
            timestamp: Date.now(),
            changePercent: Number.isFinite(changePercent) ? changePercent : null,
        },
    };
}

export async function fetchWorkflowCandles(
    symbolRaw: string,
    timeframeRaw: string,
    limit: number
): Promise<{ ok: boolean; candles?: MarketCandle[]; error?: string }> {
    const symbol = normalizeSymbol(symbolRaw);
    const td = symbol ? toTwelveDataSymbol(symbol) : null;
    const timeframe = toTimeframe(timeframeRaw);
    if (!symbol || !td) return { ok: false, error: `Unsupported symbol "${symbolRaw}".` };
    if (!timeframe) return { ok: false, error: `Unsupported timeframe "${timeframeRaw}".` };

    const clamped = Math.max(20, Math.min(Math.floor(limit) || 100, 1000));
    if (marketDataCache.isRateLimited()) return { ok: false, error: "Market data rate limit reached for this provider." };

    const candles = await marketDataCache.getCandles(
        symbol,
        timeframe,
        clamped,
        async (s, tf, n) => {
            const response = await fetchTimeSeries(td, timeframeToTwelveDataInterval(timeframe), clamped);
            return mapTimeSeries(response);
        }
    );
    if (!candles || candles.length === 0) return { ok: false, error: "No candles returned by provider." };

    return { ok: true, candles };
}

function mapTimeSeries(response: TimeSeriesResponse | null): MarketCandle[] | null {
    if (!response?.values || !Array.isArray(response.values)) return null;
    return response.values.map((v: TimeSeriesBar) => ({
        timestamp: new Date(String(v.datetime)).getTime() || 0,
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: v.volume !== undefined ? Number(v.volume) : undefined,
    }));
}

export async function fetchWorkflowSnapshot(symbolRaw: string): Promise<{
    ok: boolean;
    snapshot?: Record<string, unknown>;
    error?: string;
}> {
    const quote = await fetchWorkflowQuote(symbolRaw);
    if (!quote.ok) return { ok: false, error: quote.error };

    return {
        ok: true,
        snapshot: {
            symbol: quote.quote!.symbol,
            quote: quote.quote,
            fetchedAt: Date.now(),
        },
    };
}

/** Normalizes a symbol written by users into the canonical supported key. */
export function normalizeWorkflowSymbol(raw: string): string | null {
    return normalizeSymbol(raw);
}