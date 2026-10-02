import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import {
    beginTradingViewConnection,
    TradingViewConnectionError,
} from "@/lib/market-intelligence/providers/tradingview/connection-service";
import { getTradingViewStatusForUser } from "@/lib/market-intelligence/providers/tradingview/connection-service";
import { logTradingViewAudit } from "@/lib/market-intelligence/providers/tradingview/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/tradingview/connect
 * Authenticated (Firebase bearer). Starts the OAuth 2.1 + PKCE authorization
 * flow for the CALLER's own TradingView account. Returns the authorization
 * URL for a browser redirect. Tokens never appear in any response.
 */
export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    try {
        const status = await getTradingViewStatusForUser(token.uid);
        const { authorizationUrl, expiresInSeconds } = await beginTradingViewConnection(token.uid);
        await logTradingViewAudit({ uid: token.uid, action: "connection.started" });
        return NextResponse.json({
            success: true,
            authorizationUrl,
            expiresInSeconds,
            currentState: status.state,
        });
    } catch (err) {
        const status = err instanceof TradingViewConnectionError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Failed to start TradingView connection.";
        if (status >= 500) {
            console.error("[tradingview-mcp] connect failed:", message);
        }
        return NextResponse.json({ success: false, error: message }, { status });
    }
}

/**
 * GET /api/integrations/tradingview/connect
 * Convenience alias for the connection status (used by the settings UI and
 * the Chrome Extension).
 */
export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const status = await getTradingViewStatusForUser(token.uid);
    return NextResponse.json({ success: true, status });
}
