import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type HistoryEntry = {
    id: string;
    source: "manual" | "tool";
    symbol: string;
    type: string;
    targetPrice: number | null;
    timeframe: string;
    message: string;
    triggered: boolean;
    triggeredAt: number | null;
    triggeredPrice: number | null;
    createdAt: number;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const [alertsSnap, pineSnap] = await Promise.all([
            adminDatabase.ref(`alerts/${user.uid}`).get(),
            adminDatabase.ref(`pineAlertHistory/${user.uid}`).get(),
        ]);

        const history: HistoryEntry[] = [];

        if (alertsSnap.exists()) {
            for (const [id, alertRaw] of Object.entries(alertsSnap.val())) {
                const a = alertRaw as Record<string, unknown>;
                history.push({
                    id,
                    source: "manual",
                    symbol: String(a.symbol || ""),
                    type: String(a.type || ""),
                    targetPrice: a.targetPrice ? Number(a.targetPrice) : null,
                    timeframe: String(a.timeframe || ""),
                    message: String(a.message || ""),
                    triggered: Boolean(a.triggered),
                    triggeredAt: a.triggeredAt ? Number(a.triggeredAt) : null,
                    triggeredPrice: a.triggeredPrice ? Number(a.triggeredPrice) : null,
                    createdAt: Number(a.createdAt || 0),
                });
            }
        }

        if (pineSnap.exists()) {
            for (const [id, alertRaw] of Object.entries(pineSnap.val())) {
                const a = alertRaw as Record<string, unknown>;
                const timestamp = Number(a.timestamp || 0);
                history.push({
                    id,
                    source: "tool",
                    symbol: String(a.symbol || "").replace(/^(FX:|XAU:|XAG:|INDEX:)/, ""),
                    type: String(a.signal || "tool_alert"),
                    targetPrice: null,
                    timeframe: String(a.timeframe || ""),
                    message: String(a.message || ""),
                    triggered: true,
                    triggeredAt: timestamp || null,
                    triggeredPrice: a.price ? Number(a.price) : null,
                    createdAt: timestamp,
                });
            }
        }

        const triggered = history.filter((a) => a.triggered);
        const active = history.filter((a) => !a.triggered);

        return NextResponse.json({
            success: true,
            history: history.sort((a, b) => (b.triggeredAt || b.createdAt) - (a.triggeredAt || a.createdAt)),
            stats: { total: history.length, triggered: triggered.length, active: active.length },
        });
    } catch (err) {
        console.error("Alert history error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
