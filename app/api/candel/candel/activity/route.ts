import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getCandelActivity, saveCandelActivity, deleteCandelActivity } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelActivity, CandelActionType } from "@/lib/candel/types";

// GET /api/candel/candel/activity/[candelId] — activity feed (server-generated only)
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const activities = await getCandelActivity(candelId, token.uid);
    activities.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    return NextResponse.json({ success: true, activities });
  } catch (error) {
    console.error("[candel/activity GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load activity" }, { status: 500 });
  }
}

// POST /api/candel/candel/activity/[candelId] — create server-generated activity
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { action, data } = body;
    if (!action) return NextResponse.json({ success: false, error: "action required" }, { status: 400 });

    const activity: CandelActivity = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: action as CandelActionType,
      targetType: "candel",
      targetId: candelId,
      details: data || {},
      timestamp: Date.now(),
    };
    await saveCandelActivity(activity);
    return NextResponse.json({ success: true, activity }, { status: 201 });
  } catch (error) {
    console.error("[candel/activity POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create activity" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/activity/[candelId] — clear activity
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelOwner(candelId, token.uid);
    await deleteCandelActivity(candelId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/activity DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to clear activity" }, { status: 500 });
  }
}
