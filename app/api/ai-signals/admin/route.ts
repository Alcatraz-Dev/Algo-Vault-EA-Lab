import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { SignalConfig } from "@/lib/ai-signals/types";

export async function GET(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const snap = await adminDatabase.ref("signalConfig/default").get();
        const config = snap.exists() ? snap.val() : null;

        return NextResponse.json({ success: true, config });
    } catch (err) {
        console.error("AI Signals Admin GET error:", err);
        return NextResponse.json({ error: "Failed to load config" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const updates: Partial<SignalConfig> = {};

        const allowedFields: (keyof SignalConfig)[] = [
            "name",
            "enabled",
            "symbols",
            "timeframes",
            "freeTimeframes",
            "proTimeframes",
            "categories",
            "minimumConfidence",
            "minimumRiskReward",
            "minimumStrength",
            "signalCooldownMinutes",
            "signalExpirationHours",
            "sessions",
            "weights",
            "riskDefaults",
            "freeSignalsPerDay",
            "proSignalsPerDay",
            "engineVersion",
            "strategyVersion",
            "analysisVersion",
        ];

        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                (updates as Record<string, unknown>)[field] = body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
        }

        updates.updatedAt = Date.now();
        updates.updatedBy = admin.uid;

        await adminDatabase.ref("signalConfig/default").update(updates);

        const snap = await adminDatabase.ref("signalConfig/default").get();
        const config = snap.val() as SignalConfig;

        return NextResponse.json({ success: true, config });
    } catch (err) {
        console.error("AI Signals Admin PUT error:", err);
        return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
    }
}
