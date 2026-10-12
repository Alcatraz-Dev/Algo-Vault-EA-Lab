import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { campaignStore } from "@/lib/ai/strategy-lab/campaign-storage";
import { advanceCampaign, DEFAULT_MAX_WORK_MS, type CampaignSpec } from "@/lib/ai/strategy-lab/campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/strategy-lab/campaigns/:id/advance
 *
 * Body: { maxWorkMs? }
 *
 * Performs up to one generation of breeding (or fewer when the work budget is
 * exhausted) and persists the cursor, progress, reports and vault.
 *
 * The endpoint is idempotent under concurrency: a lease ensures only one
 * worker advances a campaign at a time; when another worker holds it the call
 * returns `{ ok: false, reason: "lease-held" }` so the caller can retry.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const access = await checkAccess(token.uid);
        if (!access.accessible) {
            return NextResponse.json({ error: "Strategy Lab access required.", access }, { status: 403, headers: corsHeaders });
        }

        const { id } = await params;
        const body = (await request.json().catch(() => ({}))) as { maxWorkMs?: number };
        const maxWorkMs = Number.isFinite(body.maxWorkMs)
            ? Math.max(1_000, Math.min(body.maxWorkMs as number, 50_000))
            : DEFAULT_MAX_WORK_MS;

        const result = await advanceCampaign({
            campaignId: id,
            uid: token.uid,
            workerId: `adv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            store: campaignStore,
            loadData: (spec: CampaignSpec) => loadDataBundle(spec.symbol, spec.period, spec.hierarchy),
            maxWorkMs,
        });

        if (!result.ok && result.reason === "not-found") {
            return NextResponse.json({ error: "Campaign not found." }, { status: 404, headers: corsHeaders });
        }

        return NextResponse.json(result, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/campaigns advance]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Campaign advance failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}