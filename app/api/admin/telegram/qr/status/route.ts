import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { telegramUserClientManager } from "@/features/telegram-signals/connectors/telegram-client-manager";
import QRCode from "qrcode";

export async function GET(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        const state = await telegramUserClientManager.getQrAuthState();

        let qrDataUrl: string | undefined;
        const qrText = state.url || (state.token ? `tg://login?token=${state.token}` : undefined);
        if (qrText) {
            try {
                qrDataUrl = await QRCode.toDataURL(qrText, {
                    errorCorrectionLevel: "M",
                    width: 320,
                    margin: 1,
                });
            } catch (err) {
                console.error("[GET /api/admin/telegram/qr/status] QR render failed", err);
            }
        }

        return NextResponse.json({
            success: true,
            status: state.status,
            token: state.token,
            qrDataUrl,
            lastError: state.lastError,
        });
    } catch (err: any) {
        console.error("[GET /api/admin/telegram/qr/status]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}