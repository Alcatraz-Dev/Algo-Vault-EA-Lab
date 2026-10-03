/**
 * /api/extension/mcp-context
 *
 * Bridges the Chrome Extension's detected TradingViewContext to AlgoVault's
 * TradingView MCP integration, then composes a normalised response with
 * provenance stamps that the extension surfaces can render honestly.
 *
 * Behaviour:
 *   • Auth required (Firebase ID token).
 *   • Pro entitlement required (the MCP context is a premium capability).
 *   • Reads the MCP connection status; if not connected, returns a clearly
 *     labelled "not_connected" state — never fabricates data.
 *   • Fetches capabilities parallelisable on the request (quote, technicals,
 *     news) — all optional and individually fault-tolerant.
 *   • Honours per-capability feature flags from the TradingView provider.
 *   • All responses carry provenance metadata (source: TRADINGVIEW, cache
 *     state, freshness) so the UI can show what it actually has.
 *
 * This endpoint NEVER:
 *   - invents prices/levels/timeframes,
 *   - claims MCP data when MCP didn't return any,
 *   - sends tradingview credentials to the client,
 *   - executes orders.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import {
    ExternalProviderError,
    type ExternalQuote,
    type ExternalTechnicalSnapshot,
    type ExternalNewsItem,
    type ExternalEvidenceProvenance,
} from "@/lib/market-intelligence/providers/interfaces/external-intelligence-provider";
import { tradingViewMCPProvider } from "@/lib/market-intelligence/providers/tradingview/tradingview-mcp-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

interface Body {
    symbol?: string;
    exchange?: string | null;
    timeframe?: string;
}

interface NormalisedMCPContext {
    success: boolean;
    state: "not_connected" | "disabled" | "ready" | "partial" | "rate_limited" | "error";
    symbol: string | null;
    timeframe: string | null;
    exchange: string | null;
    connection: {
        provider: string;
        state: string;
        authorized: boolean;
        message?: string;
    };
    quote: ExternalQuote | null;
    technicals: ExternalTechnicalSnapshot | null;
    news: ExternalNewsItem[];
    capabilities: Array<{ id: string; supported: boolean }>;
    fetchedAt: number;
    durationMs: number;
    errors: Array<{ capability: string; code: string; message: string }>;
}

function shapeProvenance(p: ExternalEvidenceProvenance): ExternalEvidenceProvenance {
    return {
        ...p,
        delayed: p.delayed ?? false,
    };
}

async function isPro(uid: string): Promise<boolean> {
    try {
        // Admin override so internal staff can verify the surface.
        const roleSnap = await adminDatabase.ref(`users/${uid}/role`).get();
        if (roleSnap.exists() && roleSnap.val() === "admin") return true;
        const subSnap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        if (!subSnap.exists()) return false;
        const sub = subSnap.val();
        const active = sub?.status === "active" || sub?.status === "trialing" || sub?.active === true;
        const eligiblePlan = !sub?.plan || ["pro", "elite", "enterprise", "vip"].includes(String(sub.plan).toLowerCase());
        return Boolean(active && eligiblePlan);
    } catch {
        return false;
    }
}

export async function POST(request: NextRequest) {
    const t0 = Date.now();
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json(
                { success: false, state: "error", error: "missing_token" },
                { status: 401, headers: corsHeaders }
            );
        }
        const token = authHeader.slice("Bearer ".length).trim();
        let decoded;
        try {
            decoded = await adminAuth.verifyIdToken(token);
        } catch {
            return NextResponse.json(
                { success: false, state: "error", error: "invalid_token" },
                { status: 401, headers: corsHeaders }
            );
        }
        const uid = decoded.uid;

        if (!(await isPro(uid))) {
            return NextResponse.json(
                { success: false, state: "error", error: "pro_required" },
                { status: 403, headers: corsHeaders }
            );
        }

        const rawBody = (await request.json().catch(() => ({}))) as Body;
        const symbol = typeof rawBody?.symbol === "string" && rawBody.symbol.trim() ? rawBody.symbol.trim().toUpperCase() : null;
        const timeframe = typeof rawBody?.timeframe === "string" && rawBody.timeframe.trim() ? rawBody.timeframe.trim() : null;
        const exchange = typeof rawBody?.exchange === "string" && rawBody.exchange.trim() ? rawBody.exchange.trim().toUpperCase() : null;

        if (!symbol) {
            return NextResponse.json(
                { success: false, state: "error", error: "symbol_required" },
                { status: 400, headers: corsHeaders }
            );
        }

        // 1. Connection status — drives the entire response shape.
        const status = await tradingViewMCPProvider.getConnectionStatus(uid);
        const capabilities = tradingViewMCPProvider.describeCapabilities().map((c) => ({
            id: c.id,
            supported: c.supported && c.read,
        }));

        if (!status.enabled) {
            return NextResponse.json(
                {
                    success: true,
                    state: "disabled",
                    symbol,
                    timeframe,
                    exchange,
                    connection: { provider: "tradingview-mcp", state: status.state, authorized: status.authorized, message: status.message },
                    quote: null,
                    technicals: null,
                    news: [],
                    capabilities,
                    fetchedAt: Date.now(),
                    durationMs: Date.now() - t0,
                    errors: [],
                } satisfies NormalisedMCPContext,
                { status: 200, headers: corsHeaders }
            );
        }
        if (!status.authorized || status.state !== "CONNECTED") {
            return NextResponse.json(
                {
                    success: true,
                    state: (status.state as string) === "RATE_LIMITED" ? "rate_limited" : "not_connected",
                    symbol,
                    timeframe,
                    exchange,
                    connection: { provider: "tradingview-mcp", state: status.state, authorized: status.authorized, message: status.message },
                    quote: null,
                    technicals: null,
                    news: [],
                    capabilities,
                    fetchedAt: Date.now(),
                    durationMs: Date.now() - t0,
                    errors: [],
                } satisfies NormalisedMCPContext,
                { status: 200, headers: corsHeaders }
            );
        }

        // 2. Live capabilities — fetched in parallel, individually fault-tolerant.
        const errors: NormalisedMCPContext["errors"] = [];
        const [quote, technicals, news] = await Promise.all([
            tradingViewMCPProvider
                .getQuote(uid, symbol)
                .then((q) => q)
                .catch((err: unknown) => {
                    errors.push({
                        capability: "quote",
                        code: err instanceof ExternalProviderError ? err.code : "UNKNOWN_ERROR",
                        message: err instanceof Error ? err.message : "quote_failed",
                    });
                    return null;
                }),
            tradingViewMCPProvider
                .getTechnicalSnapshot(uid, symbol, timeframe || "1D")
                .then((t) => t)
                .catch((err: unknown) => {
                    errors.push({
                        capability: "technical_snapshot",
                        code: err instanceof ExternalProviderError ? err.code : "UNKNOWN_ERROR",
                        message: err instanceof Error ? err.message : "technicals_failed",
                    });
                    return null;
                }),
            tradingViewMCPProvider
                .getNews(uid, symbol, { limit: 5 })
                .then((n) => n)
                .catch((err: unknown) => {
                    errors.push({
                        capability: "news",
                        code: err instanceof ExternalProviderError ? err.code : "UNKNOWN_ERROR",
                        message: err instanceof Error ? err.message : "news_failed",
                    });
                    return [];
                }),
        ]);

        const allFailed = !quote && !technicals && news.length === 0;
        const state: NormalisedMCPContext["state"] = allFailed
            ? errors.some((e) => e.code === "RATE_LIMITED")
                ? "rate_limited"
                : "error"
            : "ready";

        const response: NormalisedMCPContext = {
            success: true,
            state,
            symbol,
            timeframe,
            exchange,
            connection: {
                provider: "tradingview-mcp",
                state: status.state,
                authorized: status.authorized,
                ...(status.message ? { message: status.message } : {}),
            },
            quote: quote
                ? {
                      ...quote,
                      provenance: shapeProvenance(quote.provenance),
                  }
                : null,
            technicals: technicals
                ? {
                      ...technicals,
                      provenance: shapeProvenance(technicals.provenance),
                  }
                : null,
            news: news.map((n) => ({ ...n, provenance: shapeProvenance(n.provenance) })),
            capabilities,
            fetchedAt: Date.now(),
            durationMs: Date.now() - t0,
            errors,
        };

        return NextResponse.json(response, { status: 200, headers: corsHeaders });
    } catch (err) {
        console.error("[POST /api/extension/mcp-context]", err);
        return NextResponse.json(
            {
                success: false,
                state: "error",
                error: err instanceof Error ? err.message : "server_error",
                durationMs: Date.now() - t0,
            },
            { status: 500, headers: corsHeaders }
        );
    }
}

export async function GET() {
    return NextResponse.json(
        { error: "Use POST { symbol, timeframe, exchange? }" },
        { status: 405, headers: corsHeaders }
    );
}