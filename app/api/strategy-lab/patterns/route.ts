import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { discoverPatterns } from "@/lib/strategy-lab/patterns";
import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { DEFAULT_HIERARCHY, PatternRequest, TimeframeHierarchy } from "@/lib/strategy-lab/types";
import { savePatternResult } from "@/lib/strategy-lab/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        const body = (await request.json()) as Partial<PatternRequest>;
        const symbol = (body.symbol ?? "XAUUSD") as SupportedSymbol;
        const period = (body.period ?? "1M") as PatternRequest["period"];
        const timeframe = (body.timeframe ?? "M15") as Timeframe;
        const minOccurrences = Math.max(3, Math.min(100, body.minOccurrences ?? 10));

        const hierarchy: TimeframeHierarchy = DEFAULT_HIERARCHY;

        const bundle = await loadDataBundle(symbol, period, hierarchy);
        const candles = Array.isArray(bundle.candles[timeframe]) ? (bundle.candles[timeframe] as import("@/lib/market-data/types").MarketCandle[]) : [];

        if (candles.length < 30) {
            return NextResponse.json({
                patterns: [],
                symbol,
                period,
                timeframe,
                message: "Insufficient candles for pattern discovery.",
            }, { status: 200, headers: corsHeaders });
        }

        const discovery = discoverPatterns(symbol, period, timeframe, candles, minOccurrences);

        let savedId: string | null = null;
        try {
            savedId = `pat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            await savePatternResult(uid, savedId, { id: savedId, uid, symbol, period, timeframe, discovery, discoveredAt: Date.now() });
        } catch {
            // storage failure non-fatal
        }

        return NextResponse.json({
            patterns: discovery.patterns,
            symbol,
            period,
            timeframe,
            savedId,
        }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/patterns]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Pattern discovery failed" }, { status: 500, headers: corsHeaders });
    }
}