import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { telegramUserClientManager } from "@/features/telegram-signals/connectors/telegram-client-manager";
import type { TelegramSource } from "@/features/telegram-signals/types";

/**
 * Realtime Database rejects `undefined` values ("value argument contains undefined
 * in property ..."), so drop any undefined keys before writing.
 */
function stripUndefined<T extends object>(obj: T): T {
    return Object.fromEntries(
        Object.entries(obj).filter(([, value]) => value !== undefined)
    ) as T;
}

export async function GET(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const snap = await adminDatabase.ref("telegramSources").once("value");
        const sourcesObj = snap.exists() ? snap.val() : {};
        const sources: TelegramSource[] = Object.values(sourcesObj);

        return NextResponse.json({ success: true, sources });
    } catch (err: unknown) {
        console.error("[GET /api/admin/telegram/sources]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        // 1. Verify current Admin authorization
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const {
            channelId,
            name,
            username,
            type,
            membersCount,
            groupId,
            style,
            defaultTimeframe,
            autoExecution,
            notificationEnabled,
            parsingEnabled,
            riskRuleId,
            expirationMinutes,
        } = body;

        if (!channelId || !name) {
            return NextResponse.json({ error: "channelId and name are required" }, { status: 400 });
        }

        // 2 & 3 & 4. Verify Telegram connection and source accessibility
        const accessCheck = await telegramUserClientManager.validateChannelAccess(channelId);
        if (!accessCheck.accessible) {
            return NextResponse.json(
                { error: `Telegram account cannot access channel '${name}': ${accessCheck.error || "Access denied"}` },
                { status: 400 }
            );
        }

        const sourceId = `src_${channelId.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const now = Date.now();

        const sourceConfig: TelegramSource = {
            id: sourceId,
            name: name.trim(),
            channelId: String(channelId),
            username: username ? String(username) : undefined,
            type: type || "channel",
            membersCount: membersCount ? Number(membersCount) : undefined,
            enabled: true,
            parsingEnabled: parsingEnabled ?? true,
            groupId: groupId || "group_standard",
            connectionStatus: "connected",
            style: style || "INTRADAY",
            defaultTimeframe: defaultTimeframe || "H1",
            autoExecution: Boolean(autoExecution),
            notificationEnabled: notificationEnabled ?? true,
            riskRuleId: riskRuleId || undefined,
            expirationMinutes: expirationMinutes ? Number(expirationMinutes) : 240,
            signalCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        // 5. Store source configuration in RTDB
        await adminDatabase.ref(`telegramSources/${sourceId}`).set(stripUndefined(sourceConfig));

        // 6. Sync monitoring state
        await telegramUserClientManager.startMonitoring();

        await telegramUserClientManager.addLog(
            "info",
            `Admin configured & enabled source channel: ${name} (${channelId})`
        );

        return NextResponse.json({
            success: true,
            source: sourceConfig,
            message: `Source '${name}' successfully configured and monitored.`,
        });
    } catch (err: unknown) {
        console.error("[POST /api/admin/telegram/sources]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const { sourceId, ...updates } = body;

        if (!sourceId) {
            return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
        }

        const sourceRef = adminDatabase.ref(`telegramSources/${sourceId}`);
        const snap = await sourceRef.once("value");
        if (!snap.exists()) {
            return NextResponse.json({ error: "Source not found" }, { status: 404 });
        }

        const current = snap.val();
        const updatedSource: TelegramSource = {
            ...current,
            ...updates,
            updatedAt: Date.now(),
        };

        await sourceRef.set(updatedSource);

        return NextResponse.json({ success: true, source: updatedSource });
    } catch (err: unknown) {
        console.error("[PUT /api/admin/telegram/sources]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const sourceId = searchParams.get("sourceId");

        if (!sourceId) {
            return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
        }

        await adminDatabase.ref(`telegramSources/${sourceId}`).remove();

        return NextResponse.json({ success: true, message: "Source removed successfully" });
    } catch (err: unknown) {
        console.error("[DELETE /api/admin/telegram/sources]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
    }
}
