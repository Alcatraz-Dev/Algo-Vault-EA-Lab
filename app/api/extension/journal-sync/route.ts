import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const body = await request.json();

    // Security check: ensure no credentials or sensitive tokens are stored
    const jsonString = JSON.stringify(body).toLowerCase();
    if (
      jsonString.includes("password") ||
      jsonString.includes("secret") ||
      jsonString.includes("privatekey") ||
      jsonString.includes("api_key")
    ) {
      return NextResponse.json(
        { error: "Security violation: Sensitive credential patterns detected." },
        { status: 400, headers: corsHeaders }
      );
    }

    const entryId = body.tradeId || `trade-${Date.now()}`;
    const payload = {
      id: entryId,
      tradeId: entryId,
      symbol: body.symbol,
      type: body.side || body.type || "BUY",
      side: body.side || "BUY",
      orderType: body.orderType || "MARKET",
      volume: body.quantity || body.volume || 1.0,
      price: body.executionPrice || body.price || 0,
      openPrice: body.executionPrice || body.price || 0,
      closePrice: body.closePrice || body.executionPrice || 0,
      pnl: body.pnl || 0,
      accountMode: body.accountMode || "PAPER",
      brokerName: body.brokerName || "TradingView Bridge",
      timestamp: body.executionTime || Date.now(),
      createdAt: Date.now(),
      status: body.status || "FILLED",
      notes: body.notes || "Executed via AlgoVault Pro TradingView Bridge",
    };

    await adminDatabase.ref(`tradeJournal/${user.uid}/${entryId}`).set(payload);

    return NextResponse.json(
      { success: true, entryId, message: "Trade synced to RTDB journal successfully." },
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("[POST /api/extension/journal-sync]", err);
    return NextResponse.json(
      { error: "Failed to sync trade to journal." },
      { status: 500, headers: corsHeaders }
    );
  }
}
