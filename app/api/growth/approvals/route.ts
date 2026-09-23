/**
 * AlgoVault — Growth approvals API (admin).
 *
 * Exposes the approval queue: marketing tasks awaiting review (READY_FOR_REVIEW)
 * and historical approval decisions from aiMarketingApprovals.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { MarketingTask, MarketingApproval } from "@/lib/growth/types";

type AdminClaims = { uid: string; admin?: boolean; role?: string };

async function requireAdmin(token: string): Promise<AdminClaims | null> {
    try {
        const decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") return null;
        return { uid: decoded.uid, admin: decoded.admin, role: decoded.role };
    } catch {
        return null;
    }
}

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = await requireAdmin(token);
    if (!admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state") || "READY_FOR_REVIEW";
    const limit = Math.min(Number(searchParams.get("limit") || 50), 200);

    // Fetch tasks in the requested review state
    const tasksSnap = await adminDatabase
        .ref(GROWTH_COLLECTIONS.tasks)
        .orderByChild("state")
        .equalTo(state)
        .limitToLast(limit)
        .get();

    const tasksData = (tasksSnap.val() || {}) as Record<string, MarketingTask>;
    const tasks = Object.entries(tasksData)
        .filter(([id]) => !id.startsWith("_"))
        .map(([id, value]) => ({ ...value, id }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // Fetch recent approval decisions for history
    const approvalsSnap = await adminDatabase
        .ref(GROWTH_COLLECTIONS.approvals)
        .orderByChild("decidedAt")
        .limitToLast(50)
        .get();

    const approvalsData = (approvalsSnap.val() || {}) as Record<string, MarketingApproval>;
    const approvals = Object.entries(approvalsData)
        .filter(([id]) => !id.startsWith("_"))
        .map(([id, value]) => ({ ...value, id }))
        .sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0));

    return NextResponse.json({ tasks, approvals }, { headers: { "Cache-Control": "no-store" } });
}