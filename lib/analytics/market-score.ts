import { MarketScore, MarketScoreComponent, MarketCandle, Timeframe } from "../market-data/types";
import { getOverallStructureBias, detectStructure } from "./market-structure";
import { calculateVWAP, getVWAPPosition } from "./vwap";
import { analyzeVolume } from "./volume";
import { getAllZones } from "./zones";
import { detectLiquidity } from "./liquidity";

function calculateRSI(candles: MarketCandle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;

    const changes: number[] = [];
    for (let i = candles.length - period; i < candles.length; i++) {
        changes.push(candles[i].close - candles[i - 1].close);
    }

    const gains = changes.filter((c) => c > 0);
    const losses = changes.filter((c) => c < 0).map((c) => Math.abs(c));

    const avgGain = gains.length > 0 ? gains.reduce((s, g) => s + g, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, l) => s + l, 0) / period : 0;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

export function calculateMarketScore(
    candles: MarketCandle[],
    timeframe: Timeframe
): MarketScore {
    if (candles.length < 20) {
        return {
            total: 50,
            bias: "neutral",
            confidence: "low",
            components: [],
            timestamp: Date.now(),
        };
    }

    const components: MarketScoreComponent[] = [];
    const currentPrice = candles[candles.length - 1].close;

    const structure = detectStructure(candles, timeframe);
    const structureBias = getOverallStructureBias(structure);
    const structureScore = structureBias === "bullish" ? 18 : structureBias === "bearish" ? -18 : 0;
    components.push({
        name: "Structure",
        value: structureScore,
        max: 18,
        direction: structureBias,
    });

    const rsi = calculateRSI(candles);
    let momentumBias: "bullish" | "bearish" | "neutral" = "neutral";
    let momentumScore = 0;
    if (rsi > 60) { momentumBias = "bullish"; momentumScore = Math.min(16, Math.round((rsi - 50) * 0.4)); }
    else if (rsi < 40) { momentumBias = "bearish"; momentumScore = -Math.min(16, Math.round((50 - rsi) * 0.4)); }
    components.push({
        name: "Momentum",
        value: momentumScore,
        max: 16,
        direction: momentumBias,
    });

    const { levels: liquidityLevels } = detectLiquidity(candles, timeframe);
    const nearLiquidityHigh = liquidityLevels.some((l) => l.type.includes("high") && Math.abs(currentPrice - l.price) / currentPrice < 0.002);
    const nearLiquidityLow = liquidityLevels.some((l) => l.type.includes("low") && Math.abs(currentPrice - l.price) / currentPrice < 0.002);
    let liquidityBias: "bullish" | "bearish" | "neutral" = "neutral";
    let liquidityScore = 0;
    if (nearLiquidityLow) { liquidityBias = "bullish"; liquidityScore = 12; }
    else if (nearLiquidityHigh) { liquidityBias = "bearish"; liquidityScore = -12; }
    components.push({
        name: "Liquidity",
        value: liquidityScore,
        max: 12,
        direction: liquidityBias,
    });

    const volume = analyzeVolume(candles);
    let volumeBias: "bullish" | "bearish" | "neutral" = "neutral";
    let volumeScore = 0;
    if (volume.state === "expanded") {
        const priceUp = candles[candles.length - 1].close > candles[candles.length - 2].close;
        volumeBias = priceUp ? "bullish" : "bearish";
        volumeScore = priceUp ? 10 : -10;
    }
    components.push({
        name: "Volume",
        value: volumeScore,
        max: 10,
        direction: volumeBias,
    });

    const vwap = calculateVWAP(candles);
    const vwapPos = getVWAPPosition(currentPrice, vwap);
    let vwapBias: "bullish" | "bearish" | "neutral" = "neutral";
    let vwapScore = 0;
    if (vwapPos === "above") { vwapBias = "bullish"; vwapScore = 8; }
    else if (vwapPos === "below") { vwapBias = "bearish"; vwapScore = -8; }
    components.push({
        name: "VWAP",
        value: vwapScore,
        max: 8,
        direction: vwapBias,
    });

    const zones = getAllZones(candles, timeframe);
    const activeZones = zones.filter((z) => z.status === "active");
    const bullishZones = activeZones.filter((z) => z.direction === "bullish" && z.low > currentPrice);
    const bearishZones = activeZones.filter((z) => z.direction === "bearish" && z.high < currentPrice);
    let zoneBias: "bullish" | "bearish" | "neutral" = "neutral";
    let zoneScore = 0;
    if (bullishZones.length > bearishZones.length) { zoneBias = "bullish"; zoneScore = 14; }
    else if (bearishZones.length > bullishZones.length) { zoneBias = "bearish"; zoneScore = -14; }
    components.push({
        name: "Zones",
        value: zoneScore,
        max: 14,
        direction: zoneBias,
    });

    const totalScore = components.reduce((sum, c) => sum + c.value, 0);
    const normalizedScore = Math.min(100, Math.max(0, 50 + totalScore));

    let bias: MarketScore["bias"] = "neutral";
    if (totalScore > 10) bias = "bullish";
    else if (totalScore < -10) bias = "bearish";

    let confidence: MarketScore["confidence"] = "low";
    const absTotal = Math.abs(totalScore);
    if (absTotal > 30) confidence = "high";
    else if (absTotal > 15) confidence = "medium";

    return {
        total: normalizedScore,
        bias,
        confidence,
        components,
        timestamp: Date.now(),
    };
}
