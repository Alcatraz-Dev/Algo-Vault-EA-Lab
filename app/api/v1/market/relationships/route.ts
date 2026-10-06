/**
 * GET/POST /api/v1/market/relationships — measured relationships for one
 * instrument (Phase 16 §46 `GET /market/relationships/:symbol`, §47 B2B).
 *
 * Delivered through the shared Intelligence Cloud pipeline (auth → scope →
 * entitlement → rate limit → metering). `symbol` is required; `timeframe` and
 * `bars` behave like /v1/market/graph.
 *
 * Only relationships that passed the documented label threshold are returned
 * (§4) — the endpoint never reports "no relationship" as a zero correlation.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { INTELLIGENCE_API_VERSION } from "@/lib/intelligence-cloud/contracts";
import { IntelligenceError } from "@/lib/intelligence-cloud/errors";
import { computeCrossAssetGraph, DEFAULT_BARS, DEFAULT_TIMEFRAME } from "@/lib/cross-asset/service";
import { buildSymbolCrossAssetContext } from "@/lib/cross-asset/context";
import type { RelationshipWindowBars } from "@/lib/cross-asset/types";
import { RELATIONSHIP_TIMEFRAMES, RELATIONSHIP_WINDOWS } from "@/lib/cross-asset/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: "market:read",
            requiredEntitlement: "market.intelligence",
            endpoint: "GET /v1/market/relationships",
            usageCategory: "market.data",
            apiVersion: INTELLIGENCE_API_VERSION,
            build: (intelligence) => intelligence,
        },
        run: async (body) => {
            const symbol = String(body.symbol ?? "").trim().toUpperCase();
            if (!symbol) {
                throw new IntelligenceError("INVALID_REQUEST", "symbol is required, e.g. ?symbol=XAUUSD.");
            }

            const timeframeRaw = String(body.timeframe ?? DEFAULT_TIMEFRAME).toUpperCase();
            const timeframe = (RELATIONSHIP_TIMEFRAMES as readonly string[]).includes(timeframeRaw)
                ? timeframeRaw
                : DEFAULT_TIMEFRAME;
            const barsRaw = Number(body.bars ?? DEFAULT_BARS);
            const bars = (RELATIONSHIP_WINDOWS as readonly number[]).includes(barsRaw)
                ? (barsRaw as RelationshipWindowBars)
                : DEFAULT_BARS;

            const graph = await computeCrossAssetGraph({
                focusSymbol: symbol,
                timeframe,
                bars,
                tier: "PRO",
                leadLag: true,
            });

            const focusRelationships = graph.relationships.filter((r) => r.a === symbol || r.b === symbol);
            const context = buildSymbolCrossAssetContext({
                symbol,
                window: graph.snapshot.window,
                relationships: focusRelationships,
                clusters: graph.clusters,
                regime: graph.regime.snapshot,
                factors: graph.factors,
                signals: graph.signals,
                portfolioImpact: null, // API tenants get market data only — no user portfolio leakage (§50)
                dataTimestamp: graph.snapshot.dataTimestamp,
                calculatedAt: graph.snapshot.createdAt,
                engineVersions: graph.snapshot.engineVersions,
            });

            return {
                apiVersion: INTELLIGENCE_API_VERSION,
                symbol,
                window: graph.snapshot.window,
                relationships: context.relationships,
                narrative: context.narrative,
                dataQuality: context.dataQuality,
                dataTimestamp: context.dataTimestamp,
                availableAt: context.calculatedAt,
                engineVersions: context.engineVersions,
                leadLag: graph.leadLag.filter(
                    (l) => l.leader === symbol || l.follower === symbol
                ),
                limitations: context.limitations,
                cost: { units: Math.max(1, context.relationships.length), currency: "credits" },
            };
        },
    });
}

export async function POST(request: Request) {
    return GET(request);
}
