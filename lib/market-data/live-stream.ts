"use client";

import type { MarketCandle, Timeframe, SupportedSymbol } from "@/lib/market-data/types";
import { useLiveCandles } from "@/hooks/useLiveCandles";
import type { UseLiveCandlesResult } from "@/hooks/useLiveCandles";

/**
 * Live market data hook — now a thin adapter over the shared `useLiveCandles`
 * pipeline (canonical OHLC history + real-time quote merge + reconciliation).
 *
 * Kept for backwards compatibility with existing imports; new chart code
 * should import `useLiveCandles` directly.
 */
export function useLiveMarketData(
    symbol: string,
    timeframe: string,
    lookbackCandles: number = 100
): UseLiveCandlesResult & { candles: MarketCandle[] } {
    const sym = symbol.toUpperCase() as SupportedSymbol;
    const tf = timeframe.toUpperCase() as Timeframe;

    const result = useLiveCandles(sym, tf, { limit: lookbackCandles });

    return result;
}

export function useLiveCandleUpdates(
    symbol: string,
    timeframe: string
): { candles: MarketCandle[]; currentPrice: number; isLive: boolean } {
    const sym = symbol.toUpperCase() as SupportedSymbol;
    const tf = timeframe.toUpperCase() as Timeframe;

    const { candles, currentPrice, isLive } = useLiveCandles(sym, tf, { limit: 100 });

    return { candles, currentPrice, isLive };
}
