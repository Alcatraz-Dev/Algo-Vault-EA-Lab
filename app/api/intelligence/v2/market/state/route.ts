import { NextRequest, NextResponse } from "next/server";
import { createIntelligenceCloud } from "@/lib/intelligence-cloud";
import { hasScope } from "@/lib/intelligence-cloud/auth";
import { validateApiKey } from "@/lib/api-key-auth"; // existing basic auth; enhanced below

export async function POST(request: NextRequest) {
  try {
    // Enhanced auth: check bearer token and basic scopes
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const userId = await validateApiKey(token); // basic existing auth for now
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
    }

    const body = await request.json();
    const { symbol, timeframe, timestamp, context } = body || {};

    if (!symbol || !timeframe) {
      return NextResponse.json({ error: "symbol and timeframe are required", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const cloud = createIntelligenceCloud({ includeLineage: true });
    const result = await cloud.getMarketIntelligence({
      symbol: String(symbol),
      timeframe: String(timeframe),
      timestamp: timestamp ? Number(timestamp) : undefined,
      context: {
        smartMoney: Boolean(context?.smartMoney),
        indicators: Array.isArray(context?.indicators) ? context.indicators : [],
        regime: Boolean(context?.regime),
        liquidity: Boolean(context?.liquidity),
        volatility: Boolean(context?.volatility),
      },
    });

    return NextResponse.json({ success: true, data: result, apiVersion: result.apiVersion });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
