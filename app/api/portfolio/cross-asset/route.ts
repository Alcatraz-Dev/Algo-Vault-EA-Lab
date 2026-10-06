/**
 * GET /api/portfolio/cross-asset — Cross-Asset Intelligence × Portfolio
 * (Phase 16 §24).
 *
 * Answers "how does the global picture touch MY book?":
 *   • per-held-symbol portfolio impact (correlated holdings + concentration
 *     warnings) from the canonical impact builder — no re-implemented exposure
 *     maths;
 *   • the global regime that the book is sitting in;
 *   • relationship status of every held symbol.
 *
 * Auth: Firebase Bearer idToken. Holdings come from the canonical Phase 15
 * portfolio bundle (server-side only) — the response never accepts a book from
 * the request body (§50).
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { isProUser } from "@/lib/ai-signals/access";
import { buildPortfolioBundle, DEFAULT_PORTFOLIO_ID } from "@/lib/portfolio/service";
import { buildPortfolioImpact, crossAssetLimits } from "@/lib/cross-asset/context";
import { computeCrossAssetGraph, DEFAULT_BARS, DEFAULT_TIMEFRAME } from "@/lib/cross-asset/service";
import type { CrossAssetTier, RelationshipWindowBars } from "@/lib/cross-asset/types";
import { RELATIONSHIP_TIMEFRAMES, RELATIONSHIP_WINDOWS } from "@/lib/cross-asset/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const params = request.nextUrl.searchParams;
        const timeframeRaw = (params.get("timeframe") ?? DEFAULT_TIMEFRAME).toUpperCase();
        const timeframe = (RELATIONSHIP_TIMEFRAMES as readonly string[]).includes(timeframeRaw)
            ? timeframeRaw
            : DEFAULT_TIMEFRAME;
        const barsRaw = Number(params.get("bars") ?? DEFAULT_BARS);
        const bars = (RELATIONSHIP_WINDOWS as readonly number[]).includes(barsRaw)
            ? (barsRaw as RelationshipWindowBars)
            : DEFAULT_BARS;

        const pro = await isProUser(user.uid);
        const tier: CrossAssetTier = pro ? "PRO" : "FREE";
        const limits = crossAssetLimits(tier);

        const bundle = await buildPortfolioBundle({ userId: user.uid, portfolioId: DEFAULT_PORTFOLIO_ID });
        const exposure = bundle.snapshot.exposure;
        const holdings = exposure.bySymbol
            .filter((slice) => slice.grossNotional > 0)
            .map((slice) => ({ symbol: slice.key, grossNotional: slice.grossNotional }));

        if (holdings.length === 0) {
            return NextResponse.json(
                {
                    success: true,
                    tier,
                    limits,
                    status: "NO_HOLDINGS",
                    holdings: [],
                    warnings: [],
                    limitations: [
                        "No open holdings with measurable exposure — cross-asset portfolio impact is not applicable (§24).",
                        ...(bundle.unavailableSymbols.length > 0
                            ? [`Portfolio has unavailable symbols: ${bundle.unavailableSymbols.join(", ")}.`]
                            : []),
                    ],
                },
                { status: 200 }
            );
        }

        const focus = (params.get("symbol") ?? "").trim().toUpperCase() || holdings[0].symbol;

        const graph = await computeCrossAssetGraph({
            focusSymbol: focus,
            timeframe,
            bars,
            tier,
            userId: user.uid,
            leadLag: false,
            holdings,
            grossExposure: exposure.grossExposure,
        });

        const perSymbol = holdings.map((holding) => {
            const impact = buildPortfolioImpact({
                focusSymbol: holding.symbol,
                holdings,
                grossExposure: exposure.grossExposure,
                relationships: graph.relationships,
                clusters: graph.clusters,
            });
            const related = graph.relationships
                .filter((r) => (r.a === holding.symbol || r.b === holding.symbol) && r.coefficient !== null)
                .sort((x, y) => Math.abs(y.coefficient ?? 0) - Math.abs(x.coefficient ?? 0))
                .slice(0, 4)
                .map((r) => ({
                    symbol: r.a === holding.symbol ? r.b : r.a,
                    coefficient: r.coefficient,
                    stability: r.stability,
                }));
            return {
                symbol: holding.symbol,
                grossNotional: holding.grossNotional,
                grossWeight:
                    exposure.grossExposure > 0
                        ? Math.round((holding.grossNotional / exposure.grossExposure) * 10_000) / 10_000
                        : 0,
                impact,
                relationships: related,
            };
        });

        const warnings = perSymbol.flatMap((s) => s.impact.warnings);
        const dedupedWarnings = warnings.filter(
            (w, i, arr) => arr.findIndex((x) => x.text === w.text) === i
        );

        return NextResponse.json(
            {
                success: true,
                tier,
                limits,
                status: "AVAILABLE",
                portfolioId: DEFAULT_PORTFOLIO_ID,
                grossExposure: exposure.grossExposure,
                window: graph.snapshot.window,
                regime: graph.regime
                    ? { activeStates: graph.regime.snapshot.activeStates, states: graph.regime.snapshot.states }
                    : null,
                holdings: perSymbol,
                warnings: dedupedWarnings,
                activeSignals: graph.signals.filter(
                    (s) => s.status === "DETECTED" || s.status === "CONFIRMED"
                ).length,
                dataTimestamp: graph.snapshot.dataTimestamp,
                engineVersions: graph.snapshot.engineVersions,
                limitations: [
                    "Correlated exposure compounds risk; it does not predict loss. Position decisions still require the Risk Engine (§57).",
                    ...graph.limitations.slice(0, 8),
                ],
            },
            { status: 200 }
        );
    } catch (err) {
        console.error("[portfolio/cross-asset] failed:", err);
        return NextResponse.json(
            { error: "CROSS_ASSET_UNAVAILABLE", detail: "Portfolio cross-asset context could not be computed." },
            { status: 503 }
        );
    }
}
