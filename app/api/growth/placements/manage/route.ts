
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { MonetizationPlacement } from "@/lib/growth/types";
import { deepClean, writeGrowthAudit } from "@/lib/growth/database";

export async function createPlacement(adminToken: string, data: Partial<MonetizationPlacement>): Promise<{ id: string } | { error: string }> {
    let decoded: { uid: string; admin?: boolean; role?: string } | null = null;
    try {
        decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const now = Date.now();
    const ref = adminDatabase.ref(GROWTH_COLLECTIONS.placements).push();
    const id = ref.key as string;
    const placement = deepClean({
        ...data,
        createdAt: now,
        updatedAt: now,
        createdBy: decoded.uid,
        status: "ACTIVE",
    }) as MonetizationPlacement;
    await ref.set(placement);
    await writeGrowthAudit({ actor: decoded.uid, action: "placement_created", targetType: "monetizationPlacement", targetId: id, detail: { name: placement.name, key: placement.key as string } });
    return { id };
}

export async function updatePlacement(adminToken: string, id: string, updates: Partial<MonetizationPlacement>): Promise<{ ok: boolean } | { error: string }> {
    let decoded: { uid: string; admin?: boolean; role?: string } | null = null;
    try {
        decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const ref = adminDatabase.ref(`${GROWTH_COLLECTIONS.placements}/${id}`);
    const snap = await ref.get();
    if (!snap.exists()) return { error: "Placement not found" };

    await ref.update({
        ...deepClean(updates),
        updatedAt: Date.now(),
        updatedBy: decoded.uid,
    } as Record<string, unknown>);
    await writeGrowthAudit({ actor: decoded.uid, action: "placement_updated", targetType: "monetizationPlacement", targetId: id, detail: { fields: Object.keys(updates) } });
    return { ok: true };
}

export async function POST(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: { action: "create" | "update"; id?: string; data?: Partial<MonetizationPlacement> };
    try {
        body = (await request.json()) as { action: "create" | "update"; id?: string; data?: Partial<MonetizationPlacement> };
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    switch (body.action) {
        case "create":
            return NextResponse.json(await createPlacement(token, body.data || {}), { status: 201 });
        case "update":
            if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
            return NextResponse.json(await updatePlacement(token, body.id, body.data || {}));
        default:
            return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
}