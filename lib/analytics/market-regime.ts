import { RegimeData, MarketRegime, MarketCandle, Timeframe } from "../market-data/types";
import { calculateATR } from "./volatility";
import { calculateVWAP } from "./vwap";
import { getOverallStructureBias, detectStructure } from "./market-structure";

function calculateMomentum(candles: MarketCandle[], period: number = 14): number {
    if (candles.length < period + 1) return 0;

    const currentClose = candles[candles.length - 1].close;
    const pastClose = candles[candles.length - 1 - period].close;

    return pastClose !== 0 ? ((currentClose - pastClose) / pastClose) * 100 : 0;
}

function calculatePriceRange(candles: MarketCandle[], period: number = 20): number {
    const recent = candles.slice(-period);
    if (recent.length === 0) return 0;

    const high = Math.max(...recent.map((c) => c.high));
    const low = Math.min(...recent.map((c) => c.low));
    const mid = (high + low) / 2;

    return mid > 0 ? ((high - low) / mid) * 100 : 0;
}

export function detectRegime(
    candles: MarketCandle[],
    timeframe: Timeframe
): RegimeData {
    if (candles.length < 20) {
        return {
            regime: "transitional",
            confidence: 30,
            factors: ["Insufficient data for regime classification"],
        };
    }

    const factors: string[] = [];
    let bullishScore = 0;
    let bearishScore = 0;
    let rangeScore = 0;

    const structure = detectStructure(candles, timeframe);
    const structureBias = getOverallStructureBias(structure);
    if (structureBias === "bullish") {
        bullishScore += 25;
        factors.push("Bullish market structure");
    } else if (structureBias === "bearish") {
        bearishScore += 25;
        factors.push("Bearish market structure");
    } else {
        rangeScore += 15;
        factors.push("Neutral market structure");
    }

    const vwap = calculateVWAP(candles);
    if (vwap.distancePercent > 0.05) {
        bullishScore += 15;
        factors.push("Price above VWAP");
    } else if (vwap.distancePercent < -0.05) {
        bearishScore += 15;
        factors.push("Price below VWAP");
    } else {
        rangeScore += 10;
        factors.push("Price near VWAP");
    }

    const atr = calculateATR(candles);
    const currentPrice = candles[candles.length - 1].close;
    const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

    if (atrPercent > 0.5) {
        factors.push("High volatility (ATR elevated)");
    } else if (atrPercent < 0.1) {
        factors.push("Low volatility (ATR compressed)");
    }

    const momentum = calculateMomentum(candles);
    if (momentum > 0.3) {
        bullishScore += 20;
        factors.push(`Positive momentum (${momentum.toFixed(2)}%)`);
    } else if (momentum < -0.3) {
        bearishScore += 20;
        factors.push(`Negative momentum (${momentum.toFixed(2)}%)`);
    } else {
        rangeScore += 10;
        factors.push("Neutral momentum");
    }

    const priceRange = calculatePriceRange(candles);
    if (priceRange > 1.5) {
        factors.push("Wide price range (expansion)");
    } else if (priceRange < 0.3) {
        factors.push("Narrow price range (compression)");
    }

    const total = bullishScore + bearishScore + rangeScore || 1;

    let regime: MarketRegime;
    let confidence: number;

    if (bullishScore > bearishScore && bullishScore > rangeScore) {
        if (atrPercent > 0.5) {
            regime = "breakout";
            confidence = Math.round((bullishScore / total) * 100);
        } else {
            regime = "trending_bullish";
            confidence = Math.round((bullishScore / total) * 100);
        }
    } else if (bearishScore > bullishScore && bearishScore > rangeScore) {
        if (atrPercent > 0.5) {
            regime = "breakout";
            confidence = Math.round((bearishScore / total) * 100);
        } else {
            regime = "trending_bearish";
            confidence = Math.round((bearishScore / total) * 100);
        }
    } else if (rangeScore > bullishScore && rangeScore > bearishScore) {
        if (atrPercent > 0.5) {
            regime = "high_volatility";
        } else if (atrPercent < 0.1) {
            regime = "low_volatility";
        } else {
            regime = "ranging";
        }
        confidence = Math.round((rangeScore / total) * 100);
    } else {
        regime = "transitional";
        confidence = 30;
    }

    confidence = Math.min(95, Math.max(20, confidence));

    return { regime, confidence, factors };
}

export function getRegimeLabel(regime: MarketRegime): string {
    switch (regime) {
        case "trending_bullish": return "Trending Bullish";
        case "trending_bearish": return "Trending Bearish";
        case "ranging": return "Ranging";
        case "breakout": return "Breakout";
        case "high_volatility": return "High Volatility";
        case "low_volatility": return "Low Volatility";
        case "transitional": return "Transitional";
    }
}

export function getRegimeColor(regime: MarketRegime): string {
    switch (regime) {
        case "trending_bullish": return "emerald";
        case "trending_bearish": return "rose";
        case "ranging": return "amber";
        case "breakout": return "violet";
        case "high_volatility": return "orange";
        case "low_volatility": return "blue";
        case "transitional": return "zinc";
    }
}
