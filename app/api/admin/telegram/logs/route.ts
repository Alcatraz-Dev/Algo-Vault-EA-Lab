import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        const snap = await adminDatabase.ref("telegramLogs").once("value");
        if (!snap.exists()) {
            return NextResponse.json({ success: true, logs: [] });
        }

        const logsObj = snap.val();
        const logs = Object.values(logsObj);
        logs.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

        return NextResponse.json({
            success: true,
            logs,
        });
    } catch (err: any) {
        console.error("[GET /api/admin/telegram/logs]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
