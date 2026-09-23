
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { MonetizationSettings } from "@/lib/growth/types";
import { deepClean } from "@/lib/growth/database";

export async function getSettings(adminToken: string) {
    try {
        const decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") return { error: "Unauthorized" };
    } catch {
        return { error: "Unauthorized" };
    }

    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.settings).get();
    if (!snap.exists()) return null;
    return snap.val() as MonetizationSettings;
}

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await getSettings(token);
    if (result && typeof result === "object" && "error" in result) return NextResponse.json(result, { status: 403 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let decoded: { uid: string; admin?: boolean; role?: string } | null = null;
    try {
        decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    let data: Partial<MonetizationSettings>;
    try {
        data = (await request.json()) as Partial<MonetizationSettings>;
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const ref = adminDatabase.ref(GROWTH_COLLECTIONS.settings);
    const snap = await ref.get();
    const existing = snap.exists() ? (snap.val() as MonetizationSettings) : {};

    await ref.set(deepClean({
        ...existing,
        ...data,
        updatedAt: Date.now(),
        updatedBy: decoded.uid,
    }));
    return NextResponse.json({ ok: true });
}