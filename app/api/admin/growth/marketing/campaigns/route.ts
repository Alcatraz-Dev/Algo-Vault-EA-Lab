/** Marketing Studio API — campaigns */
import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { MARKETING_COLLECTIONS } from "@/lib/marketing-media/collections";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";

export async function GET(req: NextRequest) {
  const admin = await requireGrowthAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const snap = await adminDatabase.ref(MARKETING_COLLECTIONS.campaigns).get();
  const data = snap.val() || {};
  const out = Object.entries(data).map(([id, v]) => ({ ...(v as object), id })) as Array<Record<string, unknown>>;
  return NextResponse.json(out.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 50));
}

export async function POST(req: NextRequest) {
  const admin = await requireGrowthAdmin(req);
  if (!admin) return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const ref = adminDatabase.ref(MARKETING_COLLECTIONS.campaigns).push();
  const id = ref.key as string;
  const rec = { ...body, id, createdAt: Date.now(), updatedAt: Date.now(), createdBy: admin.uid, status: body.status || "DRAFT" };
  await ref.set(rec);
  return NextResponse.json({ id, ...rec }, { status: 201 });
}