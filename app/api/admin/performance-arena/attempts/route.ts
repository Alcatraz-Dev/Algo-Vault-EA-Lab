import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAllAttempts, listResultsAll, listEventsForAttempt } from "@/lib/performance-arena/admin-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Content-Type": "application/json" };

// Auth: requireAdmin. Read-only inspection of attempts, results and the most
// recent rule events for a selected attempt (?attemptId=&uid=).
export async function GET(request: NextRequest) {
    try {
        const token = await requireAdmin(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });

        const attemptId = request.nextUrl.searchParams.get("attemptId");
        const uid = request.nextUrl.searchParams.get("uid");
        if (attemptId && uid) {
            const events = await listEventsForAttempt(uid, attemptId, 100);
            return NextResponse.json({ events }, { headers });
        }

        const attempts = await listAllAttempts(300);
        const results = await listResultsAll(300);
        return NextResponse.json({ attempts, results }, { headers });
    } catch (error) {
        console.error("[admin/performance-arena/attempts GET]", error);
        return NextResponse.json({ error: "Failed to load attempts" }, { status: 500, headers });
    }
}
