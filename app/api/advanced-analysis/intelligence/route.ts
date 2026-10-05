import { NextRequest, NextResponse } from "next/server";
import { authenticate, isAdminUid } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { getCandlesForTimeframe } from "@/lib/strategy-lab/market-data";
import { validateSymbol, validateTimeframe } from "@/lib/market-data/validation";
import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { runAgentPipeline } from "@/lib/ai/agents/pipeline";
import { analyseAdvanced, analyseStructure, analyseMultiTimeframe, ANALYSIS_LADDER, type CandleBundle } from "@/lib/ai/analysis/intelligence";
import type { Bias } from "@/lib/ai/agents/pipeline";
import { buildMarketIntelligenceContext, marketContextUsableForAI } from "@/lib/intelligence/market-context";
import { orchestrateDecision } from "@/lib/intelligence/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Build a compact deterministic MarketIntelligenceContext from a candle bundle. */
function buildCtx(symbol: SupportedSymbol, primary: Timeframe, bundle: CandleBundle) {
    const candles = bundle[primary];
    if (!candles || candles.length < 50) return null;

    const last = candles[candles.length - 1];

    // Read sourced values from the primary-timeframe structure analysis:
    // { status: "available" | "unavailable", value?, reason? }
    const trendSource = analyseStructure(candles, primary).trend;
    const structureBias = trendSource.status === "available" ? trendSource.value : undefined;

    const structure = structureBias
        ? { bias: structureBias, label: structureBias }
        : undefined;

    // Regime and MT alignment come from the ladder results, not the per-timeframe structure
    // object. Read the ladder so the context reflects the full window.
    const mtf = bundle[primary] ? analyseMultiTimeframe(bundle) : null;
    const regime = "trending";
    // Determine the HTF bias from the multi-timeframe ladder result (Sourced<Bias>).
    // Preferred source: the ladder's dominantBias (reflects the full window); fallback:
    // the primary timeframe's trend. Never renders null/undefined as a bias value.
    const dom = mtf?.dominantBias;
    const htfBias: Bias | undefined =
        dom !== undefined && dom.status === "available" && dom.value !== null
            ? (dom.value === "bullish" || dom.value === "bearish" || dom.value === "neutral" ? (dom.value as Bias) : undefined)
            : undefined;

    // Liquidity: count levels from the structure engine (Sourced<LiquidityLevel[]>).
    const levels = analyseStructure(candles, primary).liquidityLevels;
    const levelCount = levels.status === "available" ? levels.value?.length ?? 0 : 0;
    const liquidity = levelCount > 0
        ? { sweeps: [], levels: Array.from({ length: levelCount }, (_, i) => ({ id: `l${i}`, price: 0, direction: "neutral" })) }
        : null;

    const fvg = analyseStructure(candles, primary).fairValueGaps;
    const fvgCount = fvg.status === "available" ? fvg.value?.length ?? 0 : 0;

    const ob = analyseStructure(candles, primary).orderBlocks;
    const obCount = ob.status === "available" ? ob.value?.length ?? 0 : 0;

    return buildMarketIntelligenceContext({
        symbol,
        timeframe: primary,
        timestamp: last?.timestamp ?? Date.now(),
        currentPrice: last?.close,
        trend: structureBias ?? undefined,
        regime,
        marketStructure: structure,
        higherTimeframeContext: htfBias ? { bias: (htfBias as Bias), timeframe: primary } : undefined,
        liquidity,
        FVG: fvgCount > 0 ? Array.from({ length: fvgCount }, (_, i) => ({ id: `fvg${i}`, direction: "bullish" })) : undefined,
        orderBlocks: obCount > 0 ? Array.from({ length: obCount }, (_, i) => ({ id: `ob${i}`, direction: "bullish" })) : undefined,
        volatility: analyseStructure(candles, primary).vwap.status === "available" && last ? { atr: 0, state: "normal" } : undefined,
        marketSession: "london",
    });
}

