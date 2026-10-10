import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getCandelConversations,
  saveCandelConversation,
  deleteCandelConversation,
  saveCandelActivity,
  getCandelMessages,
  saveCandelMessage,
} from "@/lib/candel/workspace/database";
import type { CandelMessage } from "@/lib/candel/types";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelActivity, CandelActionType, CandelConversation } from "@/lib/candel/types";

// GET /api/candel/candel/conversation/[candelId] — list conversations (optionally with messages)
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);
    const includeMessages = searchParams.get("includeMessages") === "true";
    const conversations = await getCandelConversations(candelId, token.uid);
    if (!includeMessages) {
      return NextResponse.json({ success: true, conversations });
    }
    const messages = await getCandelMessages(candelId, token.uid);
    const messagesByConv: Record<string, CandelMessage[]> = {};
    for (const m of messages) {
      if (!messagesByConv[m.conversationId]) messagesByConv[m.conversationId] = [];
      messagesByConv[m.conversationId].push(m);
    }
    return NextResponse.json({
      success: true,
      conversations,
      messagesByConversation: messagesByConv,
    });
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
      title: initialMessage ? initialMessage.slice(0, 120) : "New conversation",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveCandelConversation(conversation);

    // If the caller supplied an initial message, persist it and prepare context
    if (initialMessage) {
      const userMsg: CandelMessage = {
        id: crypto.randomUUID(),
        candelId,
        conversationId: conversation.id,
        userId: token.uid,
        role: "user",
        content: initialMessage,
        status: "delivered",
        createdAt: Date.now(),
      };
      await saveCandelMessage(userMsg);
    }

    await saveCandelActivity({
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: "conversation_created" as CandelActionType,
      targetType: "conversation",
      targetId: conversation.id,
      details: { conversationId: conversation.id },
      timestamp: Date.now(),
    });
    return NextResponse.json({ success: true, conversation }, { status: 201 });
  } catch (error) {
    console.error("[candel/conversation POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create conversation" }, { status: 500 });
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
