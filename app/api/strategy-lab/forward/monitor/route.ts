import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { updateForwardTest } from "@/lib/strategy-lab/forward";
import { generateSignalFromDeployment } from "@/lib/strategy-lab/execution";
import { getDeployment, getForwardTest, getStrategy, saveForwardTest } from "@/lib/strategy-lab/storage";
import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { DEFAULT_HIERARCHY, TimeframeHierarchy } from "@/lib/strategy-lab/types";

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

        const body = (await request.json()) as {
            forwardTestId: string;
            deploymentId?: string;
            symbol?: SupportedSymbol;
        };

        const ft = await getForwardTest(uid, body.forwardTestId);
        if (!ft) {
            return NextResponse.json({ error: "Forward test not found" }, { status: 404, headers: corsHeaders });
        }

        const symbol = (body.symbol ?? ft.symbol) as SupportedSymbol;
        const hierarchy: TimeframeHierarchy = ft.hierarchy ?? DEFAULT_HIERARCHY;

        const bundle = await loadDataBundle(symbol, "1M", hierarchy);
        const candles = Array.isArray(bundle.candles[ft.timeframe]) ? (bundle.candles[ft.timeframe] as import("@/lib/market-data/types").MarketCandle[]) : [];

        if (candles.length === 0) {
            return NextResponse.json({ error: "No data available", forwardTest: ft }, { status: 200, headers: corsHeaders });
        }

        updateForwardTest(ft, candles);

        let newSignal = false;
        let orderRequestWritten = false;

        if (body.deploymentId) {
            const deployment = await getDeployment(uid, body.deploymentId);
            if (deployment && deployment.status === "active") {
                const strategy = await getStrategy(uid, deployment.strategyId);
                if (strategy) {
                    const bundleByTF: Partial<Record<Timeframe, import("@/lib/market-data/types").MarketCandle[]>> = {};
                    for (const [tf, tfData] of Object.entries(bundle.candles)) {
                        if (Array.isArray(tfData) && tfData.length > 0) bundleByTF[tf as Timeframe] = tfData as import("@/lib/market-data/types").MarketCandle[];
                    }

                    const result = await generateSignalFromDeployment(deployment, strategy, symbol, bundleByTF, ft);
                    newSignal = result.signal;
                    orderRequestWritten = result.orderRequestWritten;
                }
            }
        }

        try {
            await saveForwardTest(uid, ft);
        } catch (err) {
            console.error("[strategy-lab/forward/monitor] saveForwardTest failed:", err);
        }

        return NextResponse.json({
            forwardTest: ft,
            lastPrice: candles[candles.length - 1]?.close ?? ft.lastPrice,
            newSignal,
            orderRequestWritten,
        }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/forward/monitor]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Monitor update failed" }, { status: 500, headers: corsHeaders });
    }
}