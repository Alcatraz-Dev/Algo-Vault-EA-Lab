import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getCandelWorkspacePages,
  saveCandelWorkspacePage,
  deleteCandelWorkspacePage,
  getCandelInstance,
  getCandelInstancesByUser,
} from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelPage } from "@/lib/candel/types";

// GET /api/candel/candel/workspace/[candelId] — list workspace pages
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const pages = await getCandelWorkspacePages(candelId, token.uid);
    return NextResponse.json({ success: true, pages });
  } catch (error) {
    console.error("[candel/workspace GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load workspace pages" }, { status: 500 });
  }
}

// POST /api/candel/candel/workspace/[candelId] — create a workspace page
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { title, content, type = "note" } = body;

    if (!title) {
      return NextResponse.json({ success: false, error: "title required" }, { status: 400 });
    }

    const page: CandelPage = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      spaceId: crypto.randomUUID(),
      title,
      content: content || "",
      parentId: null,
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveCandelWorkspacePage(page);
    return NextResponse.json({ success: true, page }, { status: 201 });
  } catch (error) {
    console.error("[candel/workspace POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create workspace page" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/workspace/[candelId] — delete a workspace page
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const pageId = searchParams.get("pageId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    await deleteCandelWorkspacePage(pageId || "", candelId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/workspace DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to delete workspace page" }, { status: 500 });
  }
}
