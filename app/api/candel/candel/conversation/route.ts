import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getCandelConversations,
  saveCandelConversation,
  deleteCandelConversation,
  saveCandelActivity,
} from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelActivity, CandelActionType, CandelConversation } from "@/lib/candel/types";

// GET /api/candel/candel/conversation/[candelId] — list conversations
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);
    const conversations = await getCandelConversations(candelId, token.uid);
    return NextResponse.json({ success: true, conversations });
  } catch (error) {
    console.error("[candel/conversation GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load conversations" }, { status: 500 });
  }
}

// POST /api/candel/candel/conversation/[candelId] — create a conversation
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelOwner(candelId, token.uid);
    const body = await request.json();
    const { initialMessage, role = "general" } = body;
    const conversation: CandelConversation = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      title: initialMessage ? initialMessage.slice(0, 120) : "General Candel",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveCandelConversation(conversation);
    const activity: CandelActivity = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: "conversation_created" as CandelActionType,
      targetType: "conversation",
      targetId: conversation.id,
      details: { conversationId: conversation.id },
      timestamp: Date.now(),
    };
    return NextResponse.json({ success: true, conversation }, { status: 201 });
  } catch (error) {
    console.error("[candel/conversation POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create conversation" }, { status: 500 });
  }
}

// POST /api/candel/candel/conversation/message — append a message and run the agent
export async function POST_message(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const { candelId, content, conversationId } = body;
    if (!candelId || !content) return NextResponse.json({ success: false, error: "candelId and content required" }, { status: 400 });
    await requireCandelOwner(candelId, token.uid);

    const conversation = conversationId
      ? await getCandelConversations(candelId, token.uid).then(list => list.find(c => c.id === conversationId))
      : null;

    if (!conversation) {
      return NextResponse.json({ success: false, error: "Conversation not found" }, { status: 404 });
    }

    const { runCandelAgent } = await import("@/lib/candel/dot/adapter");
    const adapter = await runCandelAgent(token.uid, candelId);
    if (!adapter) {
      return NextResponse.json({ success: true, status: "no_adapter", content: "Candel agent not found for this instance." });
    }
    const response = await adapter.handleMessage(content);

    const activity: CandelActivity = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: "message_sent" as CandelActionType,
      targetType: "message",
      targetId: content,
      details: { responseLength: response.length },
      timestamp: Date.now(),
    };
    await saveCandelActivity(activity);

    return NextResponse.json({
      success: true,
      status: "completed",
      response,
    });
  } catch (error) {
    console.error("[candel/conversation/message POST]", error);
    return NextResponse.json({ success: false, error: "Failed to process message" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/conversation/[candelId] — delete a conversation
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const conversationId = searchParams.get("conversationId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelOwner(candelId, token.uid);
    await deleteCandelConversation(conversationId || "", candelId, token.uid);
    await saveCandelActivity({
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: "delete" as CandelActionType,
      targetType: "conversation",
      targetId: conversationId || "",
      details: { conversationId },
      timestamp: Date.now(),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/conversation DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to delete conversation" }, { status: 500 });
  }
}
