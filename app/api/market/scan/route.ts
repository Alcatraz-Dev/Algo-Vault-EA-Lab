import { NextResponse } from "next/server";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP, getVWAPPosition } from "@/lib/analytics/vwap";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { SUPPORTED_SYMBOLS, Timeframe, SupportedSymbol } from "@/lib/market-data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCAN_SYMBOLS = ["XAUUSD", "BTCUSD", "NAS100", "EURUSD", "GBPUSD", "US30"] as const;

export type ScannerRow = {
    symbol: string;
    category: string;
    regime: string;
    trend: "bullish" | "bearish" | "neutral";
    volatility: string;
    liquidity: string;
    volume: string;
    vwap: string;
    mtfScore: number;
    zoneScore: number;
};

export async function GET() {
    try {
        const timeframe: Timeframe = "H1";
        const results: ScannerRow[] = [];

        for (const sym of SCAN_SYMBOLS) {
            try {
                const candles = await fetchCandles(sym as SupportedSymbol, timeframe);
                if (!candles || candles.length < 20) continue;

                const regime = detectRegime(candles, timeframe);
                const volatility = analyzeVolatility(candles);
                const volume = analyzeVolume(candles);
                const vwap = calculateVWAP(candles);
                const vwapPos = getVWAPPosition(candles[candles.length - 1].close, vwap);
                const structure = detectStructure(candles, timeframe);
                const bias = getOverallStructureBias(structure);
                const score = calculateMarketScore(candles, timeframe);
                const liquidity = detectLiquidity(candles, timeframe);
                const spec = getSymbolSpec(sym as SupportedSymbol);

                const trend: ScannerRow["trend"] = bias === "bullish" ? "bullish" : bias === "bearish" ? "bearish" : "neutral";
                const regimeLabel = regime.regime.replace(/_/g, " ");

                let volumeLabel = "Normal";
                if (volume.relativeVolume > 1.5) volumeLabel = `High (+${Math.round((volume.relativeVolume - 1) * 100)}%)`;
                else if (volume.relativeVolume < 0.5) volumeLabel = `Low (${Math.round((1 - volume.relativeVolume) * 100)}%)`;

                let liquidityLabel = "SSL Swept";
                if (liquidity.sweeps.length === 0 && liquidity.levels.length > 0) liquidityLabel = "Equal Lows";
                else if (liquidity.levels.length === 0) liquidityLabel = "Range Midpoint";

                let volatilityLabel = "Normal ATR";
                if (volatility.atrPercent < 0.1) volatilityLabel = "Low ATR";
                else if (volatility.atrPercent > 0.6) volatilityLabel = "High ATR";

                results.push({
                    symbol: sym,
                    category: spec?.category ?? "forex",
                    regime: regimeLabel,
                    trend,
                    volatility: volatilityLabel,
                    liquidity: liquidityLabel,
                    volume: volumeLabel,
                    vwap: vwapPos === "above" ? "Above VWAP" : vwapPos === "below" ? "Below VWAP" : "At VWAP",
                    mtfScore: Math.round(score.total),
                    zoneScore: Math.round(score.total * 0.95),
                });
            } catch {
                continue;
            }
        }

        const categories = Array.from(new Set(results.map((r) => r.category)));

        return NextResponse.json({
            success: true,
            scannedAt: Date.now(),
            symbols: results,
            categories,
        });
    } catch (err: unknown) {
        console.error("[market/scan]", err);
        return NextResponse.json({ error: "Scan failed" }, { status: 500 });
    }
}
