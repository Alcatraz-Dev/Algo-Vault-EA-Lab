import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { telegramUserClientManager } from "@/features/telegram-signals/connectors/telegram-client-manager";

/**
 * Dedicated monitoring control endpoint for the admin dashboard.
 *
 * GET  → returns runtime diagnostics (socket open? handler attached? watchdog tick?)
 * POST → idempotently (re)starts server-side channel monitoring. Unlike /test it does
 *        NOT run the full diagnostic suite (dialogs fetch + parser test), so it is
 *        fast enough to be called while polling and safe to call repeatedly.
 */
export async function GET(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        return NextResponse.json({
            success: true,
            runtime: telegramUserClientManager.getRuntimeDiagnostics(),
        });
    } catch (err: unknown) {
        console.error("[GET /api/admin/telegram/monitor]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        const result = await telegramUserClientManager.startMonitoring();

        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 502 });
        }

        return NextResponse.json({
            success: true,
            runtime: telegramUserClientManager.getRuntimeDiagnostics(),
        });
    } catch (err: unknown) {
        console.error("[POST /api/admin/telegram/monitor]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}
