
import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { GrowthReport } from "@/lib/growth/types";
import { generateGrowthReport } from "@/lib/growth/report";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";

export async function getReports(adminToken: string) {
    const admin = await requireGrowthAdmin(adminToken);
    if (!admin) return { error: "Unauthorized" };

    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.reports).get();
    if (!snap.exists()) return [];
    const data = snap.val() as Record<string, GrowthReport>;
    return Object.entries(data)
        .map(([id, val]) => ({ ...val, id: val.id ?? id }))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, 50)
        .sort((a, b) => (b.periodEnd ?? 0) - (a.periodEnd ?? 0));
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

    const admin = await requireGrowthAdmin(token);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

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
        actor: admin.uid,
        source: "admin-ui",
    });
    if (result.error) return NextResponse.json(result, { status: 500 });
    return NextResponse.json(result, { status: result.report ? 201 : 200 });
}