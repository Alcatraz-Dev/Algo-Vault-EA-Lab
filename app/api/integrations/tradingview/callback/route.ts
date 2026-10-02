import { NextRequest, NextResponse } from "next/server";
import {
    completeTradingViewConnection,
    TradingViewConnectionError,
} from "@/lib/market-intelligence/providers/tradingview/connection-service";
import { logTradingViewAudit } from "@/lib/market-intelligence/providers/tradingview/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appUrl(request: NextRequest): string {
    const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
    if (configured) return configured;
    return request.nextUrl.origin;
}

/**
 * GET /api/integrations/tradingview/callback
 *
 * OAuth 2.1 redirect target. Verifies the single-use server-side state
 * (CSRF protection), exchanges the authorization code with PKCE, and stores
 * the encrypted token bundle server-side. The user's browser only ever sees
 * a redirect — no tokens, no secrets.
 */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const oauthError = params.get("error");
    const oauthErrorDescription = params.get("error_description");
    const code = params.get("code");
    const state = params.get("state");
    const base = appUrl(request);

    if (oauthError) {
        console.warn("[tradingview-mcp] authorization denied by provider:", oauthError);
        return NextResponse.redirect(`${base}/account/settings?tab=integrations&tradingview=${encodeURIComponent("denied")}`);
    }
    if (!code || !state) {
        return NextResponse.redirect(`${base}/account/settings?tab=integrations&tradingview=${encodeURIComponent("invalid_response")}`);
    }

    try {
        const { uid } = await completeTradingViewConnection({ code, state });
        await logTradingViewAudit({ uid, action: "connection.completed" });
        return NextResponse.redirect(`${base}/account/settings?tab=integrations&tradingview=connected`);
    } catch (err) {
        const message = err instanceof TradingViewConnectionError || err instanceof Error ? err.message : "TradingView authorization failed.";
        console.error("[tradingview-mcp] callback failed:", message);
        return NextResponse.redirect(`${base}/account/settings?tab=integrations&tradingview=${encodeURIComponent("failed")}`);
    }
}
