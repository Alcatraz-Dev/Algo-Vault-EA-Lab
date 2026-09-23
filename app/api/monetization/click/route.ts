import { NextRequest, NextResponse } from "next/server";
import { recordClick } from "@/lib/growth/tracking";
import { appendAttribution, parseAttribution } from "@/lib/growth/attribution";
import { isSafeDestUrl } from "@/lib/growth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const params = request.nextUrl.searchParams;
        const targetUrl = params.get("url");
        const placementKey = params.get("placementKey");
        const offerId = params.get("offerId");
        const campaignId = params.get("campaignId");
        const clientEventId = params.get("clientEventId");
        const attribution = parseAttribution(params);

        // Validate destination URL
        if (!targetUrl || !isSafeDestUrl(targetUrl)) {
            return NextResponse.json({ error: "Invalid destination URL" }, { status: 400 });
        }

        // Validate attribution
        const attributionParams = {
            offerId: attribution.offerId ?? offerId ?? undefined,
            campaignId: attribution.campaignId ?? campaignId ?? undefined,
            source: attribution.source ?? "algovault",
            medium: attribution.medium ?? "affiliate",
            content: attribution.content ?? undefined,
            placementKey: attribution.placementKey ?? placementKey ?? undefined,
        };

        // Record click (idempotent by clientEventId)
        const result = await recordClick({
            placementKey: attributionParams.placementKey,
            offerId: attributionParams.offerId,
            campaignId: attributionParams.campaignId,
            clientEventId: clientEventId ?? undefined,
            source: attributionParams.source,
            medium: attributionParams.medium,
            content: attributionParams.content,
            targetUrl,
        });

        // Append attribution to destination
        const destination = appendAttribution(targetUrl, attributionParams);

        // Redirect to destination
        return NextResponse.redirect(destination, 302);
    } catch (err) {
        console.error("[GET /api/monetization/click]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// Reject non-GET methods
export async function POST() {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
export async function PUT() {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
export async function DELETE() {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}