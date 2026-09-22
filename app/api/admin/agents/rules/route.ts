import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

async function requireAdmin(request: NextRequest): Promise<{ uid: string; token: Record<string, unknown> } | null> {
    const authHeader = request.headers.get("authorization");
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return null;
    try {
        // Rules management is admin-only — verify the ID token and its claims.
        const decoded = await adminAuth.verifyIdToken(idToken);
        const isAdmin = decoded.admin === true || decoded.role === "admin";
        if (!isAdmin) return null;
        return { uid: decoded.uid, token: decoded as unknown as Record<string, unknown> };
    } catch {
        return null;
    }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await request.json();
        const { rules } = body;
        if (!rules) return NextResponse.json({ error: "rules required" }, { status: 400 });
        await adminDatabase.ref(".rules").set(rules);
        return NextResponse.json({ updated: true });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const snap = await adminDatabase.ref(".rules").get();
    return NextResponse.json({ rules: snap.val() });
}