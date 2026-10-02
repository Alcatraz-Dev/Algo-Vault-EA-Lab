import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import {
    disconnectTradingView,
    getTradingViewStatusForUser,
} from "@/lib/market-intelligence/providers/tradingview/connection-service";
import { logTradingViewAudit } from "@/lib/market-intelligence/providers/tradingview/audit";
import { publicTradingViewFlags } from "@/lib/market-intelligence/providers/tradingview/feature-flags";
import { tradingViewMCPProvider } from "@/lib/market-intelligence/providers/tradingview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/tradingview
 * Authenticated. Returns the caller's TradingView connection status and the
 * effective capability flags. Contains NO tokens or secrets — state only.
 */
export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const status = await getTradingViewStatusForUser(token.uid);
    const capabilities = tradingViewMCPProvider.describeCapabilities();
    return NextResponse.json({
        success: true,
        status,
        flags: publicTradingViewFlags(),
        capabilities: capabilities.map((c) => ({ id: c.id, label: c.label, supported: c.supported, read: c.read })),
        notice: "TradingView MCP data may be delayed and is not intended for latency-sensitive execution.",
        beta: true,
    });
}

/**
 * POST /api/integrations/tradingview/disconnect
 * Authenticated. Revokes + deletes the caller's stored TradingView tokens.
 */
export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    try {
        const result = await disconnectTradingView(token.uid);
        await logTradingViewAudit({ uid: token.uid, action: "connection.disconnected", detail: { revoked: result.revoked } });
        return NextResponse.json({ success: true, revoked: result.revoked });
    } catch (err) {
        console.error("[tradingview-mcp] disconnect failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "Failed to disconnect TradingView." }, { status: 500 });
    }
}
