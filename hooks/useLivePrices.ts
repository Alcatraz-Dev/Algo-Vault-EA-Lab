"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type LivePrices = Record<string, number>;

interface UseLivePricesOptions {
    /** Poll interval in ms. Defaults to 10 000 (10 s). */
    intervalMs?: number;
    /** Set to false to pause polling without unmounting. */
    enabled?: boolean;
}

interface UseLivePricesResult {
    prices: LivePrices;
    lastUpdatedAt: number;
    isLive: boolean;
    refresh: () => void;
}

/**
 * Polls /api/signals/quotes?symbols=SYM1,SYM2 every `intervalMs` ms and
 * returns the latest bid prices for all requested symbols.
 *
 * Gracefully degrades: if the endpoint is unreachable, `prices` remains
 * whatever was last successfully fetched (empty map on first failure).
 */
export function useLivePrices(
    symbols: string[],
    options: UseLivePricesOptions = {}
): UseLivePricesResult {
    const { intervalMs = 10_000, enabled = true } = options;
    const [prices, setPrices] = useState<LivePrices>({});
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
            const res = await fetch(
                `/api/signals/quotes?symbols=${syms.join(",")}`,
                { signal: abortRef.current.signal }
            );
            if (!res.ok) return;
            const data: { prices?: LivePrices; success?: boolean } = await res.json();
            if (data.prices) {
                setPrices((prev) => ({ ...prev, ...data.prices }));
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

        const id = setInterval(() => void fetchPrices(), intervalMs);
        return () => {
            clearInterval(id);
            abortRef.current?.abort();
        };
    }, [enabled, intervalMs, fetchPrices, symbols.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

    return { prices, lastUpdatedAt, isLive, refresh: fetchPrices };
}
