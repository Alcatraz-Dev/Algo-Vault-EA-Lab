import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listDefinitions, saveDefinition } from "@/lib/performance-arena/store";
import { validateDefinition } from "@/lib/performance-arena/policies";
import type { ChallengeDefinition } from "@/lib/performance-arena/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Content-Type": "application/json" };

// Auth: requireAdmin. Admins manage catalog configuration — never user
// balances, results or rewards (those are engine outputs, not editable rows).
export async function GET(request: NextRequest) {
    try {
        const token = await requireAdmin(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
        const definitions = await listDefinitions();
        return NextResponse.json({ definitions }, { headers });
    } catch (error) {
        console.error("[admin/performance-arena/definitions GET]", error);
        return NextResponse.json({ error: "Failed to load definitions" }, { status: 500, headers });
    }
}

// Auth: requireAdmin. Full server-side policy validation; invalid policies
// are rejected (fail-closed) rather than stored and enforced loosely.
export async function POST(request: NextRequest) {
    try {
        const token = await requireAdmin(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });

        const body = (await request.json().catch(() => null)) as Partial<ChallengeDefinition> | null;
        if (!body || !body.policy || !body.key || !body.name || !body.access) {
            return NextResponse.json({ error: "key, name, policy and access are required." }, { status: 400, headers });
        }

        const now = Date.now();
        const candidate: ChallengeDefinition = {
            id: body.id ?? body.key,
            key: body.key,
            name: body.name,
            tier: body.tier ?? "custom",
            summary: body.summary ?? "",
            policy: body.policy,
            access: body.access,
            rewardPolicyId: body.rewardPolicyId ?? "arena-standard-rewards",
            status: body.status ?? "DRAFT",
            enabled: body.enabled ?? false,
            version: 1,
            createdAt: now,
            updatedAt: now,
            createdBy: token.uid,
            ...(body.access.model === "paid" && Number.isSafeInteger(body.access.priceCents) && (body.access.priceCents ?? 0) > 0
                ? { paidBillingConfiguredAt: now }
                : {}),
        };

        const validation = validateDefinition(candidate);
        if (!validation.valid) {
            return NextResponse.json({ error: "Invalid challenge definition.", errors: validation.errors }, { status: 422, headers });
        }

        const existing = await listDefinitions();
        if (existing.some((d) => d.id === candidate.id)) {
            return NextResponse.json({ error: "A definition with this id already exists." }, { status: 409, headers });
        }

        await saveDefinition(candidate);
        return NextResponse.json({ definition: candidate }, { status: 201, headers });
    } catch (error) {
        console.error("[admin/performance-arena/definitions POST]", error);
        return NextResponse.json({ error: "Failed to create definition" }, { status: 500, headers });
    }
}
