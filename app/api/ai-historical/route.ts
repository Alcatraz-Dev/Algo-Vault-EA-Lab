import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP } from "@/lib/analytics/vwap";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { detectStructure } from "@/lib/analytics/market-structure";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { parseAnalyticsParams } from "@/lib/market-data/validation";
import { summarizeAnalysisWithFallback } from "@/lib/ai";
import { MarketStructureEvent } from "@/lib/market-data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { symbol, timeframe, from, to } = parseAnalyticsParams(request.nextUrl.searchParams);
        if (!symbol || !timeframe) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

        const candles = await fetchCandles(symbol, timeframe, { from, to });
        if (candles.length < 20) return NextResponse.json({ error: "Insufficient data", candleCount: candles.length }, { status: 400 });

        const regime = detectRegime(candles, timeframe);
        const volatility = analyzeVolatility(candles);
        const volume = analyzeVolume(candles);
        const vwap = calculateVWAP(candles);
        const liquidity = detectLiquidity(candles, timeframe);
        const structure = detectStructure(candles, timeframe);
        const score = calculateMarketScore(candles, timeframe);

        const summary = await summarizeAnalysisWithFallback({
            asset: symbol,
            timeframe,
            trend: regime.regime,
            volatility: volatility.state,
            bestSession: "",
            bestDay: "",
            strongestSetup: "",
            averageR: null,
            regime: regime.regime,
        });

        const structureBias = structure.length > 0 ? (structure[0]?.direction || "neutral") : "neutral";
        const structureLevels = structure.filter((e: MarketStructureEvent) => e.type === "swing_high" || e.type === "swing_low").length;
        const structureBlocks = structure.filter((e: MarketStructureEvent) => e.type === "BOS" || e.type === "CHOCH").length;

        interface HistoryBucket {
            period: string;
            avgReturn: number;
            high: number;
            low: number;
            regime: string;
        }

        const history: HistoryBucket[] = [];
        const bucketSize = Math.max(1, Math.floor(candles.length / 30));
        for (let i = 0; i < candles.length; i += bucketSize) {
            const batch = candles.slice(i, i + bucketSize);
            const rValues = batch.map((c) => c.close / batch[0].close - 1);
            const avgR = rValues.reduce((a, b) => a + b, 0) / rValues.length;
            history.push({
                period: new Date(batch[0].timestamp).toISOString(),
                avgReturn: avgR,
                high: Math.max(...batch.map((c) => c.high)),
                low: Math.min(...batch.map((c) => c.low)),
                regime: detectRegime(batch, timeframe).regime,
            });
        }

        return NextResponse.json({
            success: true,
            symbol,
            timeframe,
            candleCount: candles.length,
            regime,
            volatility,
            volume,
            vwap: vwap || null,
            liquidity: {
                sweeps: liquidity.sweeps || [],
                levels: liquidity.levels || [],
            },
            structure: {
                bias: structureBias,
                levels: structureLevels,
                blocks: structureBlocks,
            },
            score,
            aiSummary: summary.summary,
            history,
        }, { status: 200 });
    } catch (err) {
        console.error("[ai-historical]", err);
        return NextResponse.json({ error: "AI historical analysis failed" }, { status: 500 });
    }
}
