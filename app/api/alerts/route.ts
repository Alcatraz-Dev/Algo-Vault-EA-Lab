import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { regimeBaseline } from "@/lib/cross-asset/alerts";
import { loadLatestSnapshot } from "@/lib/cross-asset/store";

type AlertType =
    | "price_above"
    | "price_below"
    | "structure_bos"
    | "structure_choch"
    | "zone_entry"
    | "volatility_high"
    | "session_start"
    /* Phase 16 §36 — cross-asset alert types (evaluated by /api/alerts/check) */
    | "correlation_above"
    | "correlation_below"
    | "relationship_flip"
    | "regime_change"
    | "volatility_expand"
    | "correlated_exposure";

type Alert = {
    id: string;
    symbol: string;
    type: AlertType;
    targetPrice?: number;
    /** Counterparty symbol for pair-based cross-asset alerts. */
    pair?: string;
    /** ρ threshold for correlation_above / correlation_below. */
    targetCorrelation?: number;
    /** Exposure threshold (0..1) for correlated_exposure. */
    targetExposure?: number;
    /** Baseline captured at creation for regime/volatility alerts. */
    baseline?: string;
    timeframe: string;
    message: string;
    notifyDiscord: boolean;
    notifyTelegram: boolean;
    notifyInApp: boolean;
    triggered: boolean;
    triggeredAt?: number;
    triggerReason?: string;
    createdAt: number;
    userId: string;
};

const CROSS_ASSET_TYPES = new Set<AlertType>([
    "correlation_above",
    "correlation_below",
    "relationship_flip",
    "regime_change",
    "volatility_expand",
    "correlated_exposure",
]);

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
        const { symbol, type, targetPrice, timeframe, message, notifyDiscord, notifyTelegram, notifyInApp, pair, targetCorrelation, targetExposure } = body;

        if (!symbol || !type) return NextResponse.json({ error: "symbol and type required" }, { status: 400 });

        /* Phase 16 §36: cross-asset alerts are validated up front so a broken
           threshold can never sit in the queue and silently never fire. */
        if (CROSS_ASSET_TYPES.has(type as AlertType)) {
            if ((type === "correlation_above" || type === "correlation_below" || type === "relationship_flip") && !pair) {
                return NextResponse.json({ error: "pair is required for pair-based cross-asset alerts" }, { status: 400 });
            }
            if (type === "correlation_above" || type === "correlation_below") {
                const rho = Number(targetCorrelation);
                if (!Number.isFinite(rho) || rho < -1 || rho > 1) {
                    return NextResponse.json({ error: "targetCorrelation must be a number in [-1, 1]" }, { status: 400 });
                }
            }
        }

        // Baselines come from the stored graph at creation time so later checks
        // compare against a REAL previous state, not against an empty string.
        let baseline: string | undefined;
        if (type === "regime_change" || type === "volatility_expand") {
            const snapshot = await loadLatestSnapshot("global").catch(() => null);
            baseline = type === "regime_change"
                ? regimeBaseline(snapshot)
                : String(snapshot?.regime?.states?.volatility ?? "");
        }

        const alertRef = adminDatabase.ref(`alerts/${user.uid}`).push();
        const alert: Omit<Alert, "id"> = {
            symbol: symbol.toUpperCase(),
            type,
            ...(targetPrice != null && targetPrice !== "" ? { targetPrice: Number(targetPrice) } : {}),
            ...(pair ? { pair: String(pair).toUpperCase() } : {}),
            ...(targetCorrelation != null ? { targetCorrelation: Number(targetCorrelation) } : {}),
            ...(targetExposure != null ? { targetExposure: Number(targetExposure) } : {}),
            ...(baseline !== undefined ? { baseline } : {}),
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
