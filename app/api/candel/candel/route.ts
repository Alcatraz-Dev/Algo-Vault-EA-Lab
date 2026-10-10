import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getCandelInstance,
  getCandelInstancesByUser,
  getCandelTemplate,
  saveCandelInstance,
  saveCandelPermissions,
  updateCandelInstance,
  purgeCandelInstance,
  saveCandelActivity,
} from "@/lib/candel/workspace/database";
import { requireCandelOwner } from "@/lib/candel/authorization";
import {
  CANDEL_LIMITS,
  cleanText,
  customizationFromCreateBody,
  sanitizeCandelCustomization,
  mergeCandelCustomization,
  defaultCandelPermissions,
} from "@/lib/candel/config";
import type { CandelActivity, CandelActionType, CandelInstance } from "@/lib/candel/types";

// GET /api/candel/candel — list Candel instances for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const instances = await getCandelInstancesByUser(token.uid);
    const archived = searchParams.get("archived") === "true";
    const data = archived
      ? instances
      : instances.filter((instance) => instance.status !== "archived");
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
    const templateId = cleanText(body.templateId, 120);
    const name = cleanText(body.name, CANDEL_LIMITS.name);
    const description = cleanText(
      body.description ?? body.instructions ?? "",
      CANDEL_LIMITS.description,
    );

    if (!name || !templateId) {
      return NextResponse.json({ success: false, error: "'name' and 'templateId' are required" }, { status: 400 });
    }

    // The template is the tool/permission ceiling — a Candel cannot exist
    // without one, and cannot exceed it (see lib/candel/config.ts).
    const template = await getCandelTemplate(templateId);
    if (!template) {
      return NextResponse.json({ success: false, error: "Unknown template" }, { status: 400 });
    }

    const now = Date.now();
    const instance: CandelInstance = {
      id: crypto.randomUUID(),
      templateId,
      userId: token.uid,
      createdBy: token.uid,
      name,
      displayName: name,
      description,
      status: "active",
      accountBindings: [],
      createdByAdmin: false,
      customization: customizationFromCreateBody(body, template),
      createdAt: now,
      updatedAt: now,
    };

    // Execution/trading access is never granted at creation time — it must be
    // configured explicitly (permissions + account bindings) afterwards.
    await saveCandelInstance(instance);
    await saveCandelPermissions(instance.id, token.uid, defaultCandelPermissions());

    const activity: CandelActivity = {
      id: crypto.randomUUID(),
      candelId: instance.id,
      userId: token.uid,
      action: "create" as CandelActionType,
      targetType: "candel",
      targetId: instance.id,
      details: {
        name,
        templateId,
        role: instance.customization?.role ?? template.role,
        tools: instance.customization?.tools ?? template.tools,
      },
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

    const existing = await getCandelInstance(candelId);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Candel not found" }, { status: 404 });
    }

    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const name = cleanText(body.name, CANDEL_LIMITS.name);
      if (name) {
        patch.name = name;
        patch.displayName = name;
      }
    }
    if (typeof body.description === "string") {
      patch.description = cleanText(body.description, CANDEL_LIMITS.description);
    }
    if (["active", "paused", "disabled", "archived"].includes(body.status)) {
      patch.status = body.status;
    }

    // Customization overrides are validated against the template ceiling, so a
    // Candel can narrow its tools but never widen them.
    const wantsCustomization = [
      "role",
      "avatar",
      "instructions",
      "capabilities",
      "tools",
      "model",
      "memoryPolicy",
    ].some((key) => body[key] !== undefined);

    if (wantsCustomization) {
      const template = await getCandelTemplate(existing.templateId);
      if (!template) {
        return NextResponse.json({ success: false, error: "Unknown template" }, { status: 400 });
      }
      const sanitized = sanitizeCandelCustomization(body, template);
      patch.customization = mergeCandelCustomization(existing.customization, sanitized);
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
      details: wantsCustomization
        ? { ...patch, customization: "updated" }
        : patch,
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

    const hard = searchParams.get("hard") === "true";

    if (hard) {
      // Permanent: the instance and every per-Candel sub-tree are removed.
      await saveCandelActivity({
        id: crypto.randomUUID(),
        candelId,
        userId: token.uid,
        action: "delete" as CandelActionType,
        targetType: "candel",
        targetId: candelId,
        details: { mode: "purge", name: existing.name },
        timestamp: Date.now(),
      });
      await purgeCandelInstance(candelId, token.uid);
      return NextResponse.json({ success: true, archived: false, purged: true });
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

    return NextResponse.json({ success: true, archived: true, purged: false });
  } catch (error) {
    console.error("[candel/candel DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to archive Candel" }, { status: 500 });
  }
}
