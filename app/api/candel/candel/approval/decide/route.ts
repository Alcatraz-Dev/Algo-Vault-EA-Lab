import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import {
  getCandelApprovals,
  saveApprovalRequest,
  saveCandelActivity,
} from "@/lib/candel/workspace/database";
import { requireCandelOwner } from "@/lib/candel/authorization";
import { applyApprovalDecision } from "@/lib/candel/approvals";
import type { CandelActionType } from "@/lib/candel/types";

/**
 * POST /api/candel/candel/approval/decide
 *
 * The human side of the approval loop. Body: `{ candelId, approvalId, decision,
 * reason? }` where `decision` is `approved` or `rejected`.
 *
 * The decision is recorded on the request (who, when, why) and written to the
 * Candel's activity trail. Nothing is executed here — this endpoint records
 * intent only; live execution stays behind the fail-closed execution gate.
 */
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId") || String(body.candelId ?? "");
    const approvalId = String(body.approvalId ?? "");
    const decision = String(body.decision ?? "");
    const reason = typeof body.reason === "string" ? body.reason : "";

    if (!candelId || !approvalId) {
      return NextResponse.json(
        { success: false, error: "candelId and approvalId are required" },
        { status: 400 }
      );
    }

    // Ownership is proven before the request is even read.
    await requireCandelOwner(candelId, token.uid);

    const approvals = await getCandelApprovals(candelId, token.uid);
    const existing = approvals.find((entry) => entry.id === approvalId);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Approval request not found" }, { status: 404 });
    }

    const outcome = applyApprovalDecision(existing, decision as "approved" | "rejected", token.uid, reason);
    if (!outcome.ok) {
      return NextResponse.json(
        { success: false, error: outcome.reason, code: outcome.code },
        { status: outcome.code === "already_decided" ? 409 : 400 }
      );
    }

    await saveApprovalRequest(outcome.request);
    await saveCandelActivity({
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: (outcome.request.decision === "approved"
        ? "approval_granted"
        : "approval_denied") as CandelActionType,
      targetType: "approval",
      targetId: outcome.request.id,
      details: {
        actionType: outcome.request.actionType,
        riskLevel: outcome.request.riskLevel,
        accountId: outcome.request.targetId,
        reason: outcome.request.reason ?? "",
      },
      timestamp: Date.now(),
    });

    return NextResponse.json({ success: true, approval: outcome.request });
  } catch (error) {
    console.error("[candel/approval/decide POST]", error);
    return NextResponse.json({ success: false, error: "Failed to record approval decision" }, { status: 500 });
  }
}
