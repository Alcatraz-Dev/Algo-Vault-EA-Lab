import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { detectAllOpportunities } from "@/lib/growth/opportunities/detect";
import { collectFeedback } from "@/lib/growth/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization") || "";
        if (!authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const token = authHeader.slice(7);
        const decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const [opportunities, feedback] = await Promise.all([
            detectAllOpportunities(),
            collectFeedback(),
        ]);

        return NextResponse.json({
            opportunities,
            feedback,
            count: opportunities.length,
            source: "real_stored_data_only",
        });
    } catch (err) {
        console.error("[GET /api/growth/opportunities]", err);
        return NextResponse.json({ error: "Internal error", opportunities: [], feedback: { analyticsAvailable: false, unavailableSources: [] } }, { status: 500 });
    }
}