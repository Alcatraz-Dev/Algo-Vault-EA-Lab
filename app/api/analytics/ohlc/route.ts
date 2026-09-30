import { NextRequest, NextResponse } from "next/server";
import { validateSymbol, validateTimeframe } from "@/lib/market-data/validation";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { fetchTradingViewLivePrice } from "@/lib/market-data/tradingview-live";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const symbolParam = request.nextUrl.searchParams.get("symbol") || "XAUUSD";
        const timeframeParam = request.nextUrl.searchParams.get("timeframe") || "H1";
        const limitParam = request.nextUrl.searchParams.get("limit") || "200";

        const symbol = validateSymbol(symbolParam);
        const timeframe = validateTimeframe(timeframeParam);

        if (!symbol) {
            return NextResponse.json({ error: `Invalid symbol. Supported: ${SUPPORTED_SYMBOLS.join(", ")}` }, { status: 400 });
        }
        if (!timeframe) {
            return NextResponse.json({ error: `Invalid timeframe` }, { status: 400 });
        }

        const candles = await fetchCandles(symbol, timeframe);
        if (candles.length === 0) {
            return NextResponse.json({ error: "No candles available for this symbol/timeframe" }, { status: 502 });
        }

        const sliced = candles.slice(-Math.min(500, Math.max(10, Number(limitParam) || 200)));

        const lastCandle = sliced[sliced.length - 1];
        const prevCandle = sliced.length > 1 ? sliced[sliced.length - 2] : lastCandle;

        // Live quote: resolve the real current price (fresh Biquote forming
        // M1 candle → TradingView scanner) so the forming bar can tick between
        // feed refreshes. Falls back to the last candle's close — never a
        // fabricated number — when no live source is reachable.
        const livePrice = await fetchTradingViewLivePrice(symbol);
        const price = livePrice?.price ?? lastCandle?.close ?? 0;
        const changeFromLive = lastCandle ? price - (prevCandle?.close || 0) : 0;

        return NextResponse.json({
            success: true,
            symbol,
            timeframe,
            candles: sliced,
            quote: lastCandle ? {
                symbol,
                bid: price,
                ask: price,
                spread: 0,
                change: Number(changeFromLive.toFixed(5)),
                changePercent: Number((prevCandle?.close ? (changeFromLive / prevCandle.close) * 100 : 0).toFixed(3)),
                timestamp: livePrice?.timestamp ?? lastCandle.timestamp,
            } : null,
            candleCount: sliced.length,
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error("OHLC API error:", err);
        return NextResponse.json({ error: "Failed to fetch OHLC data" }, { status: 500 });
    }
}