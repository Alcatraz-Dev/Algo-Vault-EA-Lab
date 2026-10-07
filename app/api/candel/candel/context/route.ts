import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getCandelAccountContext, saveCandelAccountContext } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelAccountContext } from "@/lib/candel/types";

// GET /api/candel/candel/context/[candelId]/[accountId] — account context
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const accountId = searchParams.get("accountId");
    if (!candelId || !accountId) return NextResponse.json({ success: false, error: "candelId and accountId required" }, { status: 400 });

    await requireCandelReadable(candelId, token.uid);

    const context = await getCandelAccountContext(candelId, token.uid, accountId);
    if (!context) {
      return NextResponse.json({ success: true, context: null });
    }

    const extended = {
      ...context,
      balance: context.balance || 0,
      equity: context.equity || 0,
      margin: context.margin || 0,
      openPositions: context.openPositions || 0,
      openOrders: context.openOrders || 0,
      riskMetrics: context.riskMetrics || {},
      challengeRules: context.challengeRules || {},
      broker: "Demo",
      accountType: "demo",
      currency: "USD",
      freeMargin: 0,
      realizedPL: 0,
      unrealizedPL: 0,
      dailyPL: 0,
      drawdown: 0,
      riskState: "none",
      symbol: "XAUUSD",
      timeframe: "M5",
      proOnly: false,
    };

    return NextResponse.json({ success: true, context: extended });
  } catch (error) {
    console.error("[candel/context GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load account context" }, { status: 500 });
  }
}

// POST /api/candel/candel/context/[candelId]/[accountId] — persist account context
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const accountId = searchParams.get("accountId");
    if (!candelId || !accountId) return NextResponse.json({ success: false, error: "candelId and accountId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { broker, accountType, currency, balance, equity, freeMargin, margin, openPositions, openOrders, riskMetrics, challengeRules, symbol, timeframe } = body;

    const context: CandelAccountContext = {
      accountId,
      balance: balance ?? 0,
      equity: equity ?? 0,
      margin: margin ?? 0,
      openPositions: openPositions ?? 0,
      openOrders: openOrders ?? 0,
      riskMetrics: riskMetrics ?? {},
      challengeRules: challengeRules ?? {},
    };
    await saveCandelAccountContext(candelId, token.uid, accountId, context);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/context POST]", error);
    return NextResponse.json({ success: false, error: "Failed to save account context" }, { status: 500 });
  }
}
