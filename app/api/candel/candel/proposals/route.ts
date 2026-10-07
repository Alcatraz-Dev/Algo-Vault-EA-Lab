import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getCandelProposals, saveCandelProposal } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelProposal } from "@/lib/candel/types";

// GET /api/candel/candel/proposals/[candelId] — list proposals
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const proposals = await getCandelProposals(candelId, token.uid);
    return NextResponse.json({ success: true, proposals });
  } catch (error) {
    console.error("[candel/proposals GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load proposals" }, { status: 500 });
  }
}

// POST /api/candel/candel/proposals/[candelId] — create a proposal
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { type, content, riskLevel, accountId } = body;

    if (!type) {
      return NextResponse.json({ success: false, error: "type required" }, { status: 400 });
    }

    const proposal: CandelProposal = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      type: type || "order_proposal",
      payload: { content: content || "", riskLevel: riskLevel || "read_only", accountId: accountId || null },
      reason: "",
      evidence: [],
      confidence: 0.5,
      requiresConfirmation: false,
      riskLevel: riskLevel || "read_only",
      permissionRequired: type || "order_proposal",
      idempotencyKey: crypto.randomUUID(),
      status: "pending",
      proposedAt: Date.now(),
    };

    await saveCandelProposal(proposal);
    return NextResponse.json({ success: true, proposal }, { status: 201 });
  } catch (error) {
    console.error("[candel/proposals POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create proposal" }, { status: 500 });
  }
}
