import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getCandelInstance, updateCandelInstance } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";

// GET /api/candel/candel/[candelId] — read a single Candel (ownership enforced)
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    const instance = await getCandelInstance(candelId);
    if (!instance) {
      return NextResponse.json({ success: false, error: "Candel not found" }, { status: 404 });
    }

    await requireCandelReadable(candelId, token.uid);
    return NextResponse.json({ success: true, instance });
  } catch (error) {
    console.error("[candel/[candelId] GET]", error);
    return NextResponse.json(
      { success: false, error: "Failed to load Candel" },
      { status: 500 }
    );
  }
}

// PATCH /api/candel/candel/[candelId]?candelId=... — rename / change status (owner only)
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
    return NextResponse.json({ success: true, instance });
  } catch (error) {
    console.error("[candel/[candelId] PATCH]", error);
    return NextResponse.json({ success: false, error: "Failed to update Candel" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/[candelId]?candelId=... — archive Candel (soft delete)
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
    return NextResponse.json({ success: true, archived: true });
  } catch (error) {
    console.error("[candel/[candelId] DELETE]", error);
    return NextResponse.json(
      { success: false, error: "Failed to archive Candel" },
      { status: 500 }
    );
  }
}
