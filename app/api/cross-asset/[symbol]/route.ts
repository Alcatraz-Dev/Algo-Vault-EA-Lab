/**
 * GET /api/cross-asset/[symbol] — Cross-Asset Context for one instrument
 * (Phase 16 §19, §20, §24).
 *
 * Returns the §19 payload: meaningful connected assets, stability, regime,
 * factors, active signals and (when the user has holdings) portfolio impact.
 * FREE receives the same shape with a smaller cap and no advanced sections —
 * the panel degrades honestly instead of showing empty fake cards.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { isProUser } from "@/lib/ai-signals/access";
import { getSymbolCrossAssetContext, DEFAULT_BARS, DEFAULT_TIMEFRAME } from "@/lib/cross-asset/service";
import { crossAssetLimits } from "@/lib/cross-asset/context";
import type { CrossAssetTier, RelationshipWindowBars } from "@/lib/cross-asset/types";
import { RELATIONSHIP_TIMEFRAMES, RELATIONSHIP_WINDOWS } from "@/lib/cross-asset/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ symbol: string }> }
) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { symbol: rawSymbol } = await params;
        const symbol = String(rawSymbol ?? "").trim().toUpperCase();
        if (!symbol || symbol.length > 20) {
            return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
        }

        const query = request.nextUrl.searchParams;
        const timeframeRaw = (query.get("timeframe") ?? DEFAULT_TIMEFRAME).toUpperCase();
        const timeframe = (RELATIONSHIP_TIMEFRAMES as readonly string[]).includes(timeframeRaw)
            ? timeframeRaw
            : DEFAULT_TIMEFRAME;
        const barsRaw = Number(query.get("bars") ?? DEFAULT_BARS);
        const bars = (RELATIONSHIP_WINDOWS as readonly number[]).includes(barsRaw)
            ? (barsRaw as RelationshipWindowBars)
            : DEFAULT_BARS;

        const pro = await isProUser(user.uid);
        const tier: CrossAssetTier = pro ? "PRO" : "FREE";
        const limits = crossAssetLimits(tier);

        const context = await getSymbolCrossAssetContext({
            symbol,
            focusSymbol: symbol,
            timeframe,
            bars,
            tier,
            userId: user.uid,
            leadLag: pro,
        });

        const trimmed = pro
            ? context
            : {
                  ...context,
                  // Free: basic related markets only (§51).
                  relationships: context.relationships.slice(0, 3),
                  clusters: [],
                  factors: [],
                  signals: [],
                  regime: null,
                  limitations: [
                      ...context.limitations,
                      "Free tier shows the top relationships only — full graph, regime, clusters and events are Pro.",
                  ],
              };

        return NextResponse.json(
            {
                success: true,
                tier,
                limits,
                context: trimmed,
            },
            { status: 200 }
        );
    } catch (err) {
        console.error("[cross-asset] symbol context failed:", err);
        return NextResponse.json(
            { error: "CROSS_ASSET_UNAVAILABLE", detail: "No cross-asset context could be computed." },
            { status: 503 }
        );
    }
}