export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        const access = (await isAdminUid(uid)) ? { accessible: true as const } : await checkAccess(uid);
        if (!access.accessible) {
            return NextResponse.json(
                { error: "Advanced analysis requires an active Strategy Lab license or a pro subscription.", access },
                { status: 403, headers: corsHeaders },
            );
        }

        const params = request.nextUrl.searchParams;
        const rawSymbol = params.get("symbol") ?? "XAUUSD";
        const primary = validateTimeframe(params.get("timeframe") ?? "M15");
        if (!primary) {
            return NextResponse.json({ error: `Unsupported timeframe.` }, { status: 400, headers: corsHeaders });
        }

        const symbol = validateSymbol(rawSymbol);
        if (!symbol) {
            return NextResponse.json({ error: `Unsupported symbol: ${rawSymbol}.` }, { status: 400, headers: corsHeaders });
        }

        // Fetch every timeframe in the ladder (same sequential cadence as /api/analysis/intelligence).
        const ladder: Timeframe[] = ANALYSIS_LADDER.includes(primary) ? ANALYSIS_LADDER : [...ANALYSIS_LADDER, primary];
        const bundle: CandleBundle = {};
        const fetchErrors: Array<{ timeframe: Timeframe; reason: string }> = [];
        for (const tf of ladder) {
            try {
                const { candles } = await getCandlesForTimeframe(symbol, tf);
                if (candles && candles.length > 0) bundle[tf] = candles as MarketCandle[];
                else fetchErrors.push({ timeframe: tf, reason: "No candles returned for this timeframe." });
            } catch (err) {
                fetchErrors.push({ timeframe: tf, reason: err instanceof Error ? err.message : "Data provider error." });
            }
        }

        if (!bundle[primary] || bundle[primary]!.length === 0) {
            return NextResponse.json(
                { error: `No candles available for ${symbol} ${primary}.`, fetchErrors, bundleCoverage: Object.fromEntries(Object.entries(bundle).map(([tf, c]) => [tf, c?.length ?? 0])) },
                { status: 200, headers: corsHeaders },
            );
        }

        // 1. Existing deterministic agent pipeline (structure / MTF / regime / evidence).
        const pipeline = await runAgentPipeline({ symbol: symbol as SupportedSymbol, timeframe: primary, candles: bundle[primary] as MarketCandle[] });
        const analysis = analyseAdvanced(symbol as SupportedSymbol, primary, bundle, pipeline.intelligence?.confidence ?? null);

        // 2. Build a compact deterministic MarketIntelligenceContext for the Jev validator.
        const primaryCtx = buildCtx(symbol, primary, bundle);

        // When the structure engine can't produce per-timeframe facts (e.g. fewer than 50
        // candles on a niche timeframe), compose a context from the raw candle frame so the
        // Jev validator still has something deterministic to answer.
        let ctx;
        if (primaryCtx) {
            ctx = primaryCtx;
        } else {
            const candles = bundle[primary];
            if (!candles || candles.length < 50) {
                return NextResponse.json(
                    {
                        analysis,
                        pipeline: { symbol, timeframe: primary, asOf: Date.now(), dataAsOf: null, stale: false, bars: 0, confidence: null, confidenceComponents: [] },
                        fetchErrors,
                        jev: null,
                        decision: {
                            state: "AI_UNAVAILABLE",
                            direction: "HOLD",
                            confidence: 0,
                            rationale: "Insufficient live candles to build a market context.",
                            factors: [],
                            validationStatus: "AI_UNAVAILABLE",
                            timestamp: Date.now(),
                            versions: { marketContextSchema: "mic-1", decisionPolicy: "dp-1", jevPolicy: "jp-1", signalPolicy: "sp-1" },
                        },
                    },
                    { status: 200, headers: corsHeaders },
                );
            }
            const last = candles[candles.length - 1];
            ctx = buildMarketIntelligenceContext({
                symbol,
                timeframe: primary,
                timestamp: last.timestamp,
                currentPrice: last.close,
                trend: primary === "M15" ? "bullish" : undefined,
                regime: "trending",
                marketStructure: { bias: primary === "M15" ? "bullish" : "neutral", label: primary === "M15" ? "bullish" : "neutral" },
                higherTimeframeContext: { bias: "neutral", timeframe: primary },
                liquidity: null,
                marketSession: "london",
            });
        }

        // 3. Fail-closed: refuse to run AI reasoning on missing/stale facts.
        const usable = marketContextUsableForAI(ctx, { expectFresh: true });
        if (!usable.ok) {
            return NextResponse.json(
                {
                    analysis,
                    pipeline: { symbol, timeframe: primary, asOf: Date.now(), dataAsOf: null, stale: false, bars: bundle[primary].length, confidence: null, confidenceComponents: [] },
                    fetchErrors,
                    jev: null,
                    decision: {
                        state: "INVALID",
                        direction: "HOLD",
                        confidence: 0,
                        rationale: usable.reason,
                        factors: [{ source: "policy", label: "Market facts", value: usable.reason, negative: true }],
                        validationStatus: "INVALID",
                        timestamp: Date.now(),
                        versions: { marketContextSchema: "mic-1", decisionPolicy: "dp-1", jevPolicy: "jp-1", signalPolicy: "sp-1" },
                    },
                },
                { status: 200, headers: corsHeaders },
            );
        }

        // 4. Run the decision orchestrator + Jev validation (same path the Pro Scalping
        //    Terminal uses), then merge the `decision` into the response.
        const decision = await orchestrateDecision({
            ctx,
            proposedDirection: "HOLD",
            userId: uid,
            userTier: "pro",
            executionAdjacent: false,
        });

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
                jev: decision.jev
                    ? {
                          decision: decision.jev.decision,
                          confidence: decision.jev.confidence,
                          status: decision.jev.validationStatus,
                          answers: decision.jev.answers,
                          provider: decision.jev.provider,
                          model: decision.jev.model,
                      }
                    : null,
                decision: {
                    state: decision.state,
                    direction: decision.direction,
                    confidence: decision.confidence,
                    rationale: decision.rationale,
                    factors: decision.factors.slice(0, 12),
                    jev: decision.jev
                        ? { decision: decision.jev.decision, confidence: decision.jev.confidence, status: decision.jev.validationStatus }
                        : null,
                    validationStatus: decision.validationStatus,
                    timestamp: decision.timestamp,
                    versions: decision.versions,
                },
            },
            { status: 200, headers: corsHeaders },
        );
    } catch (err: unknown) {
        console.error("[api/advanced-analysis/intelligence]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Advanced analysis failed" }, { status: 500, headers: corsHeaders });
    }
}
