import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { campaignStore } from "@/lib/ai/strategy-lab/campaign-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

        // A running campaign may be mid-generation on another worker; never
        // delete an active job out from under it. Cancel it first, then delete.
        if (campaign.status === "running" || campaign.status === "queued") {
            return NextResponse.json(
                {
                    error: `Campaign is ${campaign.status}. Cancel it first, then delete.`,
                    campaign,
                },
                { status: 409, headers: corsHeaders }
            );
        }

        await campaignStore.deleteSurvivors(token.uid, id);
        await campaignStore.delete(token.uid, id);

        return NextResponse.json({ ok: true, id }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/campaigns DELETE]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Campaign deletion failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}