/** Marketing creative manage — approve/reject/regenerate/delete */
import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";
import { MARKETING_COLLECTIONS } from "@/lib/marketing-media/collections";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireGrowthAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = (await params).id;
  const updates = { ...body, updatedBy: admin.uid || "system" };
  await adminDatabase.ref(`${MARKETING_COLLECTIONS.creatives}/${id}`).update({ ...updates, updatedAt: Date.now() });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireGrowthAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const id = (await params).id;
  await adminDatabase.ref(`${MARKETING_COLLECTIONS.creatives}/${id}`).remove();
  return NextResponse.json({ ok: true });
}