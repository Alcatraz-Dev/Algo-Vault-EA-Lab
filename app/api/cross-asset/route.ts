/**
 * GET /api/cross-asset — canonical Global Cross-Asset Intelligence Graph
 * (Phase 16 §46 internal surface; the tenant-facing surface is /api/v1/market/*).
 *
 * Auth: Firebase Bearer idToken (user routes convention — §O). Tier is read
 * server-side from the subscription (fail-closed: unknown → FREE), so the
 * free/pro split can never be trusted from the client.
 *
 * Query params:
 *   symbol      — focus symbol (priority 1 of the bounded universe)
 *   timeframe   — M5|M15|M30|H1|H4|D1 (default H1)
 *   bars        — 20|50|100|250|500 (default 100)
 *   include     — comma list of `clusters,factors,signals,regime,matrix`
 *                 (advanced sections are Pro-only, §51)
 *   force       — `1` skips the cache
 *
 * The response always carries `engineVersions`, `dataQuality` and
 * `limitations` so a consumer can tell measured data from absence (§45).
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { isProUser } from "@/lib/ai-signals/access";
import { correlationMatrixCells } from "@/lib/cross-asset/relationships";
import { computeCrossAssetGraph, DEFAULT_BARS, DEFAULT_TIMEFRAME } from "@/lib/cross-asset/service";
import { crossAssetLimits } from "@/lib/cross-asset/context";
import type { CrossAssetTier, RelationshipWindowBars } from "@/lib/cross-asset/types";
import { RELATIONSHIP_TIMEFRAMES, RELATIONSHIP_WINDOWS } from "@/lib/cross-asset/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const params = request.nextUrl.searchParams;
        const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
        const timeframeRaw = (params.get("timeframe") ?? DEFAULT_TIMEFRAME).toUpperCase();
        const timeframe = (RELATIONSHIP_TIMEFRAMES as readonly string[]).includes(timeframeRaw)
            ? timeframeRaw
            : DEFAULT_TIMEFRAME;
        const barsRaw = Number(params.get("bars") ?? DEFAULT_BARS);
        const bars = (RELATIONSHIP_WINDOWS as readonly number[]).includes(barsRaw)
            ? (barsRaw as RelationshipWindowBars)
            : DEFAULT_BARS;
        const include = new Set(
            (params.get("include") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
        );
        const force = params.get("force") === "1";

        const pro = await isProUser(user.uid);
        const tier: CrossAssetTier = pro ? "PRO" : "FREE";
        const limits = crossAssetLimits(tier);

        const watchlist = params.get("watchlist")
            ? params
                  .get("watchlist")!
                  .split(",")
                  .map((s) => s.trim().toUpperCase())
                  .filter(Boolean)
                  .slice(0, 10)
            : undefined;

        const graph = await computeCrossAssetGraph({
            focusSymbol: symbol || undefined,
            watchlist,
            timeframe,
            bars,
            tier,
            userId: user.uid,
            leadLag: pro && include.has("leadlag"),
            force,
        });

        const cells = correlationMatrixCells(
            graph.relationships,
            graph.universe.filter((s) => graph.relationships.some((r) => (r.a === s || r.b === s)))
        );

        const body: Record<string, unknown> = {
            success: true,
            tier,
            limits,
            window: graph.snapshot.window,
            universe: graph.universe,
            unavailableSymbols: graph.snapshot.unavailableSymbols,
            snapshot: {
                snapshotId: graph.snapshot.snapshotId,
                createdAt: graph.snapshot.createdAt,
                dataTimestamp: graph.snapshot.dataTimestamp,
                engineVersions: graph.snapshot.engineVersions,
                dataQuality: graph.snapshot.dataQuality,
                observability: graph.snapshot.observability,
                limitations: graph.snapshot.limitations,
            },
            nodes: graph.snapshot.nodes,
            edges: graph.snapshot.edges,
            relationships: graph.relationships.map((r) => ({
                a: r.a,
                b: r.b,
                coefficient: r.coefficient,
                previousCoefficient: r.previousCoefficient,
                delta: r.delta,
                type: r.type,
                stability: r.stability,
                term: r.term,
                window: r.window,
                sampleSize: r.sampleSize,
                dataQuality: r.dataQuality,
                confidence: r.confidence,
                claims: r.claims,
                observations: r.observations,
            })),
            leadLag: pro ? graph.leadLag : [],
            limitations: graph.limitations,
        };

        // Advanced sections are Pro (§51) — absent for FREE, not faked empty.
        if (pro && include.has("matrix")) body.matrix = cells;
        if (pro && include.has("clusters")) {
            body.clusters = graph.clusters;
            body.clusterChanges = graph.clusterChanges;
        }
        if (pro && include.has("factors")) body.factors = graph.factors;
        if (pro && include.has("signals")) body.signals = graph.signals;
        if (pro && include.has("regime")) {
            body.regime = graph.regime.snapshot;
            body.regimeTransitions = graph.regime.transitions;
        }
        if (!pro) {
            body.upgrade = [
                "Correlation matrix",
                "Dynamic clusters",
                "Market factors",
                "Regime intelligence",
                "Cross-asset events",
                "Lead-lag analysis",
                "Market Relationship Explorer",
            ];
        }

        return NextResponse.json(body, { status: 200 });
    } catch (err) {
        console.error("[cross-asset] graph failed:", err);
        // Fail-closed: an honest error beats a graph built from partial data (§45).
        return NextResponse.json(
            {
                error: "CROSS_ASSET_UNAVAILABLE",
                detail: "The cross-asset engine could not produce a graph for this request.",
            },
            { status: 503 }
        );
    }
}
