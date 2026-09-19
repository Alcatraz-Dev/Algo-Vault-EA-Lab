import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type AccountSummary = {
    accountId: string;
    mt5Account: string;
    broker: string;
    server: string;
    currency: string;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number;
    floatingPnl: number;
    drawdown: number;
    status: string;
    lastHeartbeatAt: number;
    positionsCount: number;
};

type PortfolioSummary = {
    totalBalance: number;
    totalEquity: number;
    totalMargin: number;
    totalFreeMargin: number;
    totalFloatingPnl: number;
    overallDrawdown: number;
    accountCount: number;
    onlineCount: number;
    accounts: AccountSummary[];
    exposure: {
        symbol: string;
        volume: number;
        type: string;
        pnl: number;
    }[];
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const accountsRef = adminDatabase.ref(`trading_accounts/${user.uid}`);
        const accountsSnapshot = await accountsRef.get();

        if (!accountsSnapshot.exists()) {
            return NextResponse.json({
                success: true,
                portfolio: {
                    totalBalance: 0, totalEquity: 0, totalMargin: 0, totalFreeMargin: 0,
                    totalFloatingPnl: 0, overallDrawdown: 0, accountCount: 0, onlineCount: 0,
                    accounts: [], exposure: [],
                },
            });
        }

        const accountsData = accountsSnapshot.val();
        const accounts: AccountSummary[] = [];
        const exposureMap: Record<string, { symbol: string; volume: number; type: string; pnl: number }> = {};

        let totalBalance = 0;
        let totalEquity = 0;
        let totalMargin = 0;
        let totalFreeMargin = 0;
        let onlineCount = 0;

        for (const [key, val] of Object.entries(accountsData)) {
            const acc = val as Record<string, unknown>;
            const balance = Number(acc.balance || 0);
            const equity = Number(acc.equity || 0);
            const margin = Number(acc.margin || 0);
            const freeMargin = Number(acc.freeMargin || 0);
            const floatingPnl = equity - balance;
            const drawdown = Number(acc.balance || 0) > 0 ? ((Number(acc.balance || 0) - equity) / Number(acc.balance || 0)) * 100 : 0;

            totalBalance += balance;
            totalEquity += equity;
            totalMargin += margin;
            totalFreeMargin += freeMargin;

            const isOnline = acc.status === "connected" && acc.lastHeartbeatAt && (Date.now() - Number(acc.lastHeartbeatAt)) < 120000;
            if (isOnline) onlineCount++;

            accounts.push({
                accountId: key,
                mt5Account: String(acc.mt5Account || ""),
                broker: String(acc.broker || ""),
                server: String(acc.server || ""),
                currency: String(acc.currency || "USD"),
                balance, equity, margin, freeMargin,
                marginLevel: Number(acc.marginLevel || 0),
                floatingPnl: Number(floatingPnl.toFixed(2)),
                drawdown: Number(drawdown.toFixed(2)),
                status: String(acc.status || "offline"),
                lastHeartbeatAt: Number(acc.lastHeartbeatAt || 0),
                positionsCount: Number(acc.positionsCount || 0),
            });

            const positionsRef = adminDatabase.ref(`trading_positions/${user.uid}/${key}`);
            const posSnapshot = await positionsRef.get();
            if (posSnapshot.exists()) {
                const positions = posSnapshot.val();
                for (const [, pos] of Object.entries(positions)) {
                    const p = pos as Record<string, unknown>;
                    const symbol = String(p.symbol || "");
                    const type = String(p.type || "");
                    const volume = Number(p.volume || 0);
                    const profit = Number(p.profit || 0);

                    const key = `${symbol}_${type}`;
                    if (!exposureMap[key]) {
                        exposureMap[key] = { symbol, volume: 0, type, pnl: 0 };
                    }
                    exposureMap[key].volume += volume;
                    exposureMap[key].pnl += profit;
                }
            }
        }

        const overallDrawdown = totalBalance > 0 ? ((totalBalance - totalEquity) / totalBalance) * 100 : 0;

        return NextResponse.json({
            success: true,
            portfolio: {
                totalBalance: Number(totalBalance.toFixed(2)),
                totalEquity: Number(totalEquity.toFixed(2)),
                totalMargin: Number(totalMargin.toFixed(2)),
                totalFreeMargin: Number(totalFreeMargin.toFixed(2)),
                totalFloatingPnl: Number((totalEquity - totalBalance).toFixed(2)),
                overallDrawdown: Number(overallDrawdown.toFixed(2)),
                accountCount: accounts.length,
                onlineCount,
                accounts,
                exposure: Object.values(exposureMap).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
            },
        });
    } catch (err) {
        console.error("Portfolio API error:", err);
        return NextResponse.json({ error: "Failed to fetch portfolio" }, { status: 500 });
    }
}
