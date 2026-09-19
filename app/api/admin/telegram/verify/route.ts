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
        const { code } = body;

        if (!code || typeof code !== "string" || !code.trim()) {
            return NextResponse.json(
                { error: "Verification code is required" },
                { status: 400 }
            );
        }

        const result = await telegramUserClientManager.verifyCode(code.trim());
        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "Verification code failed" },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            requires2FA: result.requires2FA || false,
            message: result.requires2FA
                ? "Two-factor authentication required. Please submit 2FA password."
                : "Telegram USER ACCOUNT successfully connected.",
        });
    } catch (err: any) {
        console.error("[POST /api/admin/telegram/verify]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
