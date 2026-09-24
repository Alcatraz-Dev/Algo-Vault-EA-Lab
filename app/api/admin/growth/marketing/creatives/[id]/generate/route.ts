/** Marketing generate — trigger pipeline stage */
import { NextRequest, NextResponse } from "next/server";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";
import { runPipeline, buildMarketingPipeline } from "@/lib/marketing-media/pipeline";
import { getCreative } from "@/lib/marketing-media/storage";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireGrowthAdmin(req);
  if (!admin) return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const creative = await getCreative((await params).id);
  if (!creative) return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  try {
    const result = await runPipeline(creative, admin.uid || "system");
    return NextResponse.json({ ok: result.ok, stage: result.ok ? "READY" : "FAILED", error: result.error });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" });
  }
}