import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getCandelAccountBindings, saveCandelAccountBindings, deleteCandelAccountBinding } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { AccountBinding, AccountContext } from "@/lib/candel/types";

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
    const { accountId, allowedContexts, allowedSymbols } = body;

    if (!accountId || typeof accountId !== "string") {
      return NextResponse.json({ success: false, error: "accountId required" }, { status: 400 });
    }

    // The account must genuinely belong to the caller — a Candel can never be
    // pointed at someone else's account by crafting a request body.
    const accountSnap = await adminDatabase.ref(`trading_accounts/${token.uid}/${accountId}`).get();
    if (!accountSnap.exists()) {
      return NextResponse.json(
        { success: false, error: "Trading account not found for this user" },
        { status: 404 }
      );
    }
    const accountData = (accountSnap.val() ?? {}) as Record<string, unknown>;
    const accountRef = String(accountData.mt5Account ?? accountData.accountId ?? accountId);
    const broker = String(accountData.broker ?? "");

    const ALLOWED_CONTEXTS: AccountContext[] = [
      "read",
      "read_positions",
      "read_orders",
      "read_performance",
      "read_risk",
      "execute",
    ];
    const ctx = (Array.isArray(allowedContexts) ? allowedContexts : []).filter(
      (c: unknown): c is AccountContext => ALLOWED_CONTEXTS.includes(c as AccountContext)
    );
    const contexts: AccountContext[] = ctx.length > 0 ? ctx : ["read"];

    const binding: AccountBinding = {
      tradingAccountId: accountId,
      accountRef,
      label: broker ? `${accountRef} · ${broker}` : accountRef,
      allowedSymbols: Array.isArray(allowedSymbols) ? allowedSymbols.filter((s: unknown) => typeof s === "string") : [],
      allowedContexts: contexts,
      permissions: {
        workspace: { readPages: true, createPages: true, editPages: true, saveResearch: true },
        market: { readMarketData: true, analyzeChart: true, scanSymbols: false, createWatchlists: false, createAlerts: true },
        tradingAccount: {
          readAccount: contexts.includes("read") || contexts.includes("read_risk") || contexts.includes("read_positions"),
          readPositions: contexts.includes("read_positions"),
          readOrders: contexts.includes("read_orders"),
          readPerformance: contexts.includes("read_performance"),
          readRisk: contexts.includes("read_risk") || contexts.includes("read"),
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
