import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import {
    evaluateCrossAssetAlert,
    type CrossAssetAlert,
} from "@/lib/cross-asset/alerts";
import { loadLatestSnapshot } from "@/lib/cross-asset/store";
import type { MarketGraphSnapshot } from "@/lib/cross-asset/types";

/** Phase 16 §36 — alert types evaluated against the stored market graph. */
const CROSS_ASSET_TYPES = new Set([
    "correlation_above",
    "correlation_below",
    "relationship_flip",
    "regime_change",
    "volatility_expand",
    "correlated_exposure",
]);

type Alert = {
    id: string;
    symbol: string;
    type: string;
    targetPrice?: number;
    timeframe: string;
    message: string;
    notifyDiscord: boolean;
    notifyTelegram: boolean;
    notifyInApp: boolean;
    triggered: boolean;
    createdAt: number;
    userId: string;
};

export async function GET(request: NextRequest) {
    try {
        // Fail-closed cron auth: requires x-cron-secret (or ?secret=) matching
        // CRON_SECRET, or Vercel's cron runner UA. Refuses when CRON_SECRET is unset.
        const secret = process.env.CRON_SECRET;
        const headerSecret = request.headers.get("x-cron-secret") || "";
        const querySecret = new URL(request.url).searchParams.get("secret") || "";
        const isVercelCron = (request.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron");
        if (!isVercelCron && !Boolean(secret && (headerSecret === secret || querySecret === secret))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const alertsRef = adminDatabase.ref("alerts");
        const snapshot = await alertsRef.get();

        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, checked: 0, triggered: 0 });
        }

        const allAlerts = snapshot.val();
        let checked = 0;
        let triggered = 0;

        // Phase 16 §36: the stored graph is read AT MOST once per check run and
        // only when a cross-asset alert exists. No graph → those alerts stay
        // silent with a recorded reason instead of firing on absent data (§45).
        let graphSnapshot: MarketGraphSnapshot | null | undefined;
        const alertEntries: Array<[string, string, Alert]> = [];
        for (const [userId, userAlerts] of Object.entries(allAlerts)) {
            for (const [alertId, alertData] of Object.entries(userAlerts as Record<string, Alert>)) {
                alertEntries.push([userId, alertId, alertData]);
            }
        }
        const needsGraph = alertEntries.some(([, , a]) => !a.triggered && CROSS_ASSET_TYPES.has(a.type));
        if (needsGraph) {
            graphSnapshot = await loadLatestSnapshot("global").catch(() => null);
        }

        for (const [userId, alertId, alert] of alertEntries) {
                if (alert.triggered) continue;

                checked++;

                try {
                    if (CROSS_ASSET_TYPES.has(alert.type)) {
                        const evaluation = evaluateCrossAssetAlert(
                            alert as unknown as CrossAssetAlert,
                            graphSnapshot ?? null,
                            Date.now()
                        );
                        if (!evaluation.triggered) continue;

                        await adminDatabase.ref(`alerts/${userId}/${alertId}`).update({
                            triggered: true,
                            triggeredAt: Date.now(),
                            triggerReason: evaluation.reason,
                        });
                        await adminDatabase.ref(`notifications/${userId}`).push({
                            title: `Cross-asset alert: ${alert.symbol}`,
                            message: evaluation.message ?? alert.message,
                            level: "info",
                            link: "/cross-asset",
                            read: false,
                            createdAt: Date.now(),
                        });
                        triggered++;
                        continue;
                    }

                    const priceRes = await fetch(`https://biquote.io/api/${alert.symbol}/ohlc?interval=1h&limit=2`);
                    if (!priceRes.ok) continue;

                    const priceData = await priceRes.json();
                    const bars: Array<{ openTime: string; close: number | string; open?: number | string; high?: number | string; low?: number | string }> = priceData.bars || [];
                    if (bars.length === 0) continue;

                    const sorted = bars.sort((a, b) => Date.parse(a.openTime) - Date.parse(b.openTime));
                    const lastBar = sorted[sorted.length - 1];
                    const currentPrice = Number(lastBar.close);

                    let shouldTrigger = false;

                    if (alert.type === "price_above" && alert.targetPrice && currentPrice >= alert.targetPrice) {
                        shouldTrigger = true;
                    } else if (alert.type === "price_below" && alert.targetPrice && currentPrice <= alert.targetPrice) {
                        shouldTrigger = true;
                    }

                    if (shouldTrigger) {
                        await adminDatabase.ref(`alerts/${userId}/${alertId}`).update({
                            triggered: true,
                            triggeredAt: Date.now(),
                            triggeredPrice: currentPrice,
                        });

                        await adminDatabase.ref(`notifications/${userId}`).push({
                            title: `Alert: ${alert.symbol}`,
                            message: `${alert.type.replace(/_/g, " ")} — ${alert.symbol} at ${currentPrice}${alert.targetPrice ? ` (target: ${alert.targetPrice})` : ""}`,
                            level: "info",
                            link: "/alerts",
                            read: false,
                            createdAt: Date.now(),
                        });

                        triggered++;
                    }
                } catch {}
        }

        return NextResponse.json({ success: true, checked, triggered, timestamp: Date.now() });
    } catch (err) {
        console.error("Alert checker error:", err);
        return NextResponse.json({ error: "Failed to check alerts" }, { status: 500 });
    }
}
