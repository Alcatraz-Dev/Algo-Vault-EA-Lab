import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getCandelAutomations, saveCandelAutomation, deleteCandelAutomation } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelAutomation } from "@/lib/candel/types";

// GET /api/candel/candel/automations/[candelId] — list automations for a Candel
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const automations = await getCandelAutomations(candelId, token.uid);
    return NextResponse.json({ success: true, automations });
  } catch (error) {
    console.error("[candel/automations GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load automations" }, { status: 500 });
  }
}

// POST /api/candel/candel/automations/[candelId] — create an automation
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { name, type, schedule, enabled, description, actions } = body;

    if (!name || !type) {
      return NextResponse.json({ success: false, error: "name and type required" }, { status: 400 });
    }

    const auto: CandelAutomation = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      name,
      description: description || "",
      trigger: {
        kind: type === "event" ? "event" : "cron",
        cron: type === "cron" ? schedule : undefined,
        event: type === "event" ? schedule : undefined,
      },
      condition: undefined,
      action: actions || {},
      status: "active",
      auditRef: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveCandelAutomation(auto);
    return NextResponse.json({ success: true, automation: auto }, { status: 201 });
  } catch (error) {
    console.error("[candel/automations POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create automation" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/automations/[candelId] — cancel an automation
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const automationId = searchParams.get("automationId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    await deleteCandelAutomation(automationId || "", candelId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/automations DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to cancel automation" }, { status: 500 });
  }
}
