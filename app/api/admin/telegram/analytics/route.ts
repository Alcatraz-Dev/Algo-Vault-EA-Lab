import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
    collectSignals,
    computeSignalAnalytics,
    sourceMatchesSignal,
} from "@/features/telegram-signals/analytics/signal-analytics";
import type { TelegramSource } from "@/features/telegram-signals/types";

type SourceRecord = Partial<TelegramSource> & {
    id?: string;
    channelId?: string | number;
    lastReceivedAt?: number;
};

export async function GET(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        const [sourcesSnap, signalsSnap] = await Promise.all([
            adminDatabase.ref("telegramSources").once("value"),
            adminDatabase.ref("telegramSignals").once("value"),
        ]);

        const sourceEntries = Object.entries(
            (sourcesSnap.val() ?? {}) as Record<string, SourceRecord | null>
        ).filter((entry): entry is [string, SourceRecord] => Boolean(entry[1]));
        const recordedSignals = collectSignals(signalsSnap.val());

        const analytics = sourceEntries.map(([sourceKey, source]) => {
            const sourceId = source.id || sourceKey;
            const channelId = source.channelId !== undefined ? String(source.channelId) : "";
            const sourceSignals = recordedSignals.filter((signal) =>
                sourceMatchesSignal(signal, sourceId, sourceKey, channelId)
            );
            const segment = computeSignalAnalytics(sourceSignals);
            const lastSignalAt = sourceSignals.reduce(
                (latest, signal) => Math.max(latest, signal.receivedAt),
                0
            );
            const lastReceivedAt = Math.max(source.lastReceivedAt ?? 0, lastSignalAt) || null;

            return {
                sourceId,
                channelName: source.name || "Unnamed channel",
                groupId: source.groupId,
                status: source.enabled ? "Active" : "Paused",
                totalSignals: segment.totalSignals,
                wins: segment.wins,
                losses: segment.losses,
                expired: segment.expired,
                cancelled: segment.cancelled,
                winRate: segment.winRate,
                lastReceivedAt,
                lastMessageAt: lastReceivedAt,
            };
        });

        return NextResponse.json({
            success: true,
            analytics,
            calculatedAt: Date.now(),
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Internal server error";
        console.error("[GET /api/admin/telegram/analytics]", err);
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
