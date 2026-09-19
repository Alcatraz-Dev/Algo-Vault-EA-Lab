import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type AlertType = "price_above" | "price_below" | "structure_bos" | "structure_choch" | "zone_entry" | "volatility_high" | "session_start";

type Alert = {
    id: string;
    symbol: string;
    type: AlertType;
    targetPrice?: number;
    timeframe: string;
    message: string;
    notifyDiscord: boolean;
    notifyTelegram: boolean;
    notifyInApp: boolean;
    triggered: boolean;
    triggeredAt?: number;
    createdAt: number;
    userId: string;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const alertsRef = adminDatabase.ref(`alerts/${user.uid}`);
        const snapshot = await alertsRef.get();

        if (!snapshot.exists()) return NextResponse.json({ success: true, alerts: [] });

        const data = snapshot.val();
        const alerts = Object.entries(data).map(([id, val]) => ({ id, ...(val as Omit<Alert, "id">) }));

        return NextResponse.json({ success: true, alerts: alerts.sort((a, b) => b.createdAt - a.createdAt) });
    } catch (err) {
        console.error("Alerts GET error:", err);
        return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { symbol, type, targetPrice, timeframe, message, notifyDiscord, notifyTelegram, notifyInApp } = body;

        if (!symbol || !type) return NextResponse.json({ error: "symbol and type required" }, { status: 400 });

        const alertRef = adminDatabase.ref(`alerts/${user.uid}`).push();
        const alert: Omit<Alert, "id"> = {
            symbol: symbol.toUpperCase(),
            type,
            targetPrice: targetPrice ? Number(targetPrice) : undefined,
            timeframe: timeframe || "H1",
            message: message || `${type} alert for ${symbol}`,
            notifyDiscord: notifyDiscord !== false,
            notifyTelegram: notifyTelegram !== false,
            notifyInApp: notifyInApp !== false,
            triggered: false,
            createdAt: Date.now(),
            userId: user.uid,
        };

        await alertRef.set(alert);

        return NextResponse.json({ success: true, alert: { id: alertRef.key, ...alert } });
    } catch (err) {
        console.error("Alerts POST error:", err);
        return NextResponse.json({ error: "Failed to create alert" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { alertId } = await request.json();
        if (!alertId) return NextResponse.json({ error: "alertId required" }, { status: 400 });

        await adminDatabase.ref(`alerts/${user.uid}/${alertId}`).remove();

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Alerts DELETE error:", err);
        return NextResponse.json({ error: "Failed to delete alert" }, { status: 500 });
    }
}
