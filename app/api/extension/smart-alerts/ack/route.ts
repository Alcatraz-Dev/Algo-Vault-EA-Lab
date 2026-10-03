/**
 * /api/extension/smart-alerts/ack
 *
 * Acknowledges a smart alert so it can be deduplicated / dismissed.
 * Uses the user's alert-state path `users/{uid}/extensionAlerts/{alertId}`.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

async function isPro(uid: string): Promise<boolean> {
    try {
        const roleSnap = await adminDatabase.ref(`users/${uid}/role`).get();
        if (roleSnap.exists() && roleSnap.val() === "admin") return true;
        const subSnap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        if (!subSnap.exists()) return false;
        const sub = subSnap.val();
        const active = sub?.status === "active" || sub?.status === "trialing" || sub?.active === true;
        const eligible = !sub?.plan || ["pro", "elite", "enterprise", "vip"].includes(String(sub.plan).toLowerCase());
        return Boolean(active && eligible);
    } catch {
        return false;
    }
}

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        let decoded;
        try {
            decoded = await adminAuth.verifyIdToken(token);
        } catch {
            return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401, headers: corsHeaders });
        }
        const uid = decoded.uid;

        if (!(await isPro(uid))) {
            return NextResponse.json({ ok: false, error: "pro_required" }, { status: 403, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => ({}))) as { id?: string };
        if (typeof body.id !== "string" || !body.id) {
            return NextResponse.json({ ok: false, error: "id_required" }, { status: 400, headers: corsHeaders });
        }

        await adminDatabase.ref(`users/${uid}/extensionAlerts/${body.id}`).set({
            acknowledged: true,
            at: Date.now(),
        });

        return NextResponse.json({ ok: true }, { status: 200, headers: corsHeaders });
    } catch (err) {
        console.error("[POST /api/extension/smart-alerts/ack]", err);
        return NextResponse.json(
            { ok: false, error: err instanceof Error ? err.message : "server_error" },
            { status: 500, headers: corsHeaders }
        );
    }
}