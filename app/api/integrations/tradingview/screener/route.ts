import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { discoverScreenerCandidates } from "@/lib/market-intelligence/research/tradingview-research";
import { logTradingViewAudit } from "@/lib/market-intelligence/providers/tradingview/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/tradingview/screener
 * Authenticated. Runs the TradingView screener and returns candidate
 * instruments as RESEARCH INPUTS for AlgoVault Intelligence (Smart Money /
 * MTF / liquidity analysis where supported). Candidates are never converted
 * into trading signals automatically.
 */
export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    try {
        const body = (await request.json().catch(() => ({}))) as {
            market?: string;
            filters?: Record<string, unknown>;
            filterPreset?: string;
            limit?: number;
            sortBy?: string;
            sortOrder?: "asc" | "desc";
        };

        const outcome = await discoverScreenerCandidates(token.uid, {
            market: typeof body.market === "string" ? body.market : undefined,
            filters: body.filters && typeof body.filters === "object" ? body.filters : undefined,
            filterPreset: typeof body.filterPreset === "string" ? body.filterPreset : undefined,
            limit: typeof body.limit === "number" ? body.limit : undefined,
            sortBy: typeof body.sortBy === "string" ? body.sortBy : undefined,
            sortOrder: body.sortOrder === "asc" || body.sortOrder === "desc" ? body.sortOrder : undefined,
        });

        await logTradingViewAudit({
            uid: token.uid,
            action: "read.capability",
            capability: "screener",
            detail: { state: outcome.state, candidates: outcome.candidates.length },
        });

        return NextResponse.json({
            success: outcome.state === "CONNECTED",
            state: outcome.state,
            ...(outcome.message ? { message: outcome.message } : {}),
            candidates: outcome.candidates,
            note: "Candidates are research inputs only — AlgoVault Intelligence analysis required; never auto-signals.",
        });
    } catch (err) {
        console.error("[tradingview-mcp] screener failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "Screener request failed." }, { status: 500 });
    }
}
