import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { backtestStrategy, defaultBacktestConfig } from "@/lib/strategy-lab/backtest";
import { getStrategy, saveBacktest } from "@/lib/strategy-lab/storage";
import { checkAccess } from "@/lib/strategy-lab/license";
import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { BacktestConfig, DEFAULT_HIERARCHY, Strategy, TimeframeHierarchy } from "@/lib/strategy-lab/types";

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
            config?: Partial<BacktestConfig>;
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
        if (symbol === "EURUSD" && !body.strategyId) {
            // (allowed) quick-test of an unsaved draft is fine; symbol is a hint field used for the spec
        }

        const hierarchy: TimeframeHierarchy = { ...DEFAULT_HIERARCHY, ...(strategy.timeframes ?? {}) };
        const config: BacktestConfig = {
            ...defaultBacktestConfig(),
            ...(body.config ?? {}),
            initialBalance: body.config?.initialBalance ?? defaultBacktestConfig().initialBalance,
        };

        const bundle = await loadDataBundle(symbol, "1Y", hierarchy);
        const candlesByTF: Partial<Record<Timeframe, MarketCandle[]>> = {};
        for (const tf of [hierarchy.macro, hierarchy.structure, hierarchy.setup, hierarchy.entry]) {
            const data = bundle.candles[tf];
            if (Array.isArray(data) && data.length > 0) candlesByTF[tf] = data;
        }

        const from = body.from ?? config.from ?? 0;
        const to = body.to ?? config.to ?? Number.MAX_SAFE_INTEGER;

        const result = backtestStrategy(strategy, symbol, candlesByTF, config, from, to);

        let savedId = "";
        try {
            const withMeta = { ...result, uid, generatedAt: Date.now() };
            savedId = await saveBacktest(uid, withMeta);
        } catch {
            // storage failure non-fatal
        }

        return NextResponse.json({ backtest: result, savedId, symbol, strategyId: strategy.id }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/backtest]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Backtest failed" }, { status: 500, headers: corsHeaders });
    }
}