
import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { MonetizationPlacement } from "@/lib/growth/types";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";

export async function getPlacements(adminToken: string): Promise<MonetizationPlacement[] | { error: string }> {
    const admin = await requireGrowthAdmin(adminToken);
    if (!admin) return { error: "Unauthorized" };

    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.placements).get();
    if (!snap.exists()) return [];
    const data = snap.val() as Record<string, MonetizationPlacement>;
    return Object.entries(data).map(([id, val]) => ({ ...val, id }));
}

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await getPlacements(token);
    if (!Array.isArray(result)) return NextResponse.json(result, { status: 403 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}