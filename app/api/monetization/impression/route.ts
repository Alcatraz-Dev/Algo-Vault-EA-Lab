import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/firebase";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { recordImpression } from "@/lib/growth/tracking";
import { isSafeDestUrl } from "@/lib/growth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        // Extract body
        const body = await request.json();
        const {
            placementKey,
            offerId,
            campaignId,
            channel,
            uid,
            clientEventId,
            device,
            country,
            sessionId,
        } = body;

        // Validate required fields
        if (!clientEventId || typeof clientEventId !== "string" || clientEventId.length === 0) {
            return NextResponse.json({ error: "Missing or invalid clientEventId" }, { status: 400 });
        }

        // Build input for recordImpression
        const input = {
            placementKey: placementKey ?? undefined,
            offerId: offerId ?? undefined,
            campaignId: campaignId ?? undefined,
            channel: channel ?? undefined,
            uid: uid ?? null,
            clientEventId,
            device: device ?? undefined,
            country: country ?? undefined,
            sessionId: sessionId ?? undefined,
        };

        const result = await recordImpression(input);
        return NextResponse.json(result);
    } catch (err) {
        console.error("[POST /api/monetization/impression]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// Reject non-POST methods
export async function GET() {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
export async function PUT() {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
export async function DELETE() {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}