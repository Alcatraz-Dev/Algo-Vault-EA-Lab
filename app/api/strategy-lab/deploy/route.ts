import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { backtestStrategy, defaultBacktestConfig } from "@/lib/strategy-lab/backtest";
import { activateDeployment } from "@/lib/strategy-lab/execution";
import { getStrategy, listDeployments } from "@/lib/strategy-lab/storage";
import { checkAccess } from "@/lib/strategy-lab/license";
import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { DeployMode, TimeframeHierarchy } from "@/lib/strategy-lab/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const deployments = await listDeployments(token.uid);
        return NextResponse.json({ deployments }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/deploy GET]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500, headers: corsHeaders });
    }
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
            strategyId: string;
            symbol?: SupportedSymbol;
            mode?: DeployMode;
            termsAccepted?: boolean;
        };

        if (!body.termsAccepted) {
            return NextResponse.json({ error: "You must accept the deployment terms to proceed." }, { status: 400, headers: corsHeaders });
        }

        const strategy = await getStrategy(uid, body.strategyId);
        if (!strategy) {
            return NextResponse.json({ error: "Strategy not found" }, { status: 404, headers: corsHeaders });
        }

        const symbol = (body.symbol ?? strategy.asset ?? "XAUUSD") as SupportedSymbol;
        const mode = (body.mode ?? "alerts_only") as DeployMode;
        const hierarchy: TimeframeHierarchy = strategy.timeframes;

        // Run a quick backtest to capture metrics for deviation tracking
        const bundle = await loadDataBundle(symbol, "1Y", hierarchy);

        const candlesByTF: Partial<Record<Timeframe, import("@/lib/market-data/types").MarketCandle[]>> = {};
        for (const tf of [hierarchy.macro, hierarchy.structure, hierarchy.setup, hierarchy.entry]) {
            const data = bundle.candles[tf];
            if (Array.isArray(data) && data.length > 0) candlesByTF[tf] = data as import("@/lib/market-data/types").MarketCandle[];
        }

        const backtest = backtestStrategy(strategy, symbol, candlesByTF, defaultBacktestConfig(), 0, Number.MAX_SAFE_INTEGER);

        const result = await activateDeployment(uid, strategy, symbol, mode, backtest.metrics);

        return NextResponse.json({
            deployment: result.deployment,
            forwardTest: result.forwardTest,
            backtestMetrics: backtest.metrics,
        }, { status: 201, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/deploy POST]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Deployment failed" }, { status: 500, headers: corsHeaders });
    }
}