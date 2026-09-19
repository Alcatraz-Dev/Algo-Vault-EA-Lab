import { NextRequest, NextResponse } from "next/server";
import { parseAnalyticsParams } from "@/lib/market-data/validation";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { getSessionData } from "@/lib/analytics/sessions";
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
        const session = getSessionData(candles);

        return NextResponse.json({ success: true, symbol, timeframe, session, candleCount: candles.length });
    } catch (err) {
        console.error("Sessions API error:", err);
        return NextResponse.json({ error: "Failed to analyze sessions" }, { status: 500 });
    }
}
