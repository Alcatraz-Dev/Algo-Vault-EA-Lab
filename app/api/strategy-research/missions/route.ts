import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { createMission } from "@/lib/strategy-research/mission";
import { listMissions, sanitizeMissionForClient } from "@/lib/strategy-research/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

// Auth: Firebase bearer token (authenticate) — owner-scoped missions.
// Pro entitlement is enforced server-side (checkAccess — same source of truth
// as the Strategy Lab, including feature licenses), so the client can never
// bypass it; the 403 reason powers the locked preview in the UI.
export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const access = await checkAccess(token.uid);
        if (!access.accessible) {
            return NextResponse.json(
                { error: access.reason ?? "The Strategy Research engine requires an active Pro subscription or the AI Strategy Lab license." },
                { status: 403, headers: corsHeaders }
            );
        }
        const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 30));
        const missions = await listMissions(token.uid, limit);
        return NextResponse.json(
            { missions: missions.map((m) => sanitizeMissionForClient(m)) },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-research/missions GET]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to list missions" },
            { status: 500, headers: corsHeaders }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => null)) as {
            name?: unknown;
            spec?: unknown;
        } | null;
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "JSON body required." }, { status: 400, headers: corsHeaders });
        }

        const outcome = await createMission(token.uid, body.name, body.spec);
        if (!outcome.ok || !outcome.mission) {
            return NextResponse.json(
                {
                    error: outcome.error ?? "Mission creation failed.",
                    validation: outcome.validation
                        ? { errors: outcome.validation.errors }
                        : undefined,
                },
                { status: outcome.status, headers: corsHeaders }
            );
        }

        return NextResponse.json(
            { mission: sanitizeMissionForClient(outcome.mission) },
            { status: 201, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-research/missions POST]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Mission creation failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
