import { NextRequest, NextResponse } from "next/server";
import { parseAnalyticsParams } from "@/lib/market-data/validation";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { authenticate } from "@/lib/admin-auth";

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
        const volatility = analyzeVolatility(candles);

        return NextResponse.json({ success: true, symbol, timeframe, volatility, candleCount: candles.length });
    } catch (err) {
        console.error("Volatility API error:", err);
        return NextResponse.json({ error: "Failed to analyze volatility" }, { status: 500 });
    }
}
