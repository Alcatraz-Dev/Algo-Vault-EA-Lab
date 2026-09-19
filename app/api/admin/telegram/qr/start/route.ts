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

        const result = await telegramUserClientManager.startQrLogin();
        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "Failed to start QR login" },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "QR login started. Scan the QR code with the Telegram app of the signal account.",
        });
    } catch (err: any) {
        console.error("[POST /api/admin/telegram/qr/start]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}