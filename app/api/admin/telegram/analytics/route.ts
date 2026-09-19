import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json(
                { error: "Unauthorized. Admin access required." },
                { status: 403 }
            );
        }

        const sourcesSnap = await adminDatabase.ref("telegramSources").once("value");
        const signalsSnap = await adminDatabase.ref("telegramSignals/system").once("value");

        const sources = sourcesSnap.exists() ? Object.values(sourcesSnap.val()) : [];
        const signals = signalsSnap.exists() ? Object.values(signalsSnap.val()) : [];

        const channelStats = (sources as any[]).map((src) => {
            const srcSignals = (signals as any[]).filter(
                (s) => s.sourceMetadata?.sourceId === src.id || s.sourceMetadata?.channelId === src.channelId
            );

            const total = srcSignals.length;
            const wins = srcSignals.filter((s) => ["TP1_HIT", "TP2_HIT", "TP3_HIT", "TP4_HIT", "TP5_OPEN_RUNNER"].includes(s.status)).length;
            const losses = srcSignals.filter((s) => s.status === "STOPPED").length;
            const expired = srcSignals.filter((s) => s.status === "EXPIRED").length;
            const winRate = total > 0 ? Math.round((wins / (wins + losses || 1)) * 100) : 0;

            return {
                sourceId: src.id,
                channelName: src.name,
                groupId: src.groupId,
                status: src.enabled ? "Active" : "Paused",
                totalSignals: total,
                wins,
                losses,
                expired,
                winRate,
                lastReceivedAt: src.lastReceivedAt || null,
            };
        });

        return NextResponse.json({
            success: true,
            analytics: channelStats,
        });
    } catch (err: any) {
        console.error("[GET /api/admin/telegram/analytics]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
