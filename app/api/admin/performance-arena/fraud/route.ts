import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listFraudFlags, resolveFraudFlag } from "@/lib/performance-arena/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Content-Type": "application/json" };

// Auth: requireAdmin. Fraud flags are review signals — they never alter
// challenge accounting automatically, and dismissing/acknowledging one only
// updates the flag's own status.
export async function GET(request: NextRequest) {
    try {
        const token = await requireAdmin(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
        const flags = await listFraudFlags(300);
        return NextResponse.json({ flags }, { headers });
    } catch (error) {
        console.error("[admin/performance-arena/fraud GET]", error);
        return NextResponse.json({ error: "Failed to load fraud flags" }, { status: 500, headers });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const token = await requireAdmin(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
        const body = (await request.json().catch(() => null)) as { flagId?: unknown; status?: unknown } | null;
        if (!body || typeof body.flagId !== "string" || (body.status !== "REVIEWED" && body.status !== "DISMISSED")) {
            return NextResponse.json({ error: "flagId and status (REVIEWED | DISMISSED) are required." }, { status: 400, headers });
        }
        await resolveFraudFlag(body.flagId, body.status, Date.now());
        return NextResponse.json({ ok: true }, { headers });
    } catch (error) {
        console.error("[admin/performance-arena/fraud PATCH]", error);
        return NextResponse.json({ error: "Failed to update flag" }, { status: 500, headers });
    }
}
