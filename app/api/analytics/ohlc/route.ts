import { NextRequest, NextResponse } from "next/server";
import { validateSymbol, validateTimeframe } from "@/lib/market-data/validation";
import { fetchCandles } from "@/lib/market-data/normalizer";
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
        const change = lastCandle ? lastCandle.close - (prevCandle?.close || 0) : 0;
        const changePercent = prevCandle?.close ? (change / prevCandle.close) * 100 : 0;

        return NextResponse.json({
            success: true,
            symbol,
            timeframe,
            candles: sliced,
            quote: lastCandle ? {
                symbol,
                bid: lastCandle.close,
                ask: lastCandle.close,
                spread: 0,
                change: Number(change.toFixed(5)),
                changePercent: Number(changePercent.toFixed(3)),
                timestamp: lastCandle.timestamp,
            } : null,
            candleCount: sliced.length,
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error("OHLC API error:", err);
        return NextResponse.json({ error: "Failed to fetch OHLC data" }, { status: 500 });
    }
}