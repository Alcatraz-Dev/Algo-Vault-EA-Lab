
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { AffiliateOffer } from "@/lib/growth/types";
import { deepClean, writeGrowthAudit } from "@/lib/growth/database";

export async function createAffiliateOffer(adminToken: string, data: Partial<AffiliateOffer>): Promise<{ id: string } | { error: string }> {
    let decoded: { uid: string; admin?: boolean; role?: string } | null = null;
    try {
        decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const now = Date.now();
    const ref = adminDatabase.ref(GROWTH_COLLECTIONS.affiliateOffers).push();
    const id = ref.key as string;
    const offer = deepClean({
        ...data,
        active: data.active ?? true,
        createdAt: now,
        updatedAt: now,
        createdBy: decoded.uid,
        status: "ACTIVE",
        clicks: 0,
        conversions: 0,
    }) as AffiliateOffer;
    await ref.set(offer);
    await writeGrowthAudit({ actor: decoded.uid, action: "affiliate_created", targetType: "affiliateOffer", targetId: id, detail: { name: offer.name } });
    return { id };
}

export async function updateAffiliateOffer(adminToken: string, id: string, updates: Partial<AffiliateOffer>): Promise<{ ok: boolean } | { error: string }> {
    let decoded: { uid: string; admin?: boolean; role?: string } | null = null;
    try {
        decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const ref = adminDatabase.ref(`${GROWTH_COLLECTIONS.affiliateOffers}/${id}`);
    const snap = await ref.get();
    if (!snap.exists()) return { error: "Offer not found" };

    await ref.update({
        ...deepClean(updates),
        updatedAt: Date.now(),
        updatedBy: decoded.uid,
    } as Record<string, unknown>);
    await writeGrowthAudit({ actor: decoded.uid, action: "affiliate_updated", targetType: "affiliateOffer", targetId: id, detail: { fields: Object.keys(updates) } });
    return { ok: true };
}

type ManageAction = "create" | "update";

export async function POST(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: { action: ManageAction; id?: string; data?: Partial<AffiliateOffer> };
    try {
        body = (await request.json()) as { action: ManageAction; id?: string; data?: Partial<AffiliateOffer> };
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    switch (body.action) {
        case "create":
            return NextResponse.json(await createAffiliateOffer(token, body.data || {}), { status: 201 });
        case "update":
            if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
            return NextResponse.json(await updateAffiliateOffer(token, body.id, body.data || {}));
        default:
            return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
}