/**
 * GET/POST /api/v1/market/graph — Cross-Asset Intelligence for API tenants
 * (Phase 16 §46 `GET /market/graph`, §47 B2B).
 *
 * Thin delivery over the canonical cross-asset service through the shared
 * Intelligence Cloud pipeline: authentication → scope → entitlement → rate
 * limit → compute → usage metering → uniform error contract. No market logic
 * lives here.
 *
 * Query/body: symbol?, timeframe?, bars?, view?
 *   view = graph (default) | regime | clusters | factors | events
 *
 * Tenants receive the full deterministic graph (API access is a paid surface,
 * §47). The response always carries engineVersions + dataQuality + limitations
 * so a B2B consumer can enforce its own freshness checks (§44, §45).
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { INTELLIGENCE_API_VERSION } from "@/lib/intelligence-cloud/contracts";
import { computeCrossAssetGraph, DEFAULT_BARS, DEFAULT_TIMEFRAME } from "@/lib/cross-asset/service";
import type { RelationshipWindowBars } from "@/lib/cross-asset/types";
import { RELATIONSHIP_TIMEFRAMES, RELATIONSHIP_WINDOWS } from "@/lib/cross-asset/types";

export const dynamic = "force-dynamic";

const VIEWS = new Set(["graph", "regime", "clusters", "factors", "events", "relationships"]);

function pickString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function pickBars(value: unknown): RelationshipWindowBars {
    const n = Number(value);
    return (RELATIONSHIP_WINDOWS as readonly number[]).includes(n)
        ? (n as RelationshipWindowBars)
        : DEFAULT_BARS;
}

export async function GET(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: "market:read",
            requiredEntitlement: "market.intelligence",
            endpoint: "GET /v1/market/graph",
            usageCategory: "market.data",
            apiVersion: INTELLIGENCE_API_VERSION,
            build: (intelligence) => intelligence,
        },
        run: async (body) => {
            const timeframeRaw = pickString(body.timeframe, DEFAULT_TIMEFRAME).toUpperCase();
            const timeframe = (RELATIONSHIP_TIMEFRAMES as readonly string[]).includes(timeframeRaw)
                ? timeframeRaw
                : DEFAULT_TIMEFRAME;
            const view = pickString(body.view, "graph").toLowerCase();

            const graph = await computeCrossAssetGraph({
                focusSymbol: typeof body.symbol === "string" ? body.symbol.toUpperCase() : undefined,
                timeframe,
                bars: pickBars(body.bars),
                tier: "PRO",
                leadLag: true,
            });

            const base = {
                apiVersion: INTELLIGENCE_API_VERSION,
                view: VIEWS.has(view) ? view : "graph",
                window: graph.snapshot.window,
                universe: graph.universe,
                dataTimestamp: graph.snapshot.dataTimestamp,
                availableAt: graph.snapshot.createdAt,
                engineVersions: graph.snapshot.engineVersions,
                dataQuality: graph.snapshot.dataQuality,
                observability: graph.snapshot.observability,
                unavailableSymbols: graph.snapshot.unavailableSymbols,
                limitations: graph.limitations,
                cost: { units: Math.max(1, graph.relationships.length), currency: "credits" },
            };

            switch (base.view) {
                case "regime":
                    return { ...base, regime: graph.regime.snapshot, transitions: graph.regime.transitions };
                case "clusters":
                    return { ...base, clusters: graph.clusters, clusterChanges: graph.clusterChanges };
                case "factors":
                    return { ...base, factors: graph.factors };
                case "events":
                    return { ...base, events: graph.signals };
                case "relationships":
                    return {
                        ...base,
                        relationships: graph.relationships.map((r) => ({
                            a: r.a,
                            b: r.b,
                            coefficient: r.coefficient,
                            type: r.type,
                            stability: r.stability,
                            window: r.window,
                            sampleSize: r.sampleSize,
                            dataQuality: r.dataQuality,
                        })),
                    };
                default:
                    return {
                        ...base,
                        nodes: graph.snapshot.nodes,
                        edges: graph.snapshot.edges,
                        signals: graph.signals,
                    };
            }
        },
    });
}

export async function POST(request: Request) {
    return GET(request);
}
