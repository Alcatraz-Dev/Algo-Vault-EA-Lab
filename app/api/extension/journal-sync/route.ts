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

const SENSITIVE_KEY = /password|secret|token|cookie|credential|api[-_]?key|private/i;

/**
 * POST /api/extension/journal-sync
 *
 * Writes a TradingView-confirmed execution into the EXISTING AlgoVault trade
 * journal (`tradeJournal/{uid}` in RTDB — no Firestore, no duplicate store),
 * so the web terminal, verified-performance and report surfaces pick it up
 * automatically.
 *
 * Sensitive credential patterns are rejected; only safe trade metadata is
 * persisted.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const body = (await request.json()) as Record<string, unknown>;

    const raw = JSON.stringify(body).toLowerCase();
    if (
      raw.includes("password") ||
      raw.includes("secret") ||
      raw.includes("privatekey") ||
      raw.includes("cookie") ||
      /"api[-_]?key"\s*:/.test(raw) ||
      /"token"\s*:/.test(raw)
    ) {
      return NextResponse.json(
        { error: "Security violation: sensitive credential patterns detected." },
        { status: 400, headers: corsHeaders }
      );
    }

    const str = (v: unknown, fallback = ""): string =>
      typeof v === "string" ? v.slice(0, 400) : fallback;
    const numOrNull = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;

    const side = str(body.direction || body.side || body.type, "BUY").toUpperCase();
    const entry = numOrNull(body.entry) ?? numOrNull(body.executionPrice) ?? numOrNull(body.price) ?? 0;
    const timestamp = numOrNull(body.timestamp) ?? Date.now();
    const entryId = str(body.tradeId || body.id, `trade-${timestamp}-${Math.random().toString(36).slice(2, 8)}`);

    const payload: Record<string, unknown> = {
      id: entryId,
      tradeId: entryId,
      // Core trade facts.
      symbol: str(body.symbol, "UNKNOWN"),
      type: side,
      side,
      orderType: str(body.orderType, "MARKET"),
      volume: numOrNull(body.quantity) ?? numOrNull(body.volume) ?? 0,
      price: entry,
      openPrice: entry,
      closePrice: numOrNull(body.exitPrice),
      pnl: numOrNull(body.pnl),
      stop: numOrNull(body.stop),
      target: numOrNull(body.target),
      timeframe: str(body.timeframe, ""),
      timestamp,
      createdAt: timestamp,
      // Execution provenance — reported state only, never inferred.
      status: str(body.executionStatus || body.status, "UNKNOWN"),
      executionStatus: str(body.executionStatus || body.status, "UNKNOWN"),
      orderId: body.orderId ? str(body.orderId) : null,
      brokerTicket: body.brokerTicket ? str(body.brokerTicket) : null,
      brokerName: str(body.broker, "Unknown broker"),
      broker: str(body.broker, "Unknown broker"),
      accountReference: str(body.accountReference, ""),
      accountMode: str(body.mode || body.accountMode, "UNKNOWN"),
      // Intelligence provenance (AI setup → trade loop).
      strategy: str(body.strategy, ""),
      strategyId: body.strategyId ? str(body.strategyId) : null,
      setup: str(body.setup, ""),
      setupId: body.setupId ? str(body.setupId) : null,
      aiAnalysis: str(body.aiAnalysis, ""),
      analysisId: body.analysisId ? str(body.analysisId) : null,
      marketContext: str(body.marketContext, ""),
      source: "tradingview_execution_bridge",
      notes: str(body.notes, "Executed via AlgoVault Pro TradingView Bridge"),
      userId: user.uid,
    };

    for (const key of Object.keys(payload)) {
      if (SENSITIVE_KEY.test(key)) delete payload[key];
    }

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
