import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { telegramUserClientManager } from "@/features/telegram-signals/connectors/telegram-client-manager";

/**
 * Self-heal trigger: when an admin opens the dashboard while monitoring is paused
 * (e.g. right after a server restart), kick off a background restart instead of
 * making the status request wait on the MTProto connection handshake.
 */
function kickStartMonitoring(): void {
    void telegramUserClientManager
        .startMonitoring()
        .catch((err: unknown) => {
            console.error("[GET /api/admin/telegram/status] background monitoring restart failed", err);
        });
}

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
        const runtime = telegramUserClientManager.getRuntimeDiagnostics();

        // Self-heal: if the account is connected but the listener is down, restore it
        // in the background without blocking this response.
        if (status.connected && !runtime.isMonitoringActive) {
            kickStartMonitoring();
        }

        return NextResponse.json({ success: true, status, runtime });
    } catch (err: unknown) {
        console.error("[GET /api/admin/telegram/status]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}
