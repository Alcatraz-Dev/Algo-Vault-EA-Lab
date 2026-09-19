import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    const token = await requireAdmin(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const snapshot = await adminDatabase.ref("live_accounts").get();
        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, accounts: [] });
        }

        const data = snapshot.val() as Record<string, Record<string, unknown>>;
        const list: Array<{ id: string } & Record<string, unknown>> = Object.entries(data).map(([id, val]) => ({ id, ...val }));
        list.sort((a, b) => Number(b.lastHeartbeatAt ?? 0) - Number(a.lastHeartbeatAt ?? 0));

        return NextResponse.json({ success: true, accounts: list });
    } catch (error) {
        console.error("[admin/live GET]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Failed to load live accounts.") },
            { status: 500 }
        );
    }
}