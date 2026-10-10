import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getAllCandelTemplates,
  saveCandelTemplate,
  getCandelTemplate,
  deleteCandelTemplate,
  saveCandelInstance,
  getCandelInstance,
  getCandelInstancesByUser,
  getCandelConversations,
  saveCandelConversation,
  saveCandelActivity,
  getCandelAccountBindings,
  ensureDefaultCandelTemplates,
} from "@/lib/candel/workspace/database";
import { isAdmin } from "@/lib/candel/authorization";
import type { CandelActivity, CandelActionType, CandelProposal, CandelToolCall, CandelConversation, CandelInstance, CandelTemplate, AccountBinding, CandelPermissions, CandelJob, CandelMemoryEntry, CandelApprovalRequest, CandelAutomation, AccountContext } from "@/lib/candel/types";

// GET /api/candel/candel/builder — list templates + user's Candels for builder
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    await ensureDefaultCandelTemplates();
    const templates = await getAllCandelTemplates();
    const personal = await getCandelInstancesByUser(token.uid);

    return NextResponse.json({
      success: true,
      templates,
      personalCandels: personal,
    });
  } catch (error) {
    console.error("[candel/builder GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load builder data" }, { status: 500 });
  }
}

// POST /api/candel/candel/builder/create — create a new Candel from a template
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { templateId, name, instructions, role, avatar, capabilities, tools, model, mcpConnections, memoryPolicy, workspaceAccess, tradingAccess, accountAccess, approvalRequirements, backgroundPermissions, proOnly, status, version } = body;

    if (!name || !templateId) {
      return NextResponse.json({ success: false, error: "'name' and 'templateId' required" }, { status: 400 });
    }

    // Default: execution OFF, trading account access OFF, external tools OFF
    const instance: CandelInstance = {
      id: crypto.randomUUID(),
      templateId,
      userId: token.uid,
      createdBy: token.uid,
      name,
      displayName: name,
      description: instructions || "",
      status: status || "active",
      accountBindings: [],
      createdByAdmin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveCandelInstance(instance);

    // Activity — server-generated
    await saveCandelActivity({
      id: crypto.randomUUID(),
      candelId: instance.id,
      userId: token.uid,
      action: "create" as CandelActionType,
      targetType: "candel",
      targetId: instance.id,
      details: { name, templateId, role: instance.status },
      timestamp: Date.now(),
    });

    return NextResponse.json({ success: true, instance }, { status: 201 });
  } catch (error) {
    console.error("[candel/builder POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create Candel" }, { status: 500 });
  }
}
