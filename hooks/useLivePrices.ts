"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { auth } from "@/lib/firebase";

export type LivePrices = Record<string, number>;

export type LiveQuoteMeta = {
    price: number;
    change?: number;
    changePercent?: number;
    timestamp: number;
    provider: string;
};

export type LiveQuotes = Record<string, LiveQuoteMeta>;

interface UseLivePricesOptions {
    /** Poll interval in ms. Defaults to 5 000 (5 s). */
    intervalMs?: number;
    /** Set to false to pause polling without unmounting. */
    enabled?: boolean;
}

interface UseLivePricesResult {
    prices: LivePrices;
    quotes: LiveQuotes;
    lastUpdatedAt: number;
    isLive: boolean;
    refresh: () => void;
}

/**
 * Polls /api/signals/quotes?symbols=SYM1,SYM2 every `intervalMs` ms and
 * returns the latest prices for all requested symbols (plus change metadata
 * via `quotes`).
 *
 * The server resolves each symbol through the shared live-price resolver
 * (fresh Biquote forming candle → TradingView scanner) behind a 5 s cache,
 * so this cadence produces real tick-level updates without hammering the
 * upstream providers.
 *
 * Gracefully degrades: if the endpoint is unreachable, `prices` remains
 * whatever was last successfully fetched (empty map on first failure).
 * Polling pauses while the tab is hidden and resumes on focus.
 */
export function useLivePrices(
    symbols: string[],
    options: UseLivePricesOptions = {}
): UseLivePricesResult {
    const { intervalMs = 5_000, enabled = true } = options;
    const [prices, setPrices] = useState<LivePrices>({});
    const [quotes, setQuotes] = useState<LiveQuotes>({});
    const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
    const [isLive, setIsLive] = useState(false);
    const symbolsRef = useRef<string[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    // Keep a stable ref to the current symbols list to avoid recreating the
    // interval every time the parent re-renders with a new array reference.
    symbolsRef.current = symbols;

    const fetchPrices = useCallback(async () => {
        const syms = [...new Set(symbolsRef.current)].filter(Boolean);
        if (syms.length === 0) return;

        abortRef.current?.abort();
        abortRef.current = new AbortController();

        try {
            // /api/signals/quotes requires a Firebase ID token; attach one when
            // a session exists so the request is not rejected with 401.
            const token = await auth.currentUser?.getIdToken().catch(() => null);
            const headers: Record<string, string> = {};
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await fetch(
                `/api/signals/quotes?symbols=${syms.join(",")}`,
                { signal: abortRef.current.signal, headers }
            );
            if (!res.ok) return;
            const data: { prices?: LivePrices; quotes?: LiveQuotes; success?: boolean } = await res.json();
            let updated = false;
            if (data.prices) {
                setPrices((prev) => ({ ...prev, ...data.prices }));
                updated = true;
            }
            if (data.quotes) {
                setQuotes((prev) => ({ ...prev, ...data.quotes }));
            }
            if (updated) {
                setLastUpdatedAt(Date.now());
                setIsLive(true);
            }
        } catch {
            // AbortError is expected on cleanup — all other errors are silent
            setIsLive(false);
        }
    }, []);

    useEffect(() => {
        if (!enabled || symbols.length === 0) return;

        // Immediate first fetch
        void fetchPrices();

        const id = setInterval(() => {
            // Pause while the tab is hidden — resume on visibility/focus.
            if (typeof document !== "undefined" && document.hidden) return;
            void fetchPrices();
        }, intervalMs);

        const resume = () => {
            if (typeof document !== "undefined" && !document.hidden) void fetchPrices();
        };
        document.addEventListener("visibilitychange", resume);

        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", resume);
            abortRef.current?.abort();
        };
    }, [enabled, intervalMs, fetchPrices, symbols.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

    return { prices, quotes, lastUpdatedAt, isLive, refresh: fetchPrices };
}
