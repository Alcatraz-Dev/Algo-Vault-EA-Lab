
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GrowthCampaign } from "@/lib/growth/types";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";

export async function getCampaigns(adminToken: string): Promise<GrowthCampaign[] | { error: string }> {
    let decoded: { uid: string; admin?: boolean; role?: string } | null = null;
    try {
        decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.campaigns).get();
    if (!snap.exists()) return [];
    const data = snap.val() as Record<string, GrowthCampaign>;
    return Object.entries(data).map(([id, val]) => ({ ...val, id }));
}

export async function createCampaign(adminToken: string, data: Partial<GrowthCampaign>): Promise<{ id: string } | { error: string }> {
    let decoded: { uid: string; admin?: boolean; role?: string } | null = null;
    try {
        decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const now = Date.now();
    const ref = adminDatabase.ref(GROWTH_COLLECTIONS.campaigns).push();
    const id = ref.key as string;
    const campaign: GrowthCampaign = {
        ...data,
        id,
        status: data.status || "DRAFT",
        createdAt: now,
        updatedAt: now,
        createdBy: decoded.uid,
    } as GrowthCampaign;
    await ref.set(campaign);
    return { id };
}

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await getCampaigns(token);
    if (!Array.isArray(result)) return NextResponse.json(result, { status: 403 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let data: Partial<GrowthCampaign>;
    try {
        data = (await request.json()) as Partial<GrowthCampaign>;
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const result = await createCampaign(token, data);
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result, { status: 201 });
}