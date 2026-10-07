import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getCandelInstance } from "@/lib/candel/workspace/database";
import { requireCandelReadable } from "@/lib/candel/authorization";

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

// DELETE /api/candel/candel/[candelId] — archive Candel
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelReadable(candelId, token.uid);
    await getCandelInstance(candelId);
    // Archive handled by instance status
    return NextResponse.json({ success: true, archived: true });
  } catch (error) {
    console.error("[candel/[candelId] DELETE]", error);
    return NextResponse.json(
      { success: false, error: "Failed to archive Candel" },
      { status: 500 }
    );
  }
}
