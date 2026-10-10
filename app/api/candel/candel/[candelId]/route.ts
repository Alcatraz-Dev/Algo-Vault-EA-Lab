import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getCandelInstance } from "@/lib/candel/workspace/database";
import { requireCandelReadable } from "@/lib/candel/authorization";

/**
 * Mutations live in exactly one place: `../route.ts`. Both endpoints are
 * query-parameter driven (`?candelId=...`), so re-exporting keeps the
 * collection and single-instance paths from drifting apart.
 */
export { PATCH, DELETE } from "../route";

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

