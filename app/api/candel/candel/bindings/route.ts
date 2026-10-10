import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getCandelAccountBindings, saveCandelAccountBindings, deleteCandelAccountBinding, getCandelInstance } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { AccountBinding } from "@/lib/candel/types";

// GET /api/candel/candel/bindings/[candelId] — list authorized trading accounts for a Candel
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelReadable(candelId, token.uid);

    const bindings = await getCandelAccountBindings(candelId);
    return NextResponse.json({ success: true, bindings });
  } catch (error) {
    console.error("[candel/bindings GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load bindings" }, { status: 500 });
  }
}

// POST /api/candel/candel/bindings/[candelId] — bind a trading account to a Candel
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { accountId, accountRef, allowedContexts } = body;

    if (!accountId || !accountRef) {
      return NextResponse.json({ success: false, error: "accountId and accountRef required" }, { status: 400 });
    }

    const ctx = Array.isArray(allowedContexts) && allowedContexts.length > 0 ? allowedContexts : ["read"];
    const binding: AccountBinding = {
      tradingAccountId: accountId,
      allowedSymbols: accountRef ? [accountRef] : [],
      allowedContexts: ctx as AccountBinding["allowedContexts"],
      permissions: {
        workspace: { readPages: true, createPages: true, editPages: true, saveResearch: true },
        market: { readMarketData: true, analyzeChart: true, scanSymbols: false, createWatchlists: false, createAlerts: true },
        tradingAccount: {
          readAccount: ctx.includes("read") || ctx.includes("read_risk") || ctx.includes("read_positions"),
          readPositions: ctx.includes("read_positions"),
          readOrders: ctx.includes("read_orders"),
          readPerformance: ctx.includes("read_performance"),
          readRisk: ctx.includes("read_risk") || ctx.includes("read"),
        },
        execution: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false },
        external: { tradingviewMcp: false, telegram: false, discord: false },
        approvalRequirements: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false, tradeJournalWrite: false },
        executionDefault: "off",
        executionDefaultsToOff: true,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveCandelAccountBindings(candelId, token.uid, [binding]);
    return NextResponse.json({ success: true, binding }, { status: 201 });
  } catch (error) {
    console.error("[candel/bindings POST]", error);
    return NextResponse.json({ success: false, error: "Failed to bind account" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/bindings/[candelId] — unbind a trading account
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const accountId = searchParams.get("accountId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);
    if (!accountId) return NextResponse.json({ success: false, error: "accountId required" }, { status: 400 });

    await deleteCandelAccountBinding(candelId, token.uid, accountId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/bindings DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to unbind account" }, { status: 500 });
  }
}
