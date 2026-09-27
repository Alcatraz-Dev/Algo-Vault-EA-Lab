"use client";

import { useCallback, useEffect, useState } from "react";
import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { applyLiveTick } from "@/lib/market-data/live-feed";

/**
 * useLiveCandles — one hook that keeps a chart's candles genuinely live.
 *
 *  1. Initial history loads from the canonical `/api/analytics/ohlc` feed.
 *  2. Live quotes poll `/api/market/quotes` (TradingView scanner, Biquote
 *     fallback) every few seconds and are merged into the forming candle, so
 *     the last bar moves between feed refreshes.
 *  3. The full candle history is periodically reconciled against the provider
 *     feed so revised bars and newly closed bars are picked up.
 *
 * State is stored against the request key it was loaded for and the visible
 * values are *derived* by comparing keys — a symbol/timeframe switch shows a
 * loading state immediately without stale candles and without any synchronous
 * setState inside effect bodies.
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
}

const QUOTE_POLL_MS = 2000;
const DEFAULT_RECONCILE_MS = 60_000;

type FeedState = {
    key: string;
    candles: MarketCandle[];
    error: string | null;
    updatedAt: number;
};

export function useLiveCandles(
    symbol: string,
    timeframe: string,
    options: { limit?: number; reconcileMs?: number; enabled?: boolean } = {}
): UseLiveCandlesResult {
    const limit = options.limit ?? 300;
    const reconcileMs = options.reconcileMs ?? DEFAULT_RECONCILE_MS;
    const enabled = options.enabled ?? true;

    const sym = symbol.toUpperCase() as SupportedSymbol;
    const tf = timeframe.toUpperCase() as Timeframe;

    const requestKey = enabled ? `${sym}|${tf}|${limit}` : "";

    const [feed, setFeed] = useState<FeedState | null>(null);
    const [quoteTs, setQuoteTs] = useState<{ key: string; ts: number } | null>(null);

    // ── derived visible state (key comparison, never stale) ──────────────
    const isCurrent = feed !== null && feed.key === requestKey;
    const candles = isCurrent ? feed.candles : [];
    const error = isCurrent ? feed.error : null;
    const hasData = isCurrent && feed.candles.length > 0;
    const isLoading = requestKey !== "" && !isCurrent;
    const isLive = hasData;
    const quoteAt = quoteTs !== null && quoteTs.key === requestKey ? quoteTs.ts : 0;
    const lastUpdate = isCurrent ? Math.max(feed.updatedAt, quoteAt) : 0;
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
    const previousPrice = candles.length > 1 ? candles[candles.length - 2].close : 0;

    // ── history load + periodic reconciliation ───────────────────────────
    const loadHistory = useCallback(
        async (signal?: AbortSignal): Promise<MarketCandle[]> => {
            const res = await fetch(
                `/api/analytics/ohlc?symbol=${encodeURIComponent(sym)}&timeframe=${encodeURIComponent(tf)}&limit=${limit}`,
                { cache: "no-store", signal }
            );
            const body = (await res.json().catch(() => null)) as
                | { candles?: MarketCandle[]; error?: string }
                | null;
            if (!res.ok || !body?.candles?.length) {
                throw new Error(body?.error ?? `No ${tf} candles returned for ${sym}.`);
            }
            return body.candles
                .filter(
                    (c) =>
                        Number.isFinite(c.open) &&
                        Number.isFinite(c.high) &&
                        Number.isFinite(c.low) &&
                        Number.isFinite(c.close)
                )
                .sort((a, b) => a.timestamp - b.timestamp);
        },
        [sym, tf, limit]
    );

    useEffect(() => {
        if (!requestKey) return;
        const ctrl = new AbortController();

        const commit = (candlesOrError: { candles?: MarketCandle[]; error?: string }) => {
            setFeed((prev) => {
                // Do not clobber fresher live candles with an older reply.
                if (prev && prev.key === requestKey && prev.candles.length > 0 && !candlesOrError.error) {
                    const incoming = candlesOrError.candles ?? [];
                    if (
                        incoming.length === 0 ||
                        prev.candles[prev.candles.length - 1].close !==
                            incoming[incoming.length - 1]?.close
                    ) {
                        // Provider bar differs from the live-merged bar only in
                        // the forming bar — keep the merged tail but adopt any
                        // revised history length.
                        if (incoming.length >= prev.candles.length) {
                            return { ...prev, candles: incoming, updatedAt: Date.now() };
                        }
                        return prev;
                    }
                }
                return {
                    key: requestKey,
                    candles: candlesOrError.candles ?? [],
                    error: candlesOrError.error ?? null,
                    updatedAt: candlesOrError.error ? (prev?.key === requestKey ? prev.updatedAt : 0) : Date.now(),
                };
            });
        };

        (async () => {
            try {
                const fresh = await loadHistory(ctrl.signal);
                commit({ candles: fresh });
            } catch (err) {
                if ((err as Error)?.name === "AbortError") return;
                commit({ error: err instanceof Error ? err.message : "Failed to load market data." });
            }
        })();

        const reconcile = setInterval(() => {
            void loadHistory(ctrl.signal)
                .then((fresh) => commit({ candles: fresh }))
                .catch(() => {
                    // keep last known candles on reconcile failure
                });
        }, reconcileMs);

        return () => {
            ctrl.abort();
            clearInterval(reconcile);
        };
    }, [requestKey, reconcileMs, loadHistory]);

    // ── live quote merge (ticks move the forming bar) ────────────────────
    useEffect(() => {
        if (!requestKey || !hasData) return;
        let inFlight = false;

        const poll = async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(sym)}`, {
                    cache: "no-store",
                });
                const body = (await res.json().catch(() => null)) as
                    | { quotes?: Record<string, { price: number; timestamp: number }> }
                    | null;
                if (!body?.quotes) return;
                const quote = body.quotes[sym];
                if (!quote || !Number.isFinite(quote.price)) return;

                setFeed((prev) => {
                    if (!prev || prev.key !== requestKey || prev.candles.length === 0) return prev;
                    const next = applyLiveTick(
                        prev.candles,
                        { price: quote.price, timestamp: quote.timestamp || Date.now() },
                        tf
                    );
                    if (next === prev.candles) return prev;
                    return { ...prev, candles: next, error: null };
                });
                setQuoteTs({ key: requestKey, ts: Date.now() });
            } catch {
                // transient network error — next poll retries
            } finally {
                inFlight = false;
            }
        };

        const id = setInterval(poll, QUOTE_POLL_MS);
        void poll();

        return () => {
            clearInterval(id);
        };
    }, [requestKey, hasData, sym, tf]);

    const refetch = useCallback(async () => {
        if (!requestKey) return;
        try {
            const fresh = await loadHistory();
            setFeed({ key: requestKey, candles: fresh, error: null, updatedAt: Date.now() });
        } catch {
            // keep last known state
        }
    }, [requestKey, loadHistory]);

    return {
        candles,
        currentPrice,
        previousPrice,
        isLive,
        isLoading,
        error,
        lastUpdate,
        refetch,
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
