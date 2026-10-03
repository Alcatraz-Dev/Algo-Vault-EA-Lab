import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listRewardPolicies, saveRewardPolicy, listAllLedger } from "@/lib/performance-arena/store";
import { isCashRewardsEnabled } from "@/lib/performance-arena/flags";
import type { RewardPolicy, RewardGrantSpec } from "@/lib/performance-arena/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Content-Type": "application/json" };

// Auth: requireAdmin. Read-only view of reward policies, the immutable
// ledger, and the cash flag (reported as server truth — NOT settable here).
export async function GET(request: NextRequest) {
    try {
        const token = await requireAdmin(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
        const [policies, ledger] = await Promise.all([listRewardPolicies(), listAllLedger(500)]);
        return NextResponse.json(
            {
                policies,
                ledger,
                cashRewardsEnabled: isCashRewardsEnabled(),
                cashRewardsMutableViaApi: false,
            },
            { headers }
        );
    } catch (error) {
        console.error("[admin/performance-arena/rewards GET]", error);
        return NextResponse.json({ error: "Failed to load rewards" }, { status: 500, headers });
    }
}

// Auth: requireAdmin. Saves a PLATFORM reward policy. Any CASH grant in the
// payload is stripped and rejected — the admin surface cannot configure cash
// rewards even if a request tries (activation is env-only, outside any UI).
export async function POST(request: NextRequest) {
    try {
        const token = await requireAdmin(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });

        const body = (await request.json().catch(() => null)) as Partial<RewardPolicy> | null;
        if (!body || !body.id || !Array.isArray(body.grants)) {
            return NextResponse.json({ error: "id and grants are required." }, { status: 400, headers });
        }

        const cashAttempts = body.grants.filter((g) => g?.type === "CASH");
        if (cashAttempts.length > 0) {
            return NextResponse.json(
                { error: "CASH rewards cannot be configured. They are disabled by server configuration (CASH_REWARDS_ENABLED=false) and are not part of any admin surface.", code: "CASH_REWARDS_DISABLED" },
                { status: 403, headers }
            );
        }

        const validGrants: RewardGrantSpec[] = body.grants.filter(
            (g): g is RewardGrantSpec =>
                Boolean(g) && typeof g.type === "string" && Number.isFinite(g.amount) && typeof g.when === "string"
        );

        const existingList = await listRewardPolicies();
        const existing = existingList.find((p) => p.id === body.id);
        const now = Date.now();
        const policy: RewardPolicy = {
            id: body.id,
            name: body.name ?? existing?.name ?? body.id,
            description: body.description ?? existing?.description ?? "",
            enabled: body.enabled ?? existing?.enabled ?? true,
            version: (existing?.version ?? 0) + 1,
            grants: validGrants,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        await saveRewardPolicy(policy);
        return NextResponse.json({ policy }, { headers });
    } catch (error) {
        console.error("[admin/performance-arena/rewards POST]", error);
        return NextResponse.json({ error: "Failed to save reward policy" }, { status: 500, headers });
    }
}
