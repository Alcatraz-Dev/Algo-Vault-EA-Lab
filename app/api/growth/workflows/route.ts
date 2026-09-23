import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { buildContentWorkflow } from "@/lib/growth/agents/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminToken(request: NextRequest): string | null {
    const h = request.headers.get("authorization");
    if (!h?.startsWith("Bearer ")) return null;
    return h.slice(7);
}

async function requireAdmin(request: NextRequest) {
    const token = adminToken(request);
    if (!token) return null;
    try {
        const decoded = await adminAuth.verifyIdToken(token);
        const admin = decoded.admin === true || decoded.role === "admin";
        return admin ? decoded : null;
    } catch { return null; }
}

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const snap = await adminDatabase.ref(`${GROWTH_COLLECTIONS.tasks}/workflows`).get();
    const data = snap.exists() ? snap.val() : {};
    const out = Object.entries(data as Record<string, unknown>).map(([id, val]: [string, unknown]) => ({ id, ...val as Record<string, unknown> }));
    return NextResponse.json({ workflows: out });
}

export async function POST(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await request.json();
        const { topic, objective, type = "SEO_ARTICLE", tone = "professional" } = body || {};
        if (!topic || !objective) return NextResponse.json({ error: "topic and objective required" }, { status: 400 });

        const wf = buildContentWorkflow("growth-phase2-" + Date.now());
        const executionId = "wf_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

        // Persist workflow state in RTDB
        await adminDatabase.ref(`${GROWTH_COLLECTIONS.tasks}/workflows/${executionId}`).set({
            id: executionId,
            workflowId: wf.id,
            name: wf.name,
            status: "queued",
            step: "research",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            actor: admin.uid,
            input: { topic, objective, type, tone },
            outputs: {},
        });

        return NextResponse.json({ executionId, workflowId: wf.id, status: "queued" });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
    }
}