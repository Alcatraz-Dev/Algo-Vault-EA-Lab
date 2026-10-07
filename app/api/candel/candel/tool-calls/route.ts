import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getCandelToolCalls, saveCandelToolCall } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelToolCall } from "@/lib/candel/types";

// GET /api/candel/candel/tool-calls/[candelId] — list tool calls
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const toolCalls = await getCandelToolCalls(candelId, token.uid);
    toolCalls.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return NextResponse.json({ success: true, toolCalls });
  } catch (error) {
    console.error("[candel/tool-calls GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load tool calls" }, { status: 500 });
  }
}

// POST /api/candel/candel/tool-calls/[candelId] — record a tool call
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { toolName, input, output, status, riskLevel } = body;

    if (!toolName) {
      return NextResponse.json({ success: false, error: "toolName required" }, { status: 400 });
    }

    const call: CandelToolCall = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      toolName,
      arguments: input || {},
      status: status || "pending",
      startedAt: Date.now(),
      permissionChecked: false,
      idempotencyKey: crypto.randomUUID(),
    };
    if (output !== undefined) call.result = output;

    await saveCandelToolCall(call);
    return NextResponse.json({ success: true, call }, { status: 201 });
  } catch (error) {
    console.error("[candel/tool-calls POST]", error);
    return NextResponse.json({ success: false, error: "Failed to record tool call" }, { status: 500 });
  }
}
