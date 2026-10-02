import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { sanitizeOrderFlowSettings } from "@/lib/order-flow/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/order-flow/settings — read the caller's order-flow settings.
 * Stored under `users/{uid}/orderFlowSettings` in Firebase Realtime Database
 * (the platform's existing persistence layer; no Firestore anywhere).
 */
export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const decoded = await adminAuth.verifyIdToken(token);
        const snap = await adminDatabase.ref(`users/${decoded.uid}/orderFlowSettings`).get();
        const raw = snap.exists() ? snap.val() : {};
        return NextResponse.json({ success: true, settings: sanitizeOrderFlowSettings(raw) });
    } catch {
        return NextResponse.json({ error: "Failed to load order flow settings" }, { status: 500 });
    }
}

/**
 * PUT /api/order-flow/settings — persist sanitized settings. Malformed input
 * never reaches the database: sanitizeOrderFlowSettings clamps every field,
 * so a poisoned payload degrades to defaults instead of corrupting the user's
 * calculation parameters.
 */
export async function PUT(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const decoded = await adminAuth.verifyIdToken(token);
        const body = (await request.json().catch(() => null)) as { settings?: unknown } | null;
        const settings = sanitizeOrderFlowSettings(body?.settings ?? {});
        await adminDatabase.ref(`users/${decoded.uid}/orderFlowSettings`).set(settings);
        return NextResponse.json({ success: true, settings });
    } catch {
        return NextResponse.json({ error: "Failed to save order flow settings" }, { status: 500 });
    }
}
