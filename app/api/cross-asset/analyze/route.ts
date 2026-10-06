/**
 * POST /api/cross-asset/analyze — on-demand computation of the market graph
 * (Phase 16 §46 `POST /market/analyze`).
 *
 * Auth: Firebase Bearer idToken. Snapshot persistence is Pro-only so a free
 * caller cannot rewrite the shared global snapshot on every render; everyone
 * gets a computed result (bounded, cached).
 *
 * Body: { symbol?, timeframe?, bars?, force?, persist? }
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { isProUser } from "@/lib/ai-signals/access";
import { computeCrossAssetGraph, DEFAULT_BARS, DEFAULT_TIMEFRAME } from "@/lib/cross-asset/service";
import type { CrossAssetTier, RelationshipWindowBars } from "@/lib/cross-asset/types";
import { RELATIONSHIP_TIMEFRAMES, RELATIONSHIP_WINDOWS } from "@/lib/cross-asset/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as {
            symbol?: unknown;
            timeframe?: unknown;
            bars?: unknown;
            force?: unknown;
            persist?: unknown;
        };

        const symbol = String(body.symbol ?? "").trim().toUpperCase() || undefined;
        const timeframeRaw = String(body.timeframe ?? DEFAULT_TIMEFRAME).toUpperCase();
        const timeframe = (RELATIONSHIP_TIMEFRAMES as readonly string[]).includes(timeframeRaw)
            ? timeframeRaw
            : DEFAULT_TIMEFRAME;
        const barsRaw = Number(body.bars ?? DEFAULT_BARS);
        const bars = (RELATIONSHIP_WINDOWS as readonly number[]).includes(barsRaw)
            ? (barsRaw as RelationshipWindowBars)
            : DEFAULT_BARS;

        const pro = await isProUser(user.uid);
        const tier: CrossAssetTier = pro ? "PRO" : "FREE";
        const persist = pro && body.persist !== false;

        const graph = await computeCrossAssetGraph({
            focusSymbol: symbol,
            timeframe,
            bars,
            tier,
            userId: user.uid,
            leadLag: pro,
            force: body.force === true,
            persist,
        });

        return NextResponse.json(
            {
                success: true,
                tier,
                snapshotId: graph.snapshot.snapshotId,
                persisted: persist,
                window: graph.snapshot.window,
                universe: graph.universe,
                counts: {
                    nodes: graph.snapshot.nodes.length,
                    edges: graph.snapshot.edges.length,
                    relationships: graph.relationships.length,
                    clusters: graph.clusters.length,
                    factors: graph.factors.length,
                    signals: graph.signals.filter((s) => s.status === "DETECTED" || s.status === "CONFIRMED").length,
                    regimeStates: graph.regime.snapshot.activeStates,
                    leadLag: graph.leadLag.length,
                },
                observability: graph.snapshot.observability,
                dataQuality: graph.snapshot.dataQuality,
                engineVersions: graph.snapshot.engineVersions,
                unavailableSymbols: graph.snapshot.unavailableSymbols,
                limitations: graph.limitations.slice(0, 12),
            },
            { status: 200 }
        );
    } catch (err) {
        console.error("[cross-asset/analyze] failed:", err);
        return NextResponse.json(
            { error: "CROSS_ASSET_UNAVAILABLE", detail: "Analysis failed — no partial graph returned." },
            { status: 503 }
        );
    }
}
