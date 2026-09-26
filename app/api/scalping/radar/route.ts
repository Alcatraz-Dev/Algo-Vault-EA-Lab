import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { getCandlesForTimeframe } from "@/lib/strategy-lab/market-data";
import { validateSymbol, validateTimeframe } from "@/lib/market-data/validation";
import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { buildRadar, RADAR_SYMBOLS, RADAR_TIMEFRAME, type RadarInput } from "@/lib/ai/scalping/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Bound the work per request so a wide watchlist cannot hammer the provider. */
const MAX_SYMBOLS = 12;

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/scalping/radar?symbols=XAUUSD,EURUSD&timeframe=M5
 *
 * Returns the market radar: per symbol, the measured trend, momentum,
 * volatility, liquidity, regime and the provenance-wrapped AI confidence.
 * Symbols that cannot be fetched are returned in `failed` with a reason
 * instead of being rendered as zeroed rows.
 */
export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }

        // Match the existing AI-signals / Strategy Lab gating.
        const access = await checkAccess(token.uid);
        if (!access.accessible) {
            return NextResponse.json(
                {
                    error:
                        "The scalping terminal requires an active trading license or a pro subscription.",
                    access,
                },
                { status: 403, headers: corsHeaders }
            );
        }

        const params = request.nextUrl.searchParams;
        const rawTimeframe = params.get("timeframe") ?? RADAR_TIMEFRAME;
        const timeframe = validateTimeframe(rawTimeframe);
        if (!timeframe) {
            return NextResponse.json(
                { error: `Unsupported timeframe: ${rawTimeframe}.` },
                { status: 400, headers: corsHeaders }
            );
        }

        const requested = (params.get("symbols") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const source = requested.length > 0 ? requested : RADAR_SYMBOLS;

        const symbols: SupportedSymbol[] = [];
        const invalid: string[] = [];
        for (const s of source.slice(0, MAX_SYMBOLS)) {
            const v = validateSymbol(s);
            if (v) symbols.push(v);
            else invalid.push(s);
        }

        if (symbols.length === 0) {
            return NextResponse.json(
                { error: "No supported symbols were requested.", invalid },
                { status: 400, headers: corsHeaders }
            );
        }

        const inputs: RadarInput[] = [];
        for (const symbol of symbols) {
            try {
                const { candles } = await getCandlesForTimeframe(symbol, timeframe);
                inputs.push({ symbol, timeframe, candles: candles as MarketCandle[] });
            } catch (err) {
                inputs.push({ symbol, timeframe, candles: [] });
                void err;
            }
        }

        const radar = await buildRadar(inputs, timeframe);

        return NextResponse.json(
            {
                radar,
                invalid,
                dataSource: radar.dataSource,
                engine: {
                    // Deterministic pipeline — no LLM call, so no AI spend.
                    mode: "deterministic",
                    providers: 0,
                    budgetImpact: "none",
                },
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[scalping/radar]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Radar build failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
