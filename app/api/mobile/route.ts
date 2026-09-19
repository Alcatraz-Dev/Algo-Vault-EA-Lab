import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const [accountsSnap, alertsSnap] = await Promise.all([
            adminDatabase.ref(`trading_accounts/${user.uid}`).get(),
            adminDatabase.ref(`alerts/${user.uid}`).get(),
        ]);

        const accounts: Record<string, unknown>[] = [];
        if (accountsSnap.exists()) {
            const data = accountsSnap.val();
            for (const [id, val] of Object.entries(data)) {
                const acc = val as Record<string, unknown>;
                accounts.push({
                    id,
                    mt5Account: String(acc.mt5Account || ""),
                    broker: String(acc.broker || ""),
                    balance: Number(acc.balance || 0),
                    equity: Number(acc.equity || 0),
                    margin: Number(acc.margin || 0),
                    freeMargin: Number(acc.freeMargin || 0),
                    marginLevel: Number(acc.marginLevel || 0),
                    status: String(acc.status || ""),
                    lastHeartbeatAt: Number(acc.lastHeartbeatAt || 0),
                });
            }
        }

        let activeAlerts = 0;
        if (alertsSnap.exists()) {
            const alerts = alertsSnap.val();
            for (const [, alertData] of Object.entries(alerts)) {
                const a = alertData as Record<string, unknown>;
                if (!a.triggered) activeAlerts++;
            }
        }

        const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
        const totalEquity = accounts.reduce((sum, a) => sum + Number(a.equity || 0), 0);
        const floatingPnl = totalEquity - totalBalance;

        return NextResponse.json({
            success: true,
            mobile: {
                user: { uid: user.uid, name: user.name || user.email?.split("@")[0] },
                summary: {
                    totalBalance: Number(totalBalance.toFixed(2)),
                    totalEquity: Number(totalEquity.toFixed(2)),
                    floatingPnl: Number(floatingPnl.toFixed(2)),
                    accountCount: accounts.length,
                    onlineAccounts: accounts.filter((a) => a.status === "online").length,
                    activeAlerts,
                },
                accounts,
            },
        });
    } catch (err) {
        console.error("Mobile API error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
