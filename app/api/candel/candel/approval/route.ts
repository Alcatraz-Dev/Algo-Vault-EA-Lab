import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import {
  getCandelApprovals,
  saveApprovalRequest,
  deleteApprovalRequest,
} from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import {
  APPROVAL_ACTION_PERMISSIONS,
  APPROVAL_RISK_LEVEL,
  APPROVAL_LIMITS,
  APPROVAL_TTL_MS,
  isApprovalActionType,
} from "@/lib/candel/approvals";
import type { CandelApprovalRequest } from "@/lib/candel/types";

// GET /api/candel/candel/approval?candelId=… — list approval requests
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const approvals = await getCandelApprovals(candelId, token.uid);
    approvals.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return NextResponse.json({ success: true, approvals });
  } catch (error) {
    console.error("[candel/approval GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load approvals" }, { status: 500 });
  }
}

// POST /api/candel/candel/approval?candelId=… — raise an approval request
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { actionType, payload, summary, evidence } = body;

    // Fail-closed: only the closed set of live actions can be requested, and the
    // client cannot declare its own risk level or permission string.
    if (!isApprovalActionType(actionType)) {
      return NextResponse.json(
        { success: false, error: "actionType must be one of createOrder, modifyOrder, closePosition, cancelOrder" },
        { status: 400 }
      );
    }

    const serialized = JSON.stringify(payload ?? {});
    if (serialized.length > APPROVAL_LIMITS.payloadBytes) {
      return NextResponse.json({ success: false, error: "payload too large" }, { status: 413 });
    }

    const now = Date.now();
    const approval: CandelApprovalRequest = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      requester: "user",
      actionType,
      targetType: "trading_account",
      targetId: String((payload as Record<string, unknown> | undefined)?.accountId ?? ""),
      summary: String(summary ?? actionType).slice(0, APPROVAL_LIMITS.summary),
      evidence: Array.isArray(evidence) ? evidence : [],
      riskLevel: APPROVAL_RISK_LEVEL,
      permissionRequired: APPROVAL_ACTION_PERMISSIONS[actionType],
      payload: (payload as Record<string, unknown>) ?? {},
      expiresAt: now + APPROVAL_TTL_MS,
      createdAt: now,
    };

    await saveApprovalRequest(approval);
    return NextResponse.json({ success: true, approval }, { status: 201 });
  } catch (error) {
    console.error("[candel/approval POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create approval request" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/approval?candelId=…&approvalId=… — withdraw a pending request
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const approvalId = searchParams.get("approvalId");
    if (!candelId || !approvalId) {
      return NextResponse.json({ success: false, error: "candelId and approvalId required" }, { status: 400 });
    }

    await requireCandelOwner(candelId, token.uid);

    await deleteApprovalRequest(approvalId, candelId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/approval DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to delete approval" }, { status: 500 });
  }
}
