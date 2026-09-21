import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectStructure } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP } from "@/lib/analytics/vwap";
import { getSessionData } from "@/lib/analytics/sessions";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { detectRegime } from "@/lib/analytics/market-regime";
import { getMultiTimeframeBias } from "@/lib/analytics/multi-timeframe";
import { Timeframe, MarketCandle, SupportedSymbol } from "@/lib/market-data/types";

/**
 * Server-side market intelligence loader for the plugin runtime.
 * Reuses the exact same analytics pipeline as the public /api/analytics/market
 * endpoint — no duplicate implementation, no HTTP round-trip to self.
 */

export type RuntimeMarketSnapshot = {
    symbol: string;
    timeframe: Timeframe;
    candles: MarketCandle[];
    candleCount: number;
    quote: { bid: number; ask: number; spread: number; changePercent: number; timestamp: number };
    volatility: ReturnType<typeof analyzeVolatility>;
    regime: ReturnType<typeof detectRegime>;
    structure: ReturnType<typeof detectStructure>;
    liquidity: ReturnType<typeof detectLiquidity>["levels"];
    volume: ReturnType<typeof analyzeVolume>;
    vwap: ReturnType<typeof calculateVWAP>;
    session: ReturnType<typeof getSessionData>;
    multiTimeframe: ReturnType<typeof getMultiTimeframeBias>;
    timestamp: number;
};

export async function loadMarketSnapshot(
    symbol: string,
    timeframe: Timeframe
): Promise<{ snapshot: RuntimeMarketSnapshot | null; error?: string }> {
    try {
        const candles = await fetchCandles(symbol as SupportedSymbol, timeframe);
        if (!candles || candles.length < 10) {
            return { snapshot: null, error: "Insufficient candle data for analysis." };
        }

        const structure = detectStructure(candles, timeframe);
        const liquidityResult = detectLiquidity(candles, timeframe);
        const volume = analyzeVolume(candles);
        const vwap = calculateVWAP(candles);
        const session = getSessionData(candles);
        const volatility = analyzeVolatility(candles);
        const regime = detectRegime(candles, timeframe);

        const currentCandle = candles[candles.length - 1];
        const prevCandle = candles.length > 1 ? candles[candles.length - 2] : currentCandle;
        const change = currentCandle.close - prevCandle.close;
        const changePercent = prevCandle.close !== 0 ? (change / prevCandle.close) * 100 : 0;
        const bid = currentCandle.close - volatility.atr * 0.01;
        const ask = currentCandle.close + volatility.atr * 0.01;

        const multiTimeframe = getMultiTimeframeBias({ [timeframe]: candles } as Record<Timeframe, typeof candles>);

        return {
            snapshot: {
                symbol,
                timeframe,
                candles,
                candleCount: candles.length,
                quote: {
                    bid: Number(bid.toFixed(5)),
                    ask: Number(ask.toFixed(5)),
                    spread: Number((ask - bid).toFixed(5)),
                    changePercent: Number(changePercent.toFixed(3)),
                    timestamp: currentCandle.timestamp,
                },
                volatility,
                regime,
                structure,
                liquidity: liquidityResult.levels,
                volume,
                vwap,
                session,
                multiTimeframe,
                timestamp: Date.now(),
            },
        };
    } catch (err) {
        return { snapshot: null, error: err instanceof Error ? err.message : "Market data provider unavailable." };
    }
}

export function resolveTimeframe(timeframe: string | undefined): Timeframe {
    const t = String(timeframe || "M5").toUpperCase();
    const valid: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];
    return (valid as string[]).includes(t) ? (t as Timeframe) : "M5";
}

export function clampSymbols(symbols: string[], max = 10): string[] {
    const seen = new Set<string>();
    for (const raw of symbols || []) {
        const s = String(raw || "").toUpperCase().trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        if (seen.size >= max) break;
    }
    return Array.from(seen);
}