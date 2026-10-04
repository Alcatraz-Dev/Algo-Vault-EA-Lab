"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import { chartCandleToMarketCandle } from "@/lib/chart-engine/candle";
import { isChartTimeframe, type ChartTimeframe } from "@/lib/chart-engine/timeframe";
import { useChartEngine } from "@/lib/chart-engine/use-chart-engine";

/**
 * useLiveCandles — canonical live candle feed for every chart in the app.
 *
 * This is now a thin adapter over the native chart engine
 * (lib/chart-engine): the engine owns the dataset, dedupe, gap detection and
 * connection quality; this hook adapts it to the historical
 * MarketCandle[] + isLive contract consumed by TradingChart, ProTerminalChart,
 * AdvancedChart and SignalChart.
 *
 *  1. History loads from the canonical /api/analytics/ohlc feed.
 *  2. Live quotes poll /api/market/quotes (Biquote forming M1 → TradingView
 *     scanner) every few seconds and are folded into the forming candle by
 *     the CandleAggregator (boundary crossing finalizes the previous candle).
 *  3. Gaps between candles are detected and repaired from the canonical feed;
 *     market-closed silence is reported as such, never faked.
 *
 * No data is ever fabricated: when the feed fails, the last known state is
 * kept and `error` reflects the failure.
 */

export interface UseLiveCandlesResult {
    candles: MarketCandle[];
    currentPrice: number;
    previousPrice: number;
    isLive: boolean;
    isLoading: boolean;
    error: string | null;
    lastUpdate: number;
    refetch: () => Promise<void>;
    /** Prepend one older page (deep history). False when exhausted/unavailable. */
    loadOlder: () => Promise<boolean>;
    /** True when the provider has more history beyond the loaded window. */
    hasMoreHistory: boolean;
    /** True while an older-page request is in flight. */
    loadingOlder: boolean;
    /** Connection state from the engine (live / reconnecting / error / loading). */
    connection: "idle" | "loading" | "live" | "reconnecting" | "error";
    /** Data quality (live / delayed / stale / gap_detected / synchronizing / market_closed / pristine). */
    quality: string;
}

type EngineState = {
    key: string;
    candles: readonly MarketCandle[];
    isLive: boolean;
    error: string | null;
    lastUpdate: number;
    connection: "idle" | "loading" | "live" | "reconnecting" | "error";
    quality: string;
    hasMoreHistory: boolean;
    loadingOlder: boolean;
};

// Per-hook-instance engine wrapper (engine itself is per seriesKey).
function buildAdapter(
    candlesInput: readonly import("@/lib/chart-engine/candle").ChartCandle[],
    status: import("@/lib/chart-engine/chart-data-engine").ChartEngineStatus,
    key: string,
): EngineState {
    const candles = candlesInput.map(chartCandleToMarketCandle);
    return {
        key,
        candles,
        isLive: status.connection === "live",
        error: status.error,
        lastUpdate: Math.max(status.lastTickAt, status.lastHistoryLoadAt),
        connection: status.connection,
        quality: status.quality,
        hasMoreHistory: status.hasMoreHistory,
        loadingOlder: status.loadingOlder,
    };
}

export function useLiveCandles(
    symbol: string,
    timeframe: string,
    options: { limit?: number; reconcileMs?: number; enabled?: boolean } = {}
): UseLiveCandlesResult {
    const limit = options.limit ?? 300;
    const enabled = options.enabled ?? true;

    const normalizedSymbol = symbol.toUpperCase();
    const supportedSymbol = (SUPPORTED_SYMBOLS as readonly string[]).includes(normalizedSymbol);
    const sym = normalizedSymbol as SupportedSymbol;
    const tfRaw = timeframe.toUpperCase() as Timeframe;
    const tf: ChartTimeframe = isChartTimeframe(tfRaw) ? tfRaw : "H1";
    const requestKey = enabled && supportedSymbol ? `${sym}|${tf}` : "";

    const shared = useChartEngine(sym, tf, {
        pageSize: Math.min(Math.max(limit, 50), 500),
        enabled: enabled && supportedSymbol,
    });
    const currentKey = enabled && supportedSymbol ? `${sym}|${tf}` : "";
    const state = useMemo(
        () => currentKey ? buildAdapter(shared.candles, shared.status, currentKey) : null,
        [currentKey, shared.candles, shared.status],
    );
    void requestKey;

    const refetch = useCallback(async () => {
        await shared.resync();
    }, [shared]);

    const loadOlder = useCallback(async () => shared.loadOlder(), [shared]);

    const candles = state?.key === requestKey ? (state.candles as MarketCandle[]) : [];
    const isLive = Boolean(state && state.key === requestKey && state.isLive);
    const error = state && state.key === requestKey ? state.error : null;
    const lastUpdate = state && state.key === requestKey ? state.lastUpdate : 0;
    const isLoading = requestKey !== "" && (state === null || state.key !== requestKey);
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
    const previousPrice = candles.length > 1 ? candles[candles.length - 2].close : 0;

    const unsupportedSymbol = enabled && !supportedSymbol;

    return {
        candles,
        currentPrice,
        previousPrice,
        isLive,
        isLoading,
        error: unsupportedSymbol ? `Live market data is unavailable for ${symbol}.` : error,
        lastUpdate,
        refetch,
        loadOlder,
        hasMoreHistory: Boolean(state && state.key === requestKey && state.hasMoreHistory),
        loadingOlder: Boolean(state && state.key === requestKey && state.loadingOlder),
        connection: state && state.key === requestKey ? state.connection : "idle",
        quality: state && state.key === requestKey ? state.quality : unsupportedSymbol ? "unsupported" : "pristine",
    };
}

/**
 * useLiveQuote — lightweight symbol → price map poller for non-chart
 * consumers (tickers, watchlists). Symbol list is normalized/deduped and the
 * poll pauses automatically when the list is empty.
 */
export function useLiveQuote(symbols: string[], intervalMs = 5000): {
    quotes: Record<string, { price: number; timestamp: number; change?: number; changePercent?: number }>;
    lastUpdate: number;
} {
    const key = symbols.join(",");
    const [quotes, setQuotes] = useState<Record<string, { price: number; timestamp: number; change?: number; changePercent?: number }>>({});
    const [lastUpdate, setLastUpdate] = useState(0);

    useEffect(() => {
        const list = Array.from(
            new Set(
                key
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean)
            )
        );
        if (list.length === 0) return;

        let cancelled = false;
        let inFlight = false;

        const poll = async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(list.join(","))}`, {
                    cache: "no-store",
                });
                const body = (await res.json().catch(() => null)) as
                    | { quotes?: Record<string, { price: number; timestamp: number; change?: number; changePercent?: number }> }
                    | null;
                if (cancelled || !body?.quotes) return;
                setQuotes(body.quotes);
                setLastUpdate(Date.now());
            } catch {
                // transient network error — next poll retries
            } finally {
                inFlight = false;
            }
        };

        const id = setInterval(poll, intervalMs);
        void poll();

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [key, intervalMs]);

    return { quotes, lastUpdate };
}
