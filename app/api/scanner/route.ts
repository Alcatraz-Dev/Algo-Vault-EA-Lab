import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP, getVWAPPosition } from "@/lib/analytics/vwap";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import { isProUser } from "@/lib/ai-signals/access";
import { MarketRegime } from "@/lib/ai-signals/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const symbols = request.nextUrl.searchParams.get("symbols")?.split(",") || ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "NAS100", "US30"];
        const timeframe = request.nextUrl.searchParams.get("timeframe") || "H1";
        const minStrength = parseFloat(request.nextUrl.searchParams.get("minStrength") || "50");

        const isPro = await isProUser(user.uid);
        const results: any[] = [];

        for (const sym of symbols) {
            try {
                const candles = await fetchCandles(sym as any, timeframe as any);
                if (!candles || candles.length < 20) {
                    results.push({ symbol: sym, error: "Insufficient data" });
                    continue;
                }

                const regime = detectRegime(candles, timeframe as any);
                const volatility = analyzeVolatility(candles);
                const volume = analyzeVolume(candles);
                const vwap = calculateVWAP(candles);
                const vwapPos = getVWAPPosition(candles[candles.length - 1].close, vwap);
                const liquidity = detectLiquidity(candles, timeframe as any);
                const structure = detectStructure(candles, timeframe as any);
                const bias = getOverallStructureBias(structure);
                const score = calculateMarketScore(candles, timeframe as any);
                const spec = getSymbolSpec(sym as any);

                const currentPrice = candles[candles.length - 1].close;
                const atr = candles.slice(-14).reduce((s, c) => s + Math.max(c.high - c.low, Math.abs(c.high - candles[candles.indexOf(c) - 1]?.close || 0), Math.abs(c.low - candles[candles.indexOf(c) - 1]?.close || 0)), 0) / 14;
                const distanceToSL = atr * 1.5;

                let direction: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
                let buyScore = 0;
                let sellScore = 0;

                if (bias === "bullish") buyScore += 2;
                else if (bias === "bearish") sellScore += 2;
                if (regime.regime === "trending_bullish") buyScore += 1;
                else if (regime.regime === "trending_bearish") sellScore += 1;
                if (vwapPos === "above") buyScore += 1;
                else if (vwapPos === "below") sellScore += 1;

                if (buyScore > sellScore) direction = "BUY";
                else if (sellScore > buyScore) direction = "SELL";

                const strength = score.total;

                let regimeLabel: string = regime.regime.replace(/_/g, " ");
                if (regimeLabel === "transitional") regimeLabel = "UNCERTAIN";

                results.push({
                    symbol: sym,
                    currentPrice,
                    direction,
                    strength,
                    trend: bias,
                    momentum: score.total,
                    volatility: volatility.state,
                    volatilityPercent: volatility.atrPercent,
                    regime: regimeLabel,
                    regimeConfidence: regime.confidence,
                    liquidity: liquidity.levels.length > 0 ? "GOOD" : "LOW",
                    timeframe,
                    vwapPosition: vwapPos,
                    atr,
                    distanceToSL: Math.round(distanceToSL * 100) / 100,
                    riskReward: distanceToSL > 0 ? Math.round((atr * 2.2 / distanceToSL) * 100) / 100 : 0,
                    volumeState: volume.state,
                    relativeVolume: volume.relativeVolume,
                    score: score.total,
                    pipSize: spec?.pipSize || 0.01,
                    typicalSpread: spec?.typicalSpread || 0.2,
                    category: spec?.category || "forex",
                });
            } catch (err) {
                results.push({ symbol: sym, error: String(err) });
            }
        }

        const filtered = results.filter((r) => !r.error && r.strength >= minStrength);

        return NextResponse.json({
            success: true,
            results,
            filtered,
            timeframe,
            isPro,
            scannedAt: Date.now(),
        }, { status: 200 });
    } catch (err: unknown) {
        console.error("[scanner]", err);
        return NextResponse.json({ error: "Scanner failed" }, { status: 500 });
    }
}
