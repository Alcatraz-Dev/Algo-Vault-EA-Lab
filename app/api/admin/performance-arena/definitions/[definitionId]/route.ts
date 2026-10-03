import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getDefinition, saveDefinition } from "@/lib/performance-arena/store";
import { validateDefinition } from "@/lib/performance-arena/policies";
import type { ChallengeDefinition } from "@/lib/performance-arena/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Content-Type": "application/json" };

// Auth: requireAdmin. Updates are validated end-to-end; version increments so
// attempts keep their immutable join-time policy snapshot regardless of edits.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ definitionId: string }> }) {
    try {
        const token = await requireAdmin(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });

        const { definitionId } = await params;
        const existing = await getDefinition(definitionId);
        if (!existing) return NextResponse.json({ error: "Definition not found" }, { status: 404, headers });

        const body = (await request.json().catch(() => null)) as Partial<ChallengeDefinition> | null;
        if (!body) return NextResponse.json({ error: "JSON body required." }, { status: 400, headers });

        const next: ChallengeDefinition = {
            ...existing,
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.summary !== undefined ? { summary: body.summary } : {}),
            ...(body.tier !== undefined ? { tier: body.tier } : {}),
            ...(body.policy !== undefined ? { policy: body.policy } : {}),
            ...(body.access !== undefined ? { access: body.access } : {}),
            ...(body.rewardPolicyId !== undefined ? { rewardPolicyId: body.rewardPolicyId } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
            updatedAt: Date.now(),
            version: existing.version + (body.policy ? 1 : 0),
        };

        const validation = validateDefinition(next);
        if (!validation.valid) {
            return NextResponse.json({ error: "Invalid update.", errors: validation.errors }, { status: 422, headers });
        }

        await saveDefinition(next);
        return NextResponse.json({ definition: next }, { headers });
    } catch (error) {
        console.error("[admin/performance-arena/definitions PATCH]", error);
        return NextResponse.json({ error: "Failed to update definition" }, { status: 500, headers });
    }
}
