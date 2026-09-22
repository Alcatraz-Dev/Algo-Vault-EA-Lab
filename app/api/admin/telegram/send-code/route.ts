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
        const { phoneNumber, forceSMS } = body;

        if (!phoneNumber || typeof phoneNumber !== "string" || !phoneNumber.trim()) {
            return NextResponse.json(
                { error: "Valid phone number (E.164 format, e.g. +46...) is required" },
                { status: 400 }
            );
        }

        let cleanPhone = phoneNumber.trim();
        if (!cleanPhone.startsWith("+") && /^\d+$/.test(cleanPhone)) {
            cleanPhone = `+${cleanPhone}`;
        }

        const result = await telegramUserClientManager.sendCode(cleanPhone, { forceSMS: !!forceSMS });
        if (!result.success) {
            console.error("[POST /api/admin/telegram/send-code] Error sending code:", result.error);
            return NextResponse.json(
                { error: result.error || "Failed to send verification code" },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            phoneCodeHash: result.phoneCodeHash,
            isCodeViaApp: result.isCodeViaApp,
            message: result.isCodeViaApp
                ? "Verification code sent to your Telegram app notification"
                : "Verification code sent via SMS",
        });
    } catch (err: unknown) {
        console.error("[POST /api/admin/telegram/send-code]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}
