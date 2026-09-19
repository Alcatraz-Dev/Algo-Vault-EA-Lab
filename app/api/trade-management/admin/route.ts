import { NextRequest, NextResponse } from "next/server";
import { authenticate, requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { TradeManagementDefaults } from "@/lib/trade-management/types";

const DEFAULTS: TradeManagementDefaults = {
    tpManagement: {
        enabled: true,
        tp1ClosePercent: 30,
        tp2ClosePercent: 30,
        tp3ClosePercent: 30,
        runnerPercent: 10,
    },
    breakEven: {
        enabled: true,
        trigger: "TP1",
        offset: 0,
    },
    profitLock: {
        enabled: true,
        trigger: "TP2",
        lockR: 1,
    },
    runner: {
        enabled: true,
        trailingType: "fixed",
        trailingDistance: 50,
    },
    approachingAlerts: {
        enabled: true,
        distanceThreshold: 5,
        cooldownMs: 300000,
    },
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const snap = await adminDatabase.ref("settings/tradeManagementDefaults").get();
        const defaults = snap.exists() ? { ...DEFAULTS, ...snap.val() } : DEFAULTS;

        return NextResponse.json({ success: true, defaults });
    } catch (err) {
        console.error("Admin trade defaults GET error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return NextResponse.json({ error: "Admin required" }, { status: 403 });

        const body = await request.json();
        const { defaults } = body as { defaults: Partial<TradeManagementDefaults> };

        if (!defaults) return NextResponse.json({ error: "defaults required" }, { status: 400 });

        // Validate percentages
        const tp = defaults.tpManagement;
        if (tp) {
            const total = (tp.tp1ClosePercent || 0) + (tp.tp2ClosePercent || 0) + (tp.tp3ClosePercent || 0) + (tp.runnerPercent || 0);
            if (total > 100) {
                return NextResponse.json({ error: `TP percentages sum to ${total}%` }, { status: 400 });
            }
        }

        await adminDatabase.ref("settings/tradeManagementDefaults").update(defaults);

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Admin trade defaults PUT error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
