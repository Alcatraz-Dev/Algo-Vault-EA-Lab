import { NextRequest, NextResponse } from "next/server";
import { parseAnalyticsParams } from "@/lib/market-data/validation";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectRegime } from "@/lib/analytics/market-regime";
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
        const regime = detectRegime(candles, timeframe);

        return NextResponse.json({ success: true, symbol, timeframe, regime, candleCount: candles.length });
    } catch (err) {
        console.error("Regime API error:", err);
        return NextResponse.json({ error: "Failed to detect regime" }, { status: 500 });
    }
}
