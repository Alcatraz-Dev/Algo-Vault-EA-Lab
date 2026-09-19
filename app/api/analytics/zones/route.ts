import { NextRequest, NextResponse } from "next/server";
import { parseAnalyticsParams } from "@/lib/market-data/validation";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { getAllZones } from "@/lib/analytics/zones";
import { scoreAllZones } from "@/lib/analytics/zones/zone-scoring";
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
        const zones = getAllZones(candles, timeframe);
        const currentPrice = candles[candles.length - 1]?.close || 0;
        const scored = scoreAllZones(zones, currentPrice);

        return NextResponse.json({ success: true, symbol, timeframe, zones, scores: scored, candleCount: candles.length });
    } catch (err) {
        console.error("Zones API error:", err);
        return NextResponse.json({ error: "Failed to analyze zones" }, { status: 500 });
    }
}
