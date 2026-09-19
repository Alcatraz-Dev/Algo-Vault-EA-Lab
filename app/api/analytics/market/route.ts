import { NextRequest, NextResponse } from "next/server";
import { parseAnalyticsParams } from "@/lib/market-data/validation";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectStructure } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP } from "@/lib/analytics/vwap";
import { getSessionData } from "@/lib/analytics/sessions";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { detectRegime } from "@/lib/analytics/market-regime";
import { getAllZones } from "@/lib/analytics/zones";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { getMultiTimeframeBias } from "@/lib/analytics/multi-timeframe";
import { authenticate } from "@/lib/admin-auth";
import { Timeframe } from "@/lib/market-data/types";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { symbol, timeframe, from, to, error } = parseAnalyticsParams(request.nextUrl.searchParams);
        if (error || !symbol || !timeframe) {
            return NextResponse.json({ error: error || "Invalid parameters" }, { status: 400 });
        }

        const candles = await fetchCandles(symbol, timeframe, { from, to });
        if (candles.length < 10) {
            return NextResponse.json({ error: "Insufficient data for analysis" }, { status: 400 });
        }

        const structure = detectStructure(candles, timeframe);
        const { levels: liquidity, sweeps: liquiditySweeps } = detectLiquidity(candles, timeframe);
        const volume = analyzeVolume(candles);
        const vwap = calculateVWAP(candles);
        const session = getSessionData(candles);
        const volatility = analyzeVolatility(candles);
        const regime = detectRegime(candles, timeframe);
        const zones = getAllZones(candles, timeframe);
        const score = calculateMarketScore(candles, timeframe);

        const currentCandle = candles[candles.length - 1];
        const prevCandle = candles.length > 1 ? candles[candles.length - 2] : currentCandle;
        const change = currentCandle.close - prevCandle.close;
        const changePercent = prevCandle.close !== 0 ? (change / prevCandle.close) * 100 : 0;

        const bid = currentCandle.close - volatility.atr * 0.01;
        const ask = currentCandle.close + volatility.atr * 0.01;
        const spread = ask - bid;

        const multiTimeframe = getMultiTimeframeBias({ [timeframe]: candles } as Record<Timeframe, typeof candles>);

        return NextResponse.json({
            success: true,
            symbol,
            timeframe,
            quote: {
                symbol,
                bid: Number(bid.toFixed(5)),
                ask: Number(ask.toFixed(5)),
                spread: Number(spread.toFixed(5)),
                change: Number(change.toFixed(5)),
                changePercent: Number(changePercent.toFixed(3)),
                timestamp: currentCandle.timestamp,
            },
            structure,
            liquidity,
            liquiditySweeps,
            volume,
            vwap,
            session,
            volatility,
            regime,
            zones,
            score,
            multiTimeframe,
            candleCount: candles.length,
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error("Market intelligence error:", err);
        return NextResponse.json({ error: "Failed to compute market intelligence" }, { status: 500 });
    }
}
