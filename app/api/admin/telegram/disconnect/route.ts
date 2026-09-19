import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { telegramUserClientManager } from "@/features/telegram-signals/connectors/telegram-client-manager";

export async function POST(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        const result = await telegramUserClientManager.disconnect();
        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "Failed to disconnect Telegram account" },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Telegram USER ACCOUNT disconnected successfully.",
        });
    } catch (err: any) {
        console.error("[POST /api/admin/telegram/disconnect]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
