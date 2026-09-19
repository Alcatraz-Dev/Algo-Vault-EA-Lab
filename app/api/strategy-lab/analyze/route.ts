import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { analyzeMarket } from "@/lib/strategy-lab/analysis";
import { summarizeAnalysisWithFallback } from "@/lib/ai";
import { saveAnalysisSummary } from "@/lib/strategy-lab/storage";
import { SupportedSymbol } from "@/lib/market-data/types";
import { AnalyzeRequest, TimeframeHierarchy } from "@/lib/strategy-lab/types";

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

        const body = (await request.json()) as Partial<AnalyzeRequest>;
        const symbol = (body.symbol ?? "XAUUSD") as SupportedSymbol;
        const period = (body.period ?? "1M") as AnalyzeRequest["period"];
        const hierarchy: TimeframeHierarchy = {
            macro: body.hierarchy?.macro ?? "H4",
            structure: body.hierarchy?.structure ?? "H1",
            setup: body.hierarchy?.setup ?? "M15",
            entry: body.hierarchy?.entry ?? "M5",
        };

        const bundle = await loadDataBundle(symbol, period, hierarchy);

        if (!bundle.overallCoversRequest) {
            return NextResponse.json({
                error: "Insufficient historical data for the selected timeframe.",
                coverage: bundle.coverage,
                requestedFrom: bundle.requestedFrom,
                requestedTo: bundle.requestedTo,
            }, { status: 200, headers: corsHeaders });
        }

        const result = await analyzeMarket(symbol, period, hierarchy);

        let summary = null;
        try {
            const macro = result?.byTimeframe?.[hierarchy.macro];
            summary = await summarizeAnalysisWithFallback({
                asset: symbol,
                timeframe: hierarchy.macro,
                trend: macro?.trend?.bias ?? "neutral",
                volatility: macro?.volatility?.state ?? "normal",
                bestSession: macro?.sessions?.bestSession?.session ?? "",
                bestDay: macro?.sessions?.bestDay?.day ?? "",
                strongestSetup: macro?.priceAction?.sequence?.[0] ?? "",
                averageR: null,
                regime: macro?.trend?.regime ?? "transitional",
            });
            if (summary) {
                const id = `as_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
                await saveAnalysisSummary(uid, id, { id, uid, symbol, period, summary, analyzedAt: Date.now() });
            }
        } catch {
            // AI failure is non-fatal for the lab
        }

        return NextResponse.json({
            analysis: result,
            aiSummary: summary,
            symbol,
            period,
            coverage: bundle.coverage,
        }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/analyze]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Analysis failed" }, { status: 500, headers: corsHeaders });
    }
}