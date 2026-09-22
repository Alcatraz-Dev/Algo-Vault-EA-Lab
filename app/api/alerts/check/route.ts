import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";

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

        for (const [userId, userAlerts] of Object.entries(allAlerts)) {
            for (const [alertId, alertData] of Object.entries(userAlerts as Record<string, Alert>)) {
                const alert = alertData;
                if (alert.triggered) continue;

                checked++;

                try {
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
        }

        return NextResponse.json({ success: true, checked, triggered, timestamp: Date.now() });
    } catch (err) {
        console.error("Alert checker error:", err);
        return NextResponse.json({ error: "Failed to check alerts" }, { status: 500 });
    }
}
