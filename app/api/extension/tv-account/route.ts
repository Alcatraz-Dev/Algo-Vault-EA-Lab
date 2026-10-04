import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { hasActiveTradingLicense } from "@/lib/gateway";
import { tradingViewMCPProvider } from "@/lib/market-intelligence/providers/tradingview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/extension/tv-account
 *
 * Reports what the installed TradingView integration ACTUALLY supports:
 *   • the real OAuth connection record of the TradingView MCP provider
 *   • capability descriptors from live `tools/list` discovery when the
 *     provider is connected (static mapping + `verified: false` otherwise)
 *   • execution support: the MCP toolset is read-only, so TradingView MCP
 *     execution is always `false`; gateway execution is reported from the
 *     user's real trading entitlement + connected gateway account
 *
 * This endpoint never fabricates broker, account or mode data — it only
 * reports connection/capability state. No credentials are returned.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // 1. Real MCP connection record (never fabricated).
    const connection = await tradingViewMCPProvider
      .getConnectionStatus(user.uid)
      .then((status) => ({
        state: String(status.state),
        authorized: Boolean(status.authorized),
        message: status.message ?? null,
        scopes: status.scopes ?? [],
      }))
      .catch((err: unknown) => ({
        state: "ERROR",
        authorized: false,
        message: err instanceof Error ? err.message : "Connection status unavailable.",
        scopes: [] as string[],
      }));

    // 2. Live tool discovery (read-only toolset). Falls back to the static
    //    capability mapping when the provider cannot be reached.
    let capabilities = tradingViewMCPProvider.describeCapabilities().map((c) => ({
      id: c.id,
      label: c.label,
      supported: c.supported,
      read: c.read,
      tools: c.tools,
    }));
    let capabilitySource: "live_tools_list" | "static_mapping" = "static_mapping";
    if (connection.authorized) {
      try {
        const tools = await tradingViewMCPProvider.refreshToolList(user.uid);
        capabilities = tradingViewMCPProvider.describeCapabilities().map((c) => ({
          id: c.id,
          label: c.label,
          supported: c.supported,
          read: c.read,
          tools: c.tools,
        }));
        capabilitySource = tools.length > 0 ? "live_tools_list" : "static_mapping";
      } catch {
        capabilitySource = "static_mapping";
      }
    }

    // 3. Gateway entitlement + connected account (real execution path).
    const [hasLicense, accountsSnap] = await Promise.all([
      hasActiveTradingLicense(user.uid).catch(() => false),
      adminDatabase.ref(`trading_accounts/${user.uid}`).get().catch(() => null),
    ]);
    const accountsCount = accountsSnap && accountsSnap.exists() ? Object.keys(accountsSnap.val() || {}).length : 0;
    const gatewayConnected = accountsCount > 0;

    let accountState = "NOT_CONNECTED";
    if (gatewayConnected) accountState = "TRADING_ENABLED";
    else if (connection.state === "TOKEN_EXPIRED" || connection.state === "REAUTH_REQUIRED") {
      accountState = "AUTHENTICATION_REQUIRED";
    } else if (connection.state === "ERROR") accountState = "ERROR";
    else if (connection.state === "CONNECTED") accountState = "EXECUTION_UNAVAILABLE";

    const mcpExecutionSupported = false; // verified: READ_TOOLS_ONLY in the MCP provider

    return NextResponse.json(
      {
        success: true,
        connection,
        capabilities,
        capabilitySource,
        execution: {
          tradingViewMcpExecutionSupported: mcpExecutionSupported,
          gatewayExecutionSupported: gatewayConnected && hasLicense,
          reason: mcpExecutionSupported
            ? "TradingView MCP execution is supported."
            : "TradingView MCP provides read-only market data (no account/order/position tools). Order execution is available through the AlgoVault MT5 Gateway when connected.",
        },
        accountState,
        gateway: { connected: gatewayConnected, accountsCount, entitled: hasLicense },
        timestamp: Date.now(),
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("[GET /api/extension/tv-account]", err);
    return NextResponse.json(
      { error: "Failed to fetch TradingView account state." },
      { status: 500, headers: corsHeaders }
    );
  }
}
