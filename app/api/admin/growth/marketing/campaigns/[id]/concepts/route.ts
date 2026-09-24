/** Marketing concepts — generate from campaign config */
import { NextRequest, NextResponse } from "next/server";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";
import { generateConceptForTemplate } from "@/lib/marketing-media/concepts";
import { MARKETING_TEMPLATE_IDS } from "@/lib/marketing-media/collections";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireGrowthAdmin(req);
  if (!admin) return NextResponse.json({ error: "Admin required" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = (await params).id;
  const feature = String(body.feature || "AlgoVault");
  const audience = String(body.audience || "Traders");
  const count = Math.min(Number(body.count || 3), 8);
  const templateId = (MARKETING_TEMPLATE_IDS as readonly string[]).includes(String(body.templateId || "HOOK_EDU")) ? String(body.templateId) : "HOOK_EDU";
  const concepts = Array.from({ length: count }, (_, i) => ({
    id: `cpt_${i}`,
    ...generateConceptForTemplate(templateId as any, feature, audience),
    status: "READY",
    durationSec: 30,
  }));
  return NextResponse.json({ concepts });
}