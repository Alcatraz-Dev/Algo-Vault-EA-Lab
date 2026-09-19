import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { defaultBacktestConfig } from "@/lib/strategy-lab/backtest";
import { optimizeStrategy } from "@/lib/strategy-lab/optimization";
import { getStrategy, saveOptimization } from "@/lib/strategy-lab/storage";
import { checkAccess } from "@/lib/strategy-lab/license";
import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { BacktestConfig, DEFAULT_HIERARCHY, OptimizeRange, Strategy, TimeframeHierarchy } from "@/lib/strategy-lab/types";

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

        const access = await checkAccess(uid);
        if (!access.accessible) {
            return NextResponse.json({ error: access.reason ?? "Access denied" }, { status: 403, headers: corsHeaders });
        }

        const body = (await request.json()) as {
            symbol?: SupportedSymbol;
            strategyId?: string;
            strategy?: Strategy;
            timeframe?: Timeframe;
            config?: Partial<BacktestConfig>;
            ranges?: OptimizeRange[];
            maxRuns?: number;
            from?: number;
            to?: number;
            hierarchy?: Partial<TimeframeHierarchy>;
        };

        const symbol = (body.symbol ?? "XAUUSD") as SupportedSymbol;
        let strategy = body.strategy ?? null;
        if (body.strategyId && !strategy) {
            strategy = await getStrategy(uid, body.strategyId);
            if (!strategy) {
                return NextResponse.json({ error: "Strategy not found" }, { status: 404, headers: corsHeaders });
            }
        }
        if (!strategy) {
            return NextResponse.json({ error: "strategy or strategyId required" }, { status: 400, headers: corsHeaders });
        }

        const timeframe = (body.timeframe ?? strategy.timeframes.setup) as Timeframe;
        const hierarchy: TimeframeHierarchy = { ...DEFAULT_HIERARCHY, ...(strategy.timeframes ?? {}) };
        const baseConfig: BacktestConfig = { ...defaultBacktestConfig(), ...(body.config ?? {}) };

        const bundle = await loadDataBundle(symbol, "1Y", hierarchy);
        const candles = Array.isArray(bundle.candles[timeframe]) ? (bundle.candles[timeframe] as MarketCandle[]) : [];

        if (candles.length < 50) {
            return NextResponse.json({ error: "Insufficient data for optimization" }, { status: 200, headers: corsHeaders });
        }

        const ranges = Array.isArray(body.ranges) && body.ranges.length > 0 ? body.ranges : [];

        const result = optimizeStrategy(
            strategy,
            symbol,
            timeframe,
            candles,
            ranges,
            baseConfig,
            body.maxRuns ?? 80,
            body.from ?? 0,
            body.to ?? Number.MAX_SAFE_INTEGER
        );

        let savedId = "";
        try {
            const withMeta = { ...result, uid, generatedAt: Date.now() };
            savedId = await saveOptimization(uid, withMeta);
        } catch {
            // storage failure non-fatal
        }

        return NextResponse.json({ optimization: result, savedId, symbol, strategyId: strategy.id }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/optimize]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Optimization failed" }, { status: 500, headers: corsHeaders });
    }
}