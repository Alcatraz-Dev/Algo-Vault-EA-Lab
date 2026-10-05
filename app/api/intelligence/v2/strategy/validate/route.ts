import { NextRequest, NextResponse } from "next/server";
import { createIntelligenceCloud } from "@/lib/intelligence-cloud";
import { validateApiKey } from "@/lib/api-key-auth";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const userId = await validateApiKey(token);
    if (!userId) return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });

    const body = await request.json();
    const { definition, symbol, timeframe, context } = body || {};
    if (!definition) return NextResponse.json({ error: "strategy definition is required", code: "VALIDATION_ERROR" }, { status: 400 });

    const cloud = createIntelligenceCloud();
    const result = await cloud.validateStrategy({ definition, symbol: symbol ? String(symbol) : undefined, timeframe: timeframe ? String(timeframe) : undefined, context });

    return NextResponse.json({ success: true, result, apiVersion: "v2" });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
