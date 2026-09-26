import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized", access: "denied" }, { status: 401 });
        }
        const token = authHeader.split("Bearer ")[1];
        const decoded = await adminAuth.verifyIdToken(token);
        const uid = decoded.uid;

        const snap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        const sub = snap.val();
        const hasPro = sub?.status === "active" && (sub?.plan === "pro" || sub?.plan === "enterprise");

        if (!hasPro) {
            return NextResponse.json({ error: "Pro access required", access: "denied", subscription: sub || null }, { status: 403 });
        }

        return NextResponse.json({
            access: "granted",
            userId: uid,
            subscription: { plan: sub?.plan, status: sub?.status },
            terminal: "pro-scalping",
            timestamp: Date.now(),
        });
    } catch (err: unknown) {
        console.error("[GET /api/pro-terminal/access]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Internal server error", access: "denied" }, { status: 500 });
    }
}
