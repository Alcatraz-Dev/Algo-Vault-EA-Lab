import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const snap = await adminDatabase.ref(`tradeJournal/${user.uid}`).get();
        if (!snap.exists()) {
            return NextResponse.json({ success: true, trades: [] });
        }

        const raw = snap.val() as Record<string, unknown>;
        const trades = Object.values(raw).filter((t) => t && typeof t === "object");
        return NextResponse.json({ success: true, trades });
    } catch (err) {
        console.error("[journal GET]", err);
        return NextResponse.json({ error: "Failed to load journal" }, { status: 500 });
    }
}
