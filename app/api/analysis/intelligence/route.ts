import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { getCandlesForTimeframe } from "@/lib/strategy-lab/market-data";
import { validateSymbol, validateTimeframe } from "@/lib/market-data/validation";
import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { runAgentPipeline } from "@/lib/ai/agents/pipeline";
import { analyseAdvanced, ANALYSIS_LADDER, type CandleBundle } from "@/lib/ai/analysis/intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/analysis/intelligence?symbol=EURUSD&timeframe=M15
 *
 * Returns the full advanced-analysis payload: market structure, the
 * multi-timeframe ladder, regime classification with evidence, and the
 * evidence sections. Every field is provenance-wrapped; timeframes the data
 * provider does not serve (M3, for example) come back as `unavailable` with a
 * reason rather than as zeros.
 */
export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        // Match the existing Strategy Lab gating so the analysis workspace and
        // the lab never disagree about who can see deep analysis.
        const access = await checkAccess(uid);
        if (!access.accessible) {
            return NextResponse.json(
                {
                    error: "Advanced analysis requires an active Strategy Lab license or a pro subscription.",
                    access,
                },
                { status: 403, headers: corsHeaders }
            );
        }

        const params = request.nextUrl.searchParams;
        const rawSymbol = params.get("symbol") ?? "XAUUSD";
        const rawTimeframe = params.get("timeframe") ?? "M15";

        const symbol = validateSymbol(rawSymbol);
        if (!symbol) {
            return NextResponse.json(
                { error: `Unsupported symbol: ${rawSymbol}.` },
                { status: 400, headers: corsHeaders }
            );
        }

        const primary = validateTimeframe(rawTimeframe);
        if (!primary) {
            return NextResponse.json(
                { error: `Unsupported timeframe: ${rawTimeframe}.` },
                { status: 400, headers: corsHeaders }
            );
        }

        // The ladder is fixed by the product spec; the primary timeframe is
        // added if it is not already part of it.
        const ladder: Timeframe[] = ANALYSIS_LADDER.includes(primary)
            ? ANALYSIS_LADDER
            : [...ANALYSIS_LADDER, primary];

        const bundle: CandleBundle = {};
        const fetchErrors: Array<{ timeframe: Timeframe; reason: string }> = [];

        // Sequential fetch: biquote rate-limits, and this keeps load predictable.
        for (const tf of ladder) {
            try {
                const { candles } = await getCandlesForTimeframe(symbol, tf);
                if (candles && candles.length > 0) {
                    bundle[tf] = candles as MarketCandle[];
                } else {
                    fetchErrors.push({
                        timeframe: tf,
                        reason: "Market data provider returned no candles for this timeframe.",
                    });
                }
            } catch (err) {
                fetchErrors.push({
                    timeframe: tf,
                    reason: err instanceof Error ? err.message : "Data provider error.",
                });
            }
        }

        if (!bundle[primary] || (bundle[primary]?.length ?? 0) === 0) {
            return NextResponse.json(
                {
                    error: `No candles available for ${symbol} ${primary}.`,
                    fetchErrors,
                    bundleCoverage: Object.fromEntries(
                        Object.entries(bundle).map(([tf, c]) => [tf, c?.length ?? 0])
                    ),
                },
                { status: 200, headers: corsHeaders }
            );
        }

        // The agent pipeline runs on the primary timeframe and supplies the
        // synthesised confidence that the evidence section references.
        const pipeline = await runAgentPipeline({
            symbol: symbol as SupportedSymbol,
            timeframe: primary,
            candles: bundle[primary] as MarketCandle[],
        });

        const analysis = analyseAdvanced(
            symbol as SupportedSymbol,
            primary,
            bundle,
            pipeline.intelligence?.confidence ?? null
        );

        return NextResponse.json(
            {
                analysis,
                pipeline: {
                    symbol: pipeline.symbol,
                    timeframe: pipeline.timeframe,
                    asOf: pipeline.asOf,
                    dataAsOf: pipeline.dataAsOf,
                    stale: pipeline.stale,
                    bars: pipeline.bars,
                    confidence: pipeline.intelligence?.confidence ?? null,
                    confidenceComponents: pipeline.intelligence?.components ?? [],
                },
                fetchErrors,
                dataSource: { id: "strategy-lab.market-data", label: "Strategy Lab data bundle" },
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[analysis/intelligence]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Analysis failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
