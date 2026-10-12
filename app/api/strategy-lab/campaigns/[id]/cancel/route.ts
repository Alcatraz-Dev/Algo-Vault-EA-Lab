import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { campaignStore } from "@/lib/ai/strategy-lab/campaign-storage";
import { markCampaignCancelRequested } from "@/lib/ai/strategy-lab/campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/strategy-lab/campaigns/:id/cancel
 *
 * Requests a cooperative cancel. The campaign is not torn down mid-generation;
 * its status flips to `cancel_requested` and the next generation boundary
 * finalises it to `cancelled`. Already-terminal campaigns are returned
 * unchanged.
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
        const campaign = await campaignStore.get(token.uid, id);
        if (!campaign) {
            return NextResponse.json({ error: "Campaign not found." }, { status: 404, headers: corsHeaders });
        }

        const updated = markCampaignCancelRequested(campaign);
        const changed = updated !== campaign;
        if (changed) {
            await campaignStore.update(token.uid, id, {
                status: updated.status,
                cancelRequestedAt: updated.cancelRequestedAt,
                updatedAt: updated.updatedAt,
                version: updated.version,
            });
        }

        return NextResponse.json(
            { ok: true, campaign: updated, requested: changed },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-lab/campaigns cancel]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Campaign cancel failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}