import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { applyMissionControl } from "@/lib/strategy-research/mission";
import {
    deleteMissionData,
    getMission,
    listEvents,
    listKnowledgeEdges,
    sanitizeMissionForClient,
} from "@/lib/strategy-research/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

async function resolveUid(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) return { uid: null, status: 401 as const, error: "Unauthorized" };
    return { uid: token.uid, status: 200 as const, error: null as string | null };
}

// Auth: owner-scoped bearer token. Mission state (including the server-owned
// lease) is sanitized before it ever reaches the client.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { uid, status, error } = await resolveUid(request);
        if (!uid) return NextResponse.json({ error }, { status, headers: corsHeaders });

        const { id } = await params;
        const mission = await getMission(uid, id);
        if (!mission) {
            return NextResponse.json({ error: "Mission not found" }, { status: 404, headers: corsHeaders });
        }

        const [events, edges] = await Promise.all([
            listEvents(uid, id, 300),
            listKnowledgeEdges(uid, id),
        ]);

        return NextResponse.json(
            { mission: sanitizeMissionForClient(mission), events, knowledgeEdges: edges },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-research/mission GET]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to load mission" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// PATCH body: { action: "pause" | "resume" | "cancel" } — legal transitions
// only, enforced in mission.ts.
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { uid, status, error } = await resolveUid(request);
        if (!uid) return NextResponse.json({ error }, { status, headers: corsHeaders });

        const { id } = await params;
        const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
        const action = typeof body?.action === "string" ? body.action : "";

        const outcome = await applyMissionControl(uid, id, action);
        if (!outcome.ok || !outcome.mission) {
            return NextResponse.json(
                { error: outcome.error ?? "Control action failed." },
                { status: outcome.status, headers: corsHeaders }
            );
        }
        return NextResponse.json(
            { mission: sanitizeMissionForClient(outcome.mission) },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-research/mission PATCH]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Control action failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { uid, status, error } = await resolveUid(request);
        if (!uid) return NextResponse.json({ error }, { status, headers: corsHeaders });

        const { id } = await params;
        const mission = await getMission(uid, id);
        if (!mission) {
            return NextResponse.json({ error: "Mission not found" }, { status: 404, headers: corsHeaders });
        }
        // Refuse deleting a running mission (cancel first) so no worker loses
        // its lease mid-write.
        if (mission.status === "running") {
            return NextResponse.json(
                { error: "Cancel the mission before deleting it." },
                { status: 409, headers: corsHeaders }
            );
        }

        await deleteMissionData(uid, id);
        return NextResponse.json({ ok: true, id }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-research/mission DELETE]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Delete failed" },
            { status: 500, headers: corsHeaders }
        );
    }
}
