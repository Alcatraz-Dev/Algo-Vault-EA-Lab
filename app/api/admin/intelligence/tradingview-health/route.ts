import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getMcpMetrics } from "@/lib/market-intelligence/providers/tradingview/observability";
import { getTradingViewFlags } from "@/lib/market-intelligence/providers/tradingview/feature-flags";
import { getMcpSessionInfo } from "@/lib/market-intelligence/providers/tradingview/mcp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/intelligence/tradingview-health
 * Admin-only observability view (PHASE 18): request counts, latency,
 * success/failure, rate-limit/auth/outage events, cache hits/misses.
 * Contains no tokens or user identifiers.
 */
export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }
    const flags = getTradingViewFlags();
    return NextResponse.json({
        success: true,
        flags: {
            master: flags.master,
            news: flags.news,
            technicals: flags.technicals,
            screener: flags.screener,
            economicCalendar: flags.economicCalendar,
            fundamentals: flags.fundamentals,
            watchlists: flags.watchlists,
            alerts: flags.alerts,
        },
        session: getMcpSessionInfo(),
        metrics: getMcpMetrics(),
        note: "Metrics cover the last hour within this server instance. No tokens or secrets are included.",
    });
}
