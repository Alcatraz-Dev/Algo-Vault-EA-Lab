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

        const result = await telegramUserClientManager.runConnectionTest();

        // Also ensure monitoring is started
        await telegramUserClientManager.startMonitoring();

        return NextResponse.json({
            success: true,
            testResult: result,
        });
    } catch (err: any) {
        console.error("[POST /api/admin/telegram/test]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
