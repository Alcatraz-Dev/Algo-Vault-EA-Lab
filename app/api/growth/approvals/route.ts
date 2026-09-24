/**
 * AlgoVault — Growth approvals API (admin).
 *
 * Exposes the approval queue: marketing tasks awaiting review (READY_FOR_REVIEW)
 * and historical approval decisions from aiMarketingApprovals.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { MarketingTask, MarketingApproval } from "@/lib/growth/types";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";

export async function GET(request: NextRequest) {
    const admin = await requireGrowthAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state") || "READY_FOR_REVIEW";
    const limit = Math.min(Number(searchParams.get("limit") || 50), 200);

    // Fetch tasks in the requested review state
    const tasksSnap = await adminDatabase
        .ref(GROWTH_COLLECTIONS.tasks)
        .get();

    const tasksData = (tasksSnap.val() || {}) as Record<string, MarketingTask>;
    const tasks = Object.entries(tasksData)
        .filter(([id]) => !id.startsWith("_"))
        .map(([id, value]) => ({ ...value, id }))
        .filter((t) => t.state === state)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, limit);

    // Fetch recent approval decisions for history
    const approvalsSnap = await adminDatabase
        .ref(GROWTH_COLLECTIONS.approvals)
        .get();

    const approvalsData = (approvalsSnap.val() || {}) as Record<string, MarketingApproval>;
    const approvals = Object.entries(approvalsData)
        .filter(([id]) => !id.startsWith("_"))
        .map(([id, value]) => ({ ...value, id }))
        .sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0))
        .slice(0, 50);

    return NextResponse.json({ tasks, approvals }, { headers: { "Cache-Control": "no-store" } });
}