import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getCandelApprovals, saveApprovalRequest, deleteApprovalRequest } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelApprovalRequest, CandelActionType } from "@/lib/candel/types";

// GET /api/candel/candel/approval/[candelId] — list approval requests
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const approvals = await getCandelApprovals(candelId, token.uid);
    return NextResponse.json({ success: true, approvals });
  } catch (error) {
    console.error("[candel/approval GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load approvals" }, { status: 500 });
  }
}

// POST /api/candel/candel/approval/[candelId] — create an approval request
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { actionType, payload, status: requestedBy } = body;

    if (!actionType) {
      return NextResponse.json({ success: false, error: "actionType required" }, { status: 400 });
    }

    const approval: CandelApprovalRequest = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      requester: "user",
      actionType: actionType as CandelActionType,
      targetType: "candel",
      targetId: candelId,
      summary: actionType,
      evidence: [],
      riskLevel: "read_only",
      permissionRequired: actionType,
      payload: payload || {},
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    };

    await saveApprovalRequest(approval);
    return NextResponse.json({ success: true, approval }, { status: 201 });
  } catch (error) {
    console.error("[candel/approval POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create approval request" }, { status: 500 });
  }
}

// POST /api/candel/candel/approval/[candelId]/respond — approve/deny an approval
export async function POST_respond(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const approvalId = searchParams.get("approvalId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { decision } = body;
    if (!decision || !["approved", "rejected"].includes(decision)) {
      return NextResponse.json({ success: false, error: "decision (approved/rejected) required" }, { status: 400 });
    }

    await deleteApprovalRequest(approvalId || "", candelId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/approval POST_respond]", error);
    return NextResponse.json({ success: false, error: "Failed to respond to approval" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/approval/[candelId] — delete an approval request
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const approvalId = searchParams.get("approvalId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    await deleteApprovalRequest(approvalId || "", candelId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/approval DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to delete approval" }, { status: 500 });
  }
}
