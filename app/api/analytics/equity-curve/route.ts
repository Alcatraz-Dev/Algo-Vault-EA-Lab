import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // The AlgoVaultGateway EA writes live account snapshots to
        // `trading_accounts/{userId}/{accountId}` (e.g. gateway_123456) with
        // balance, equity, and lastHeartbeatAt on every heartbeat.
        // The old `users/{uid}/mt5Accounts` path was never populated by the
        // gateway — switch to the canonical path so connected accounts show up.
        const accountsRef = adminDatabase.ref(`trading_accounts/${user.uid}`);
        const snapshot = await accountsRef.get();

        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, curves: [], stats: { total: 0 } });
        }

        const data = snapshot.val() as Record<string, Record<string, unknown>>;
        const curves: { accountId: string; accountName: string; data: { time: number; equity: number; balance: number }[] }[] = [];

        for (const [id, acc] of Object.entries(data)) {
            if (!acc || typeof acc !== "object") continue;

            const name = String(acc.accountName || acc.mt5Account || acc.broker || id);
            const equity = Number(acc.equity || 0);
            const balance = Number(acc.balance || 0);
            const lastHeartbeat = Number(acc.lastHeartbeatAt || acc.updatedAt || 0);

            // If the account has an explicit equityHistory sub-node (from other
            // sources), use it; otherwise synthesize a single point from the
            // latest heartbeat so the chart has a starting point.
            const equityHistory = acc.equityHistory as
                | Record<string, { equity: number; balance: number; timestamp: number }>
                | undefined;

            let points: { time: number; equity: number; balance: number }[];

            if (equityHistory && Object.keys(equityHistory).length > 0) {
                points = Object.values(equityHistory)
                    .map((p) => ({
                        time: p.timestamp,
                        equity: p.equity,
                        balance: p.balance,
                    }))
                    .sort((a, b) => a.time - b.time)
                    .slice(-300);
            } else {
                // Derive a point from the current account snapshot so live
                // gateway accounts always show at least one equity point.
                points =
                    lastHeartbeat > 0
                        ? [{ time: lastHeartbeat, equity, balance }]
                        : [];
            }

            if (points.length > 0) {
                curves.push({ accountId: id, accountName: name, data: points });
            }
        }

        // Sort curves by most recently updated first
        curves.sort((a, b) => {
            const ta = a.data[a.data.length - 1]?.time || 0;
            const tb = b.data[b.data.length - 1]?.time || 0;
            return tb - ta;
        });

        const total = curves.length;
        return NextResponse.json({ success: true, curves, stats: { total } });
    } catch (err) {
        console.error("Equity curve error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
