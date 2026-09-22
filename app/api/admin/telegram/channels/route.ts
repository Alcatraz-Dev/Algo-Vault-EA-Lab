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

        const result = await telegramUserClientManager.getDialogs();
        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "Failed to fetch Telegram channels" },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            channels: result.channels || [],
        });
    } catch (err: unknown) {
        console.error("[GET /api/admin/telegram/channels]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}
