import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import {
  getCandelConversations,
  saveCandelConversation,
  getCandelMemory,
  saveCandelMessage,
  saveCandelActivity,
  saveApprovalRequest,
} from "@/lib/candel/workspace/database";
import { requireCandelOwner } from "@/lib/candel/authorization";
import { cleanText, resolveCandelConfig } from "@/lib/candel/config";
import {
  buildApprovalRequest,
  extractApprovalDirectives,
  resolveApprovalDirectives,
} from "@/lib/candel/approvals";
import type {
  CandelActionType,
  CandelApprovalRequest,
  CandelConversation,
  CandelMemoryEntry,
  CandelMessage,
} from "@/lib/candel/types";

/**
 * POST /api/candel/candel/conversation/message
 *
 * One turn of a conversation with a Candel:
 *   1. resolve (or lazily create) the conversation
 *   2. persist the user message
 *   3. run the Candel agent with its *effective* config + remembered context
 *   4. turn any `approval` directive in the reply into a real, decisionable
 *      approval request (the only way a Candel can move toward a live action)
 *   5. persist the Candel reply and the audit activity
 *
 * The client never supplies an identity — the owner uid comes from the verified
 * ID token, and the agent can only reach the tools its template allows.
 */

const MAX_MESSAGE_CHARS = 8_000;

export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const candelId = cleanText(body.candelId, 120);
    const requestedConversationId = cleanText(body.conversationId, 120);
    const content = cleanText(body.content, MAX_MESSAGE_CHARS);

    if (!candelId || !content) {
      return NextResponse.json(
        { success: false, error: "candelId and content are required" },
        { status: 400 }
      );
    }

    // Ownership is proven before anything is read or written.
    await requireCandelOwner(candelId, token.uid);

    const conversations = await getCandelConversations(candelId, token.uid);
    let conversation: CandelConversation | null = requestedConversationId
      ? conversations.find((c) => c.id === requestedConversationId) ?? null
      : conversations[conversations.length - 1] ?? null;

    if (!conversation) {
      conversation = {
        id: crypto.randomUUID(),
        candelId,
        userId: token.uid,
        title: content.slice(0, 120),
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveCandelConversation(conversation);
    }

    const userMsg: CandelMessage = {
      id: crypto.randomUUID(),
      candelId,
      conversationId: conversation.id,
      userId: token.uid,
      role: "user",
      content,
      status: "delivered",
      createdAt: Date.now(),
    };
    await saveCandelMessage(userMsg);

    const { runCandelAgent } = await import("@/lib/candel/dot/adapter");
    const adapter = await runCandelAgent(token.uid, candelId);

    if (!adapter) {
      return NextResponse.json(
        {
          success: false,
          status: "no_adapter",
          error:
            "This Candel could not be loaded — its template is missing. Recreate the Candel from a current template.",
        },
        { status: 409 }
      );
    }

    // Remembered preferences/facts are injected as context so the Candel's
    // memory actually changes its behaviour instead of being write-only.
    let memory: CandelMemoryEntry[] = [];
    try {
      memory = await getCandelMemory(candelId, token.uid);
    } catch {
      memory = [];
    }

    const response = await adapter.handleMessage(content, {
      memory: memory.map((entry) => `${entry.kind}: ${entry.text}`),
    });

    // A Candel cannot execute; it can only ask. Directives that survive the
    // fail-closed admission rules become durable approval requests the user
    // decides in the studio, and the rest are reported back in the reply.
    const directives = extractApprovalDirectives(response);
    const approvals: CandelApprovalRequest[] = [];
    const rejectionNotes: string[] = [];

    if (directives.drafts.length > 0) {
      const config = resolveCandelConfig(adapter.instance, adapter.template);
      const admission = resolveApprovalDirectives(directives.drafts, {
        config,
        bindings: adapter.accountBindings,
      });

      for (const draft of admission.accepted) {
        const approval = buildApprovalRequest(draft, {
          id: crypto.randomUUID(),
          candelId,
          userId: token.uid,
        });
        await saveApprovalRequest(approval);
        await saveCandelActivity({
          id: crypto.randomUUID(),
          candelId,
          userId: token.uid,
          action: "approval_request" as CandelActionType,
          targetType: "approval",
          targetId: approval.id,
          details: {
            actionType: approval.actionType,
            accountId: approval.targetId,
            summary: approval.summary,
          },
          timestamp: Date.now(),
        });
        approvals.push(approval);
      }

      for (const rejection of admission.rejected) {
        rejectionNotes.push(
          `I did not queue the ${rejection.actionType} — ${rejection.reason}.`
        );
      }
    }

    if (directives.dropped > 0) {
      rejectionNotes.push(
        `I ignored ${directives.dropped} approval directive${directives.dropped === 1 ? "" : "s"} that did not match the protocol.`
      );
    }

    // The user must always get a readable turn: the prose the agent wrote, a
    // line per queued request, and an explicit line per rejection. The raw
    // directive block itself never reaches the bubble.
    const replyText = [
      directives.clean ||
        (approvals.length > 0 ? "I prepared a live action for your review." : ""),
      approvals.length > 0
        ? `Queued ${approvals.length} live action${approvals.length === 1 ? "" : "s"} for your approval — decide in the card below.`
        : "",
      ...rejectionNotes.map((note) => `— ${note}`),
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim() || response;

    const candelMsg: CandelMessage = {
      id: crypto.randomUUID(),
      candelId,
      conversationId: conversation.id,
      userId: token.uid,
      role: "candel",
      content: replyText,
      status: "delivered",
      createdAt: Date.now(),
    };

    const updatedConversation: CandelConversation = {
      ...conversation,
      updatedAt: Date.now(),
      title:
        conversation.title && conversation.title !== "New conversation"
          ? conversation.title
          : content.slice(0, 120),
    };

    await saveCandelMessage(candelMsg);
    await saveCandelConversation(updatedConversation);
    await saveCandelActivity({
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: "message_sent" as CandelActionType,
      targetType: "message",
      targetId: userMsg.id,
      details: {
        conversationId: conversation.id,
        responseLength: replyText.length,
        memoryUsed: memory.length,
        approvalsRaised: approvals.length,
      },
      timestamp: Date.now(),
    });

    return NextResponse.json({
      success: true,
      status: "completed",
      response: replyText,
      approvals,
      conversation: updatedConversation,
      messages: [userMsg, candelMsg],
    });
  } catch (error) {
    console.error("[candel/conversation/message POST]", error);
    return NextResponse.json(
      { success: false, error: "Failed to process message" },
      { status: 500 }
    );
  }
}
