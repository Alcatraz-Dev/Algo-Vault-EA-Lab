/**
 * AlgoVault — Growth audit log API (admin).
 *
 * Exposes the real growthAuditLogs trail with optional filtering by
 * targetType/targetId. Used by campaign details (timeline) and overviews.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { listGrowthAudit } from "@/lib/growth/database";

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") {
            return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") || 200), 500);
    const targetId = searchParams.get("targetId");
    const targetType = searchParams.get("targetType");

    const entries = await listGrowthAudit(limit);
    const filtered = entries.filter((e) => {
        if (targetId && e.targetId !== targetId) return false;
        if (targetType && e.targetType !== targetType) return false;
        return true;
    });

    return NextResponse.json(filtered, { headers: { "Cache-Control": "no-store" } });
}