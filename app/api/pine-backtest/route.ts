import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getCandlesForTimeframe } from "@/lib/strategy-lab/market-data";
import { toPineCandles, backtestPine, type PineBacktestConfig } from "@/lib/pine-runtime/backtest";
import { SUPPORTED_SYMBOLS, Timeframe } from "@/lib/market-data/types";
import type { Candle } from "@/components/tradingview/TradingChart/types";

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

function normalizeSymbol(raw: string): string {
    return raw
        .replace(/^(FX:|XAU:|XAG:|INDEX:)/, "")
        .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "")
        .toUpperCase();
}

function normalizeTimeframe(raw: string): Timeframe {
    const tf = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return tf as Timeframe;
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }

        const body = await request.json();
        const { source, symbol, timeframe, config } = body as {
            source: string;
            symbol: string;
            timeframe?: string;
            config?: Partial<PineBacktestConfig>;
        };

        if (!source || !symbol) {
            return NextResponse.json(
                { error: "source and symbol are required" },
                { status: 400, headers: corsHeaders }
            );
        }

        const normalizedSymbol = normalizeSymbol(symbol);

        if (!SUPPORTED_SYMBOLS.includes(normalizedSymbol as (typeof SUPPORTED_SYMBOLS)[number])) {
            return NextResponse.json(
                { error: `Unsupported symbol: ${normalizedSymbol}` },
                { status: 400, headers: corsHeaders }
            );
        }

        const tf = normalizeTimeframe(timeframe || "H1");
        const supportedTfs: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
        if (!supportedTfs.includes(tf)) {
            return NextResponse.json(
                { error: `Unsupported timeframe: ${tf}. Use one of ${supportedTfs.join(", ")}` },
                { status: 400, headers: corsHeaders }
            );
        }

        const { candles: marketCandles } = await getCandlesForTimeframe(
            normalizedSymbol as (typeof SUPPORTED_SYMBOLS)[number],
            tf
        );

        if (marketCandles.length < 2) {
            return NextResponse.json(
                { error: `Not enough market data for ${normalizedSymbol} ${tf} (got ${marketCandles.length} bars)` },
                { status: 422, headers: corsHeaders }
            );
        }

        const pineCandles: Candle[] = toPineCandles(marketCandles);
        const result = backtestPine(source, pineCandles, normalizedSymbol, tf, config);

        return NextResponse.json(
            { success: true, backtest: result },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[pine-backtest]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Backtest failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
