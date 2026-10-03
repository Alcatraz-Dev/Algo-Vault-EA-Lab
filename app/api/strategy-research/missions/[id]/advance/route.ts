import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { advanceMission, runMissionToCompletion } from "@/lib/strategy-research/orchestrator";
import { getMission, sanitizeMissionForClient } from "@/lib/strategy-research/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Research units are bounded (one candidate / one stage transition) but the
// data + engine steps inside them can take a while.
export const maxDuration = 300;

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

// Auth: owner-scoped bearer token + Pro entitlement re-checked server-side
// (compute is never driven for free accounts), then the orchestrator's lease
// makes duplicate concurrent execution impossible.
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        const access = await checkAccess(uid);
        if (!access.accessible) {
            return NextResponse.json({ error: access.reason ?? "Access denied" }, { status: 403, headers: corsHeaders });
        }

        const { id } = await params;
        const existing = await getMission(uid, id);
        if (!existing) {
            return NextResponse.json({ error: "Mission not found" }, { status: 404, headers: corsHeaders });
        }
        if (existing.uid !== uid) {
            // Owner-only: never operate on another user's mission.
            return NextResponse.json({ error: "Mission not found" }, { status: 404, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => ({}))) as { runAll?: unknown; maxUnits?: unknown };
        const runAll = body.runAll === true;
        const maxUnits = Math.min(60, Math.max(1, Math.floor(Number(body.maxUnits) || 1)));

        const result = runAll
            ? await runMissionToCompletion(uid, id, maxUnits)
            : await advanceMission(uid, id);

        const mission = await getMission(uid, id);
        return NextResponse.json(
            { result, mission: mission ? sanitizeMissionForClient(mission) : null },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-research/advance]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Advance failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
