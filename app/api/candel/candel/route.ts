import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getCandelInstance,
  getCandelInstancesByUser,
  saveCandelInstance,
  deleteCandelInstance,
  saveCandelActivity,
} from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelActivity, CandelActionType, CandelInstance } from "@/lib/candel/types";

// GET /api/candel/candel — list Candel instances for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const instances = await getCandelInstancesByUser(token.uid);
    const archived = searchParams.get("archived") === "true";
    const data = archived ? instances : instances.filter((i: any) => i.status !== "archived");
    return NextResponse.json({ success: true, instances: data });
  } catch (error) {
    console.error("[candel/candel GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load Candels" }, { status: 500 });
  }
}

// POST /api/candel/candel — create a new Candel
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { templateId, name, instructions, role, avatar, capabilities, tools, model, mcpConnections, memoryPolicy, workspaceAccess, tradingAccess, accountAccess, approvalRequirements, backgroundPermissions, proOnly, status, version } = body;

    if (!name || !templateId) {
      return NextResponse.json({ success: false, error: "'name' and 'templateId' are required" }, { status: 400 });
    }

    const instance = {
      id: crypto.randomUUID(),
      templateId,
      userId: token.uid,
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

    const activity: CandelActivity = {
      id: crypto.randomUUID(),
      candelId: instance.id,
      userId: token.uid,
      action: "create" as CandelActionType,
      targetType: "candel",
      targetId: instance.id,
      details: { name, templateId, role: instance.status },
      timestamp: Date.now(),
    };
    await saveCandelActivity(activity);

    return NextResponse.json({ success: true, instance }, { status: 201 });
  } catch (error) {
    console.error("[candel/candel POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create Candel" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/[candelId] — archive Candel
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);
    await getCandelInstance(candelId);

    const activity: CandelActivity = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: "delete" as CandelActionType,
      targetType: "candel",
      targetId: candelId,
      details: {},
      timestamp: Date.now(),
    };
    await saveCandelActivity(activity);

    return NextResponse.json({ success: true, archived: true });
  } catch (error) {
    console.error("[candel/candel/[candelId] DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to archive Candel" }, { status: 500 });
  }
}
