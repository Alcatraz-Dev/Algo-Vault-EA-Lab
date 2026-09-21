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

        const body = await request.json().catch(() => ({}));
        const { password } = body;

        if (!password || typeof password !== "string" || !password.trim()) {
            return NextResponse.json(
                { error: "2FA password is required" },
                { status: 400 }
            );
        }

        const result = await telegramUserClientManager.signIn2FA(password.trim());
        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "2FA authentication failed" },
                { status: 400 }
            );
        }

        await telegramUserClientManager.startMonitoring();

        return NextResponse.json({
            success: true,
            message: "2FA complete. Telegram USER ACCOUNT successfully connected. Monitoring started.",
        });
    } catch (err: any) {
        console.error("[POST /api/admin/telegram/2fa]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
