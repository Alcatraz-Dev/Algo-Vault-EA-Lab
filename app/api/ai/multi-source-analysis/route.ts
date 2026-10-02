import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { ai } from "@/lib/ai";
import { gatherMultiSourceIntelligence } from "@/lib/market-intelligence/ai/external-intelligence-service";
import {
    buildTradingViewSystemPrompt,
    buildTradingViewUserPrompt,
} from "@/lib/market-intelligence/ai/tradingview-ai-prompt";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { detectFairValueGaps, detectOrderBlocks } from "@/lib/analytics/zones";
import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { validateSymbol, validateTimeframe } from "@/lib/market-data/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/multi-source-analysis
 * Authenticated (AI Terminal). Composes the multi-source evidence payload:
 *
 *   ALGOVAULT EVIDENCE  — deterministic engine output (structure, liquidity,
 *                         FVG/order-block zones) computed from the existing
 *                         market-data pipeline (unchanged).
 *   TRADINGVIEW EVIDENCE— optional external context from the TradingView MCP
 *                         provider, labelled and freshness-stamped.
 *
 * The AI Router (canonical, AI_FREE_ONLY-respecting) interprets relationships
 * between the evidence. It is explicitly instructed NOT to invent data and
 * NOT to output BUY/SELL instructions.
 */
export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = (await request.json().catch(() => ({}))) as {
            symbol?: string;
            timeframe?: string;
            question?: string;
            includeNews?: boolean;
            includeEconomicCalendar?: boolean;
        };

        const symbol = validateSymbol((body.symbol || "XAUUSD").toUpperCase());
        const timeframe = validateTimeframe((body.timeframe || "H1").toUpperCase());
        if (!symbol || !timeframe) {
            return NextResponse.json({ success: false, error: "Invalid symbol or timeframe." }, { status: 400 });
        }

        // ── AlgoVault deterministic evidence (existing engines, unchanged) ──
        let algovaultEvidenceText = "(AlgoVault engine output unavailable)";
        try {
            const candles = await fetchCandles(symbol as SupportedSymbol, timeframe as Timeframe);
            if (candles && candles.length >= 20) {
                const structure = detectStructure(candles, timeframe as Timeframe);
                const bias = getOverallStructureBias(structure);
                const liquidity = detectLiquidity(candles, timeframe as Timeframe);
                const fvgs = detectFairValueGaps(candles, timeframe as Timeframe);
                const orderBlocks = detectOrderBlocks(candles, timeframe as Timeframe);
                const last = candles[candles.length - 1];
                algovaultEvidenceText = [
                    `- Symbol/timeframe: ${symbol} ${timeframe} (${candles.length} bars from the AlgoVault market-data pipeline)`,
                    `- Last close: ${last?.close ?? "n/a"} (bar time ${last ? new Date(last.timestamp).toISOString().slice(0, 16) : "n/a"} UTC)`,
                    `- Structure: ${bias || "unknown"}; recent events: ${
                        structure?.slice(-4).map((e) => `${e.type}@${e.price}`).join(", ") || "none"
                    }`,
                    `- Liquidity: ${liquidity?.levels?.length ?? 0} levels, ${liquidity?.sweeps?.length ?? 0} sweeps`,
                    `- Zones: ${fvgs.length} FVGs, ${orderBlocks.length} order blocks`,
                ].join("\n");
            }
        } catch {
            // Keep going: TradingView context may still be gathered; the AI is
            // told AlgoVault evidence is unavailable rather than given fake data.
        }

        // ── TradingView external evidence (fail-closed, optional) ──────────
        const external = await gatherMultiSourceIntelligence({
            uid: token.uid,
            symbol,
            timeframe,
            includeTechnicals: true,
            includeNews: body.includeNews !== false,
            includeEconomicCalendar: body.includeEconomicCalendar !== false,
        });

        // ── AI Router interpretation (canonical router only) ───────────────
        const userPrompt = buildTradingViewUserPrompt({
            symbol,
            timeframe,
            question: typeof body.question === "string" ? body.question.slice(0, 500) : undefined,
            algovaultEvidenceText,
            external,
        });

        let interpretation: string;
        let provider = "none";
        let model = "none";
        try {
            const response = await ai.chat(
                {
                    messages: [{ role: "user", content: userPrompt }],
                    systemPrompt: buildTradingViewSystemPrompt(),
                    maxTokens: 1200,
                },
                { source: "system" },
            );
            interpretation = response.content;
            provider = response.provider;
            model = response.model;
        } catch {
            interpretation =
                "AI interpretation unavailable. The evidence sections above are factual; interpretation could not be generated.";
        }

        return NextResponse.json({
            success: true,
            symbol,
            timeframe,
            sections: {
                algovaultEvidence: algovaultEvidenceText,
                tradingview: external.tradingview,
                interpretation,
                limitations: external.limitations,
            },
            anyExternalEvidence: external.anyExternalEvidence,
            ai: { provider, model },
        });
    } catch (err) {
        console.error("[multi-source-analysis] failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "Analysis failed." }, { status: 500 });
    }
}
