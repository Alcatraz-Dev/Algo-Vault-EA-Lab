import { MultiTimeframeBias, MarketCandle, Timeframe } from "../market-data/types";
import { detectStructure, getOverallStructureBias } from "./market-structure";
import { calculateVWAP, getVWAPPosition } from "./vwap";

function getBiasFromIndicators(candles: MarketCandle[]): "bullish" | "bearish" | "neutral" {
    if (candles.length < 50) return "neutral";

    const closes = candles.map((c) => c.close);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);

    if (ema20 > ema50 * 1.001) return "bullish";
    if (ema20 < ema50 * 0.999) return "bearish";
    return "neutral";
}

function calculateEMA(values: number[], period: number): number {
    if (values.length === 0) return 0;
    const multiplier = 2 / (period + 1);
    return values.slice(1).reduce((current, value) => value * multiplier + current * (1 - multiplier), values[0] || 0);
}

export function getMultiTimeframeBias(
    candlesByTimeframe: Record<Timeframe, MarketCandle[]>
): MultiTimeframeBias[] {
    const timeframes: Timeframe[] = ["M15", "H1", "H4", "D1"];

    return timeframes.map((tf) => {
        const candles = candlesByTimeframe[tf] || [];
        if (candles.length < 10) {
            return {
                timeframe: tf,
                bias: "neutral" as const,
                structure: "Insufficient data",
            };
        }

        const structure = detectStructure(candles, tf);
        const structureBias = getOverallStructureBias(structure);

        const vwap = calculateVWAP(candles);
        const currentPrice = candles[candles.length - 1].close;
        const vwapPos = getVWAPPosition(currentPrice, vwap);

        const emaBias = getBiasFromIndicators(candles);

        let combinedBias: "bullish" | "bearish" | "neutral" = "neutral";
        const scores = [structureBias, vwapPos === "above" ? "bullish" : vwapPos === "below" ? "bearish" : "neutral", emaBias];
        const bullishCount = scores.filter((s) => s === "bullish").length;
        const bearishCount = scores.filter((s) => s === "bearish").length;

        if (bullishCount >= 2) combinedBias = "bullish";
        else if (bearishCount >= 2) combinedBias = "bearish";

        const structureLabel = structureBias === "bullish" ? "Bullish structure"
            : structureBias === "bearish" ? "Bearish structure"
            : "Neutral structure";

        return {
            timeframe: tf,
            bias: combinedBias,
            structure: `${structureLabel}, VWAP ${vwapPos}`,
        };
    });
}
