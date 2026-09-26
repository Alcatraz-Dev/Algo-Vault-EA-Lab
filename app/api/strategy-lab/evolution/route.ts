import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { validateSymbol, validateTimeframe } from "@/lib/market-data/validation";
import { getEvolutionRun, listEvolutionRuns, saveEvolutionRun, saveDna } from "@/lib/ai/strategy-lab/storage";
import { runEvolution, LIMITS } from "@/lib/ai/strategy-lab/evolution";
import { DEFAULT_HIERARCHY, PERIOD_DAYS, type AnalysisPeriod, type TimeframeHierarchy } from "@/lib/strategy-lab/types";
import type { SupportedSymbol } from "@/lib/market-data/types";

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

/**
 * GET /api/strategy-lab/evolution?limit=5
 *
 * Returns the caller's persisted evolution runs, newest first, with per-run
 * pagination. Older runs are returned with candidate detail stripped; their
 * generation counts are the real recorded counts.
 */
export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }

        const access = await checkAccess(token.uid);
        if (!access.accessible) {
            return NextResponse.json({ error: "Strategy Lab access required.", access }, { status: 403, headers: corsHeaders });
        }

        const params = request.nextUrl.searchParams;
        const runId = params.get("runId");
        const limit = Number.parseInt(params.get("limit") ?? "10", 10);

        if (runId) {
            const run = await getEvolutionRun(token.uid, runId);
            return NextResponse.json({ run }, { status: 200, headers: corsHeaders });
        }

        const runs = await listEvolutionRuns(token.uid, {
            limit: Number.isFinite(limit) ? limit : 10,
        });

        return NextResponse.json(
            { runs, count: runs.length },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-lab/evolution GET]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to load evolution runs" },
            { status: 500, headers: corsHeaders }
        );
    }
}

/**
 * POST /api/strategy-lab/evolution
 *
 * Body: { symbol, timeframe?, period?, generations?, seedPopulation? }
 *
 * Runs the real pipeline — feature extraction, strategy generation, backtest,
 * risk evaluation, out-of-sample validation, survivor selection, mutation — over
 * real candles, then persists the run. Every count in the response is a real
 * count of candidates actually processed. If the data bundle is insufficient,
 * the route returns an explicit `unavailable` reason instead of a run with
 * fabricated numbers.
 */
export async function POST(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        const access = await checkAccess(uid);
        if (!access.accessible) {
            return NextResponse.json({ error: "Strategy Lab access required.", access }, { status: 403, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

        const rawSymbol = typeof body.symbol === "string" ? body.symbol : "XAUUSD";
        const symbol = validateSymbol(rawSymbol);
        if (!symbol) {
            return NextResponse.json({ error: `Unsupported symbol: ${rawSymbol}.` }, { status: 400, headers: corsHeaders });
        }

        const setupTimeframe = validateTimeframe(
            typeof body.timeframe === "string" ? body.timeframe : "M15"
        );
        if (!setupTimeframe) {
            return NextResponse.json(
                { error: `Unsupported timeframe: ${String(body.timeframe)}.` },
                { status: 400, headers: corsHeaders }
            );
        }

        const period = (typeof body.period === "string" ? body.period : "3M") as AnalysisPeriod;
        if (!PERIOD_DAYS[period]) {
            return NextResponse.json({ error: `Unsupported period: ${period}.` }, { status: 400, headers: corsHeaders });
        }

        const requestedGenerations = Number.parseInt(String(body.generations ?? "4"), 10);
        const generations = Number.isFinite(requestedGenerations)
            ? Math.max(1, Math.min(requestedGenerations, LIMITS.maxGenerations))
            : 4;

        const requestedSeed = Number.parseInt(String(body.seedPopulation ?? "12"), 10);
        const seedPopulation = Number.isFinite(requestedSeed)
            ? Math.max(2, Math.min(requestedSeed, LIMITS.maxSeeds))
            : 12;

        // Build a hierarchy around the requested setup timeframe so the backtest
        // uses genuinely different macro/structure/entry candles.
        const hierarchy: TimeframeHierarchy = {
            ...DEFAULT_HIERARCHY,
            setup: setupTimeframe,
            entry: setupTimeframe,
            structure: setupTimeframe === "H4" ? "H1" : "H1",
            macro: setupTimeframe === "H1" ? "H4" : "H4",
        };

        const to = Date.now();
        const from = to - PERIOD_DAYS[period] * 86_400_000;

        const bundle = await loadDataBundle(symbol as SupportedSymbol, period, hierarchy);

        if (!bundle.overallCoversRequest) {
            return NextResponse.json(
                {
                    error: "Insufficient historical data for the requested window.",
                    coverage: bundle.coverage,
                    requestedFrom: from,
                    requestedTo: to,
                },
                { status: 200, headers: corsHeaders }
            );
        }

        const runId = `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

        const run = await runEvolution({
            runId,
            uid,
            symbol: symbol as SupportedSymbol,
            timeframe: setupTimeframe,
            hierarchy,
            candlesByTF: bundle.candles,
            setupTimeframe,
            from,
            to,
            generations,
            seedPopulation,
            seed: `${uid}:${symbol}:${setupTimeframe}:${period}`,
        });

        if (run.unavailable) {
            return NextResponse.json(
                { run, unavailable: run.unavailable, coverage: bundle.coverage },
                { status: 200, headers: corsHeaders }
            );
        }

        await saveEvolutionRun(uid, run);

        // Persist the surviving DNAs so the lab can show what actually survived.
        const newest = run.generationReports[run.generationReports.length - 1];
        const survivors = (newest?.details ?? []).filter((d) => d.survivor);
        for (const s of survivors.slice(0, LIMITS.maxChildrenPerGeneration)) {
            await saveDna(uid, s.dna);
        }

        return NextResponse.json(
            {
                run,
                persistedSurvivors: survivors.length,
                coverage: bundle.coverage,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-lab/evolution POST]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Evolution run failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
