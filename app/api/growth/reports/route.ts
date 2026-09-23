
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { GrowthReport } from "@/lib/growth/types";
import { generateGrowthReport } from "@/lib/growth/report";

export async function getReports(adminToken: string) {
    try {
        const decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.reports).orderByChild("createdAt").limitToLast(50).get();
    if (!snap.exists()) return [];
    const data = snap.val() as Record<string, GrowthReport>;
    return Object.values(data).sort((a, b) => (b.periodEnd ?? 0) - (a.periodEnd ?? 0));
}

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await getReports(token);
    if (!Array.isArray(result)) return NextResponse.json(result, { status: 403 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { interval?: string; periodStart?: number; periodEnd?: number };
    try {
        body = (await request.json()) as { interval?: string; periodStart?: number; periodEnd?: number };
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const interval = (body.interval === "DAILY" || body.interval === "WEEKLY" || body.interval === "MONTHLY")
        ? body.interval
        : "DAILY";
    const result = await generateGrowthReport({
        interval,
        periodStart: body.periodStart || Date.now() - 24 * 60 * 60 * 1000,
        periodEnd: body.periodEnd || Date.now(),
        actor: "admin:manual",
        source: "admin-ui",
    });
    if (result.error) return NextResponse.json(result, { status: 500 });
    return NextResponse.json(result, { status: result.report ? 201 : 200 });
}