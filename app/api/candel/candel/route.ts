import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getCandelInstance,
  getCandelInstancesByUser,
  saveCandelInstance,
  updateCandelInstance,
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

    // Execution/trading access is never granted at creation time — it must be
    // configured explicitly (permissions + account bindings) afterwards.
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

// PATCH /api/candel/candel — rename / pause / resume a Candel
export async function PATCH(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) {
      patch.name = body.name.trim();
      patch.displayName = body.name.trim();
    }
    if (typeof body.description === "string") patch.description = body.description;
    if (["active", "paused", "disabled", "archived"].includes(body.status)) {
      patch.status = body.status;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: "Nothing to update" }, { status: 400 });
    }

    const instance = await updateCandelInstance(candelId, patch);
    if (!instance) {
      return NextResponse.json({ success: false, error: "Candel not found" }, { status: 404 });
    }

    await saveCandelActivity({
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: "update" as CandelActionType,
      targetType: "candel",
      targetId: candelId,
      details: patch,
      timestamp: Date.now(),
    });

    return NextResponse.json({ success: true, instance });
  } catch (error) {
    console.error("[candel/candel PATCH]", error);
    return NextResponse.json({ success: false, error: "Failed to update Candel" }, { status: 500 });
  }
}

// DELETE /api/candel/candel?candelId=... — archive a Candel (soft delete)
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);
    const existing = await getCandelInstance(candelId);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Candel not found" }, { status: 404 });
    }

    await updateCandelInstance(candelId, { status: "archived" });

    await saveCandelActivity({
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: "delete" as CandelActionType,
      targetType: "candel",
      targetId: candelId,
      details: {
        mode: "archive",
        previousStatus: existing.status,
      },
      timestamp: Date.now(),
    });

    return NextResponse.json({ success: true, archived: true });
  } catch (error) {
    console.error("[candel/candel DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to archive Candel" }, { status: 500 });
  }
}
