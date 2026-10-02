import type { MarketCandle } from "@/lib/market-data/types";
import { toChartCandle, type ChartCandle } from "./candle";
import type { ChartDataSources, HistoryPage } from "./chart-data-engine";
import type { ChartTimeframe } from "./timeframe";

/**
 * Canonical data sources — the only place the chart engine touches the
 * network. All requests go through AlgoVault's own server routes:
 *
 *   browser → /api/analytics/ohlc → Biquote / Twelve Data   (history)
 *   browser → /api/market/quotes → Biquote M1 / TV scanner  (ticks)
 *
 * No provider is ever called from the browser and no API key ever reaches
 * the client (Phase 24 security boundary preserved).
 */

const MAX_HISTORY_CANDLES = 2000;
const MAX_RANGE_CANDLES = 1000;

type OhlcResponse = {
    success?: boolean;
    candles?: MarketCandle[];
    error?: string;
};

function mapCandles(raw: MarketCandle[] | undefined, symbol: string, timeframe: ChartTimeframe): ChartCandle[] {
    if (!raw?.length) return [];
    const out: ChartCandle[] = [];
    for (const bar of raw) {
        const c = toChartCandle(bar, symbol, timeframe);
        if (c) out.push(c);
    }
    return out.sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchOhlc(
    params: URLSearchParams,
    signal?: AbortSignal,
): Promise<MarketCandle[] | null> {
    const res = await fetch(`/api/analytics/ohlc?${params.toString()}`, {
        cache: "no-store",
        signal,
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as OhlcResponse | null;
    return body?.candles ?? null;
}

/**
 * Build the engine data sources bound to the canonical API.
 *
 * `hasDeepHistory` reflects whether the server can actually page beyond the
 * provider's shallow window (true when Twelve Data is configured). When it is
 * false, `loadOlder` reports hasMore: false immediately so the chart shows an
 * honest "history boundary reached" instead of spinning forever.
 */
export function createApiDataSources(hasDeepHistory: boolean): ChartDataSources {
    return {
        async loadLatest({ symbol, timeframe, limit, signal }) {
            const params = new URLSearchParams({
                symbol: symbol.toUpperCase(),
                timeframe,
                limit: String(Math.min(Math.max(limit, 50), MAX_HISTORY_CANDLES)),
            });
            const candles = await fetchOhlc(params, signal);
            const mapped = mapCandles(candles ?? undefined, symbol, timeframe);
            // Deep history exists only when a paging-capable provider is live;
            // otherwise the latest page is all the provider has.
            return { candles: mapped, hasMore: hasDeepHistory && mapped.length > 0 };
        },

        async loadOlder({ symbol, timeframe, beforeMs, limit }) {
            if (!hasDeepHistory) return { candles: [], hasMore: false };
            const params = new URLSearchParams({
                symbol: symbol.toUpperCase(),
                timeframe,
                limit: String(Math.min(Math.max(limit, 50), MAX_HISTORY_CANDLES)),
                before: String(beforeMs),
            });
            const candles = await fetchOhlc(params);
            const mapped = mapCandles(candles ?? undefined, symbol, timeframe)
                // Strictly older than the boundary — dedupe is enforced by the
                // engine, but avoid re-accepting the boundary candle.
                .filter((c) => c.timestamp < beforeMs);
            return { candles: mapped, hasMore: mapped.length > 0 };
        },

        async loadRange({ symbol, timeframe, fromMs, toMs }) {
            const params = new URLSearchParams({
                symbol: symbol.toUpperCase(),
                timeframe,
                from: String(fromMs),
                to: String(toMs),
                limit: String(MAX_RANGE_CANDLES),
            });
            const candles = await fetchOhlc(params);
            const mapped = mapCandles(candles ?? undefined, symbol, timeframe).filter(
                (c) => c.timestamp >= fromMs && c.timestamp <= toMs,
            );
            return { candles: mapped, hasMore: false };
        },
    };
}

/**
 * Ingest a /api/market/quotes payload for a symbol into a canonical tick.
 * Returns null when the quote is missing or malformed — never synthesizes.
 */
export function quoteToTick(
    quote: { price: number; timestamp: number } | undefined,
    symbol: string,
    nowMs = Date.now(),
): { price: number; timestamp: number } | null {
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return null;
    // Provider timestamps that are absurdly old or in the future are clamped
    // to now for bucketing, but the price is used as-is.
    let ts = Number.isFinite(quote.timestamp) ? quote.timestamp : nowMs;
    if (ts <= 0 || ts > nowMs + 60_000) ts = nowMs;
    void symbol;
    return { price: quote.price, timestamp: ts };
}
