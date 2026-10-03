import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";

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

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    return NextResponse.json(
      {
        success: true,
        accountState: "EXECUTION_UNAVAILABLE",
        mcpStatus: {
          mcpAvailable: true,
          capabilities: [
            "market_data_read",
            "technical_analysis",
            "symbol_search",
            "screener",
            "news",
            "watchlists",
          ],
          executionSupported: false,
          reason:
            "TradingView MCP provides read-only market data. Execute trades using AlgoVault Gateway (MT5 integration).",
        },
        supportedExecutionModes: ["GATEWAY_MT5"],
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
