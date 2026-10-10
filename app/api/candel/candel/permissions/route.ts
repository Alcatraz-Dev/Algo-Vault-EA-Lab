import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getCandelPermissions,
  saveCandelPermissions,
  saveCandelActivity,
} from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import { defaultCandelPermissions, sanitizeCandelPermissions } from "@/lib/candel/config";
import type { CandelActionType } from "@/lib/candel/types";

// GET /api/candel/candel/permissions/[candelId] — get effective permissions
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const permissions = (await getCandelPermissions(candelId, token.uid)) ?? defaultCandelPermissions();
    return NextResponse.json({ success: true, permissions });
  } catch (error) {
    console.error("[candel/permissions GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load permissions" }, { status: 500 });
  }
}

// POST /api/candel/candel/permissions/[candelId] — save effective permissions
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();

    // The document is coerced server-side: unknown keys are dropped and the
    // approval gate cannot be switched off through this endpoint.
    const permissions = sanitizeCandelPermissions(body);

    await saveCandelPermissions(candelId, token.uid, permissions);

    await saveCandelActivity({
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      action: "update" as CandelActionType,
      targetType: "permissions",
      targetId: candelId,
      details: {
        execution: permissions.execution,
        tradingAccount: permissions.tradingAccount,
      },
      timestamp: Date.now(),
    });

    return NextResponse.json({ success: true, permissions });
  } catch (error) {
    console.error("[candel/permissions POST]", error);
    return NextResponse.json({ success: false, error: "Failed to save permissions" }, { status: 500 });
  }
}
