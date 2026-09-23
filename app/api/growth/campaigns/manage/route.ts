
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { GrowthCampaign } from "@/lib/growth/types";
import { deepClean, writeGrowthAudit } from "@/lib/growth/database";

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
    const campaign = deepClean({
        ...data,
        status: data.status || "DRAFT",
        createdAt: now,
        updatedAt: now,
        createdBy: decoded.uid,
    }) as GrowthCampaign;
    await ref.set(campaign);
    await writeGrowthAudit({ actor: decoded.uid, action: "campaign_created", targetType: "growthCampaign", targetId: id, detail: { name: campaign.name } });
    return { id };
}

export async function updateCampaign(adminToken: string, id: string, updates: Partial<GrowthCampaign>): Promise<{ ok: boolean } | { error: string }> {
    let decoded: { uid: string; admin?: boolean; role?: string } | null = null;
    try {
        decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const ref = adminDatabase.ref(`${GROWTH_COLLECTIONS.campaigns}/${id}`);
    const snap = await ref.get();
    if (!snap.exists()) return { error: "Campaign not found" };

    await ref.update({
        ...deepClean(updates),
        updatedAt: Date.now(),
        updatedBy: decoded.uid,
    } as Record<string, unknown>);

    const before = snap.val() as Partial<GrowthCampaign>;
    if (before.status && updates.status && before.status !== updates.status) {
        await writeGrowthAudit({ actor: decoded.uid, action: "campaign_status_changed", targetType: "growthCampaign", targetId: id, detail: { from: before.status, to: updates.status } });
    } else {
        await writeGrowthAudit({ actor: decoded.uid, action: "campaign_updated", targetType: "growthCampaign", targetId: id, detail: { fields: Object.keys(updates) } });
    }
    return { ok: true };
}

export async function pauseCampaign(adminToken: string, id: string): Promise<{ ok: boolean } | { error: string }> {
    return updateCampaign(adminToken, id, { status: "PAUSED" });
}

export async function resumeCampaign(adminToken: string, id: string): Promise<{ ok: boolean } | { error: string }> {
    return updateCampaign(adminToken, id, { status: "ACTIVE" });
}

export async function archiveCampaign(adminToken: string, id: string): Promise<{ ok: boolean } | { error: string }> {
    return updateCampaign(adminToken, id, { status: "ARCHIVED" });
}

type ManageAction = "create" | "update" | "pause" | "resume" | "archive";

export async function POST(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: { action: ManageAction; id?: string; data?: Partial<GrowthCampaign> };
    try {
        body = (await request.json()) as { action: ManageAction; id?: string; data?: Partial<GrowthCampaign> };
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    switch (body.action) {
        case "create":
            return NextResponse.json(await createCampaign(token, body.data || {}), { status: 201 });
        case "update":
            if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
            return NextResponse.json(await updateCampaign(token, body.id, body.data || {}));
        case "pause":
            if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
            return NextResponse.json(await pauseCampaign(token, body.id));
        case "resume":
            if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
            return NextResponse.json(await resumeCampaign(token, body.id));
        case "archive":
            if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
            return NextResponse.json(await archiveCampaign(token, body.id));
        default:
            return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
}