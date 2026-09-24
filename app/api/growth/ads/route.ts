
import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { MonetizationAd } from "@/lib/growth/types";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";

export async function getAds(adminToken: string): Promise<MonetizationAd[] | { error: string }> {
    const admin = await requireGrowthAdmin(adminToken);
    if (!admin) return { error: "Unauthorized" };

    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.ads).get();
    if (!snap.exists()) return [];
    const data = snap.val() as Record<string, MonetizationAd>;
    return Object.entries(data).map(([id, val]) => ({ ...val, id }));
}

export async function GET(request: NextRequest) {
    const token = bearer(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await getAds(token);
    if (!Array.isArray(result)) return NextResponse.json(result, { status: 403 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

function bearer(request: NextRequest): string {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    return token.trim();
}