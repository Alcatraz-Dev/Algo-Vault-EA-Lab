import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { telegramUserClientManager } from "@/features/telegram-signals/connectors/telegram-client-manager";

export async function GET(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        const status = await telegramUserClientManager.getStatus();
        return NextResponse.json({ success: true, status });
    } catch (err: any) {
        console.error("[GET /api/admin/telegram/status]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
