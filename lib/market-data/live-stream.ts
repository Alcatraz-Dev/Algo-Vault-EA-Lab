"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MarketCandle, Timeframe, SupportedSymbol } from "@/lib/market-data/types";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { getMarketTruth, MarketSnapshot, marketDataStream } from "@/lib/market-data/market-truth";

const REFRESH_INTERVALS: Record<Timeframe, number> = {
    M1: 10000,
    M3: 10000,
    M5: 15000,
    M15: 30000,
    M30: 30000,
    H1: 60000,
    H4: 120000,
    D1: 300000,
};

interface UseLiveMarketDataResult {
    candles: MarketCandle[];
    currentPrice: number;
    isLive: boolean;
    isLoading: boolean;
    error: string | null;
    lastUpdate: number;
    refetch: () => Promise<void>;
}

export function useLiveMarketData(
    symbol: string,
    timeframe: string,
    lookbackCandles: number = 100
): UseLiveMarketDataResult {
    const sym = symbol.toUpperCase() as SupportedSymbol;
    const tf = timeframe as Timeframe;
    const refreshInterval = REFRESH_INTERVALS[tf] || 30000;

    const [candles, setCandles] = useState<MarketCandle[]>([]);
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [isLive, setIsLive] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState(0);

    const unsubscribeRef = useRef<(() => void) | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const isMountedRef = useRef(true);

    const refetch = useCallback(async () => {
        if (!isMountedRef.current) return;
        try {
            setError(null);
            const recentResult = await fetchCandles(sym, tf, { to: Date.now() });

            if (!isMountedRef.current) return;

            const fetchedCandles = recentResult.slice(-lookbackCandles);
            if (fetchedCandles.length > 0) {
                setCandles(fetchedCandles);
                const latestPrice = fetchedCandles[fetchedCandles.length - 1].close;
                try {
                    const snapshot = await getMarketTruth(sym, tf);
                    if (snapshot) {
                        setCurrentPrice(snapshot.snapshot.currentPrice || latestPrice);
                    } else {
                        setCurrentPrice(latestPrice);
                    }
                } catch {
                    setCurrentPrice(latestPrice);
                }
                setIsLive(true);
            }
            setLastUpdate(Date.now());
            setIsLoading(false);
        } catch (err) {
            if (!isMountedRef.current) return;
            setError(err instanceof Error ? err.message : "Failed to fetch market data");
            setIsLoading(false);
        }
    }, [sym, tf, lookbackCandles]);

    useEffect(() => {
        isMountedRef.current = true;
        const timer = setTimeout(() => refetch(), 0);

        intervalRef.current = setInterval(() => {
            refetch();
        }, refreshInterval);

        const onSnapshot = (snapshot: MarketSnapshot | null) => {
            if (!isMountedRef.current || !snapshot) return;
            if (snapshot.recentCandles.length > 0) {
                setCurrentPrice(snapshot.currentPrice);
                setLastUpdate(Date.now());
            }
        };

        unsubscribeRef.current = marketDataStream.subscribe(sym, tf, onSnapshot, {
            intervalMs: refreshInterval,
        });

        return () => {
            isMountedRef.current = false;
            clearTimeout(timer);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
    }, [refetch, sym, tf, refreshInterval]);

    return {
        candles,
        currentPrice,
        isLive,
        isLoading,
        error,
        lastUpdate,
        refetch,
    };
}

export function useLiveCandleUpdates(
    symbol: string,
    timeframe: string
): { candles: MarketCandle[]; currentPrice: number; isLive: boolean } {
    const sym = symbol.toUpperCase() as SupportedSymbol;
    const tf = timeframe as Timeframe;
    const [candles, setCandles] = useState<MarketCandle[]>([]);

    useEffect(() => {
        const refreshInterval = REFRESH_INTERVALS[tf] || 30000;

        const onSnapshot = (snapshot: MarketSnapshot | null) => {
            if (!snapshot) return;
            if (snapshot.recentCandles.length > 0) {
                setCandles(snapshot.recentCandles);
            }
        };

        const unsubscribe = marketDataStream.subscribe(sym, tf, onSnapshot, {
            intervalMs: refreshInterval,
        });

        const fetchInitial = async () => {
            try {
                const result = await fetchCandles(sym, tf, { to: Date.now() });
                if (result.length > 0) {
                    setCandles(result.slice(-100));
                }
            } catch {
                // ignore
            }
        };
        fetchInitial();

        const interval = setInterval(fetchInitial, refreshInterval);

        return () => {
            unsubscribe();
            clearInterval(interval);
        };
    }, [sym, tf]);

    const currentPrice = candles.length > 0
        ? candles[candles.length - 1].close
        : 0;

    return {
        candles,
        currentPrice,
        isLive: candles.length >= 2,
    };
}
