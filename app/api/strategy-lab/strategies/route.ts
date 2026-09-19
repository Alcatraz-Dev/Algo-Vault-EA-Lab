import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { listStrategies, saveStrategy } from "@/lib/strategy-lab/storage";
import { SupportedSymbol } from "@/lib/market-data/types";
import { DEFAULT_HIERARCHY, AnalysisPeriod, Pattern, Strategy, TimeframeHierarchy } from "@/lib/strategy-lab/types";
import { generateStrategy } from "@/lib/strategy-lab/strategy-generator";
import { analyzeMarket } from "@/lib/strategy-lab/analysis";
import { checkAccess } from "@/lib/strategy-lab/license";

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

        const strategies = await listStrategies(token.uid);
        return NextResponse.json({ strategies }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/strategies GET]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load strategies" }, { status: 500, headers: corsHeaders });
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
            symbol?: SupportedSymbol;
            period?: AnalysisPeriod;
            pattern?: Pattern | null;
            direction?: "long" | "short";
            hierarchy?: Partial<TimeframeHierarchy>;
        };

        const symbol = (body.symbol ?? "XAUUSD") as SupportedSymbol;
        const period = (body.period ?? "1M") as AnalysisPeriod;
        const hierarchy: TimeframeHierarchy = {
            macro: body.hierarchy?.macro ?? DEFAULT_HIERARCHY.macro,
            structure: body.hierarchy?.structure ?? DEFAULT_HIERARCHY.structure,
            setup: body.hierarchy?.setup ?? DEFAULT_HIERARCHY.setup,
            entry: body.hierarchy?.entry ?? DEFAULT_HIERARCHY.entry,
        };

        let analysis = null;
        try {
            analysis = await analyzeMarket(symbol, period, hierarchy);
        } catch {
            // analysis is optional — local generator can work without it
        }

        let strategy: Strategy;
        try {
            strategy = await generateStrategy(
                symbol,
                period,
                hierarchy,
                body.pattern ?? null,
                body.direction ?? "long",
                analysis
            );
        } catch (err) {
            return NextResponse.json({ error: err instanceof Error ? err.message : "Strategy generation failed" }, { status: 500, headers: corsHeaders });
        }

        const id = await saveStrategy(uid, strategy);
        strategy.id = id;

        return NextResponse.json({ strategy }, { status: 201, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/strategies POST]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to generate strategy" }, { status: 500, headers: corsHeaders });
    }
}