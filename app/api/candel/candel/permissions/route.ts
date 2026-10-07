import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getCandelPermissions, saveCandelPermissions } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelPermissions } from "@/lib/candel/types";

// GET /api/candel/candel/permissions/[candelId] — get effective permissions
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const permissions = await getCandelPermissions(candelId, token.uid);
    return NextResponse.json({ success: true, permissions });
  } catch (error) {
    console.error("[candel/permissions GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load permissions" }, { status: 500 });
  }
}

// POST /api/candel/candel/permissions/[candelId] — save effective permissions
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { workspace, market, tradingAccount, execution, external, accountAccess, role } = body;

    const permissions: CandelPermissions = {
      workspace: workspace || { readPages: true, createPages: true, editPages: true, saveResearch: true },
      market: market || { readMarketData: true, analyzeChart: true, scanSymbols: false, createWatchlists: false, createAlerts: true },
      tradingAccount: tradingAccount || { readAccount: false, readPositions: false, readOrders: false, readPerformance: false, readRisk: false },
      execution: execution || { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false },
      external: external || { tradingviewMcp: false, telegram: false, discord: false },
      approvalRequirements: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false, tradeJournalWrite: false },
      executionDefault: "off",
      executionDefaultsToOff: true,
    };

    await saveCandelPermissions(candelId, token.uid, permissions);
    return NextResponse.json({ success: true, permissions }, { status: 201 });
  } catch (error) {
    console.error("[candel/permissions POST]", error);
    return NextResponse.json({ success: false, error: "Failed to save permissions" }, { status: 500 });
  }
}
