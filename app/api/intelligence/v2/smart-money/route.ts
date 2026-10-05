import { NextRequest, NextResponse } from "next/server";
import { createIntelligenceCloud } from "@/lib/intelligence-cloud";
import { validateApiKey } from "@/lib/api-key-auth";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const userId = await validateApiKey(token);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { symbol, timeframe } = body || {};
    if (!symbol || !timeframe) return NextResponse.json({ error: "symbol and timeframe are required", code: "VALIDATION_ERROR" }, { status: 400 });

    const cloud = createIntelligenceCloud({ includeLineage: true });
    const result = await cloud.getMarketIntelligence({ symbol: String(symbol), timeframe: String(timeframe), context: { smartMoney: true, liquidity: true } });

    return NextResponse.json({
      success: true,
      smartMoney: result.smartMoney,
      liquidity: result.liquidity,
      symbol: result.symbol,
      timeframe: result.timeframe,
      apiVersion: result.apiVersion,
      engineVersions: result.engineVersions,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
