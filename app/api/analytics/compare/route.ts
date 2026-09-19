import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type AccountSnapshot = {
    accountId: string;
    mt5Account: string;
    broker: string;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number;
    drawdown: number;
    floatingPnl: number;
    positionsCount: number;
    buyVolume: number;
    sellVolume: number;
    netExposure: number;
    winCount: number;
    lossCount: number;
    totalTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    expectancy: number;
    sharpeRatio: number;
    online: boolean;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const accountsRef = adminDatabase.ref(`trading_accounts/${user.uid}`);
        const accountsSnap = await accountsRef.get();
        if (!accountsSnap.exists()) return NextResponse.json({ success: true, accounts: [], comparison: null });

        const accountsData = accountsSnap.val();
        const snapshots: AccountSnapshot[] = [];

        for (const [accountId, accRaw] of Object.entries(accountsData)) {
            const acc = accRaw as Record<string, unknown>;
            const balance = Number(acc.balance || 0);
            const equity = Number(acc.equity || 0);
            const margin = Number(acc.margin || 0);
            const freeMargin = Number(acc.freeMargin || 0);
            const marginLevel = Number(acc.marginLevel || 0);
            const drawdown = balance > 0 ? ((balance - equity) / balance) * 100 : 0;
            const floatingPnl = equity - balance;
            const lastHeartbeat = Number(acc.lastHeartbeatAt || 0);
            const online = acc.status === "online" || (lastHeartbeat > 0 && Date.now() - lastHeartbeat < 300000);

            let buyVolume = 0, sellVolume = 0, positionsCount = 0;
            let winCount = 0, lossCount = 0, totalTrades = 0;
            let totalWinAmount = 0, totalLossAmount = 0;

            const posSnap = await adminDatabase.ref(`trading_positions/${user.uid}/${accountId}`).get();
            if (posSnap.exists()) {
                const positions = posSnap.val();
                for (const [, pos] of Object.entries(positions)) {
                    const p = pos as Record<string, unknown>;
                    const type = String(p.type || "");
                    const volume = Number(p.volume || 0);
                    const profit = Number(p.profit || 0);
                    positionsCount++;
                    if (type === "BUY") buyVolume += volume; else sellVolume += volume;
                }
            }

            const tradesSnap = await adminDatabase.ref(`trades/${user.uid}/${accountId}`).get();
            if (tradesSnap.exists()) {
                const trades = tradesSnap.val();
                for (const [, trade] of Object.entries(trades)) {
                    const t = trade as Record<string, unknown>;
                    const profit = Number(t.profit || 0);
                    totalTrades++;
                    if (profit > 0) { winCount++; totalWinAmount += profit; }
                    else if (profit < 0) { lossCount++; totalLossAmount += Math.abs(profit); }
                }
            }

            const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
            const avgWin = winCount > 0 ? totalWinAmount / winCount : 0;
            const avgLoss = lossCount > 0 ? totalLossAmount / lossCount : 0;
            const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? 999 : 0;
            const expectancy = totalTrades > 0 ? ((winCount * avgWin) - (lossCount * avgLoss)) / totalTrades : 0;

            snapshots.push({
                accountId, mt5Account: String(acc.mt5Account || ""), broker: String(acc.broker || ""),
                balance, equity, margin, freeMargin, marginLevel, drawdown, floatingPnl, positionsCount,
                buyVolume, sellVolume, netExposure: Math.abs(buyVolume - sellVolume),
                winCount, lossCount, totalTrades, winRate: Number(winRate.toFixed(1)),
                avgWin: Number(avgWin.toFixed(2)), avgLoss: Number(avgLoss.toFixed(2)),
                profitFactor: Number(profitFactor.toFixed(2)), expectancy: Number(expectancy.toFixed(2)),
                sharpeRatio: 0, online,
            });
        }

        const bestPerformer = snapshots.reduce((best, s) => s.profitFactor > best.profitFactor ? s : best, snapshots[0]);
        const worstPerformer = snapshots.reduce((worst, s) => s.profitFactor < worst.profitFactor ? s : worst, snapshots[0]);
        const totalBalance = snapshots.reduce((sum, s) => sum + s.balance, 0);
        const totalEquity = snapshots.reduce((sum, s) => sum + s.equity, 0);
        const totalTrades = snapshots.reduce((sum, s) => sum + s.totalTrades, 0);
        const avgWinRate = snapshots.reduce((sum, s) => sum + s.winRate, 0) / (snapshots.length || 1);

        return NextResponse.json({
            success: true,
            accounts: snapshots,
            comparison: {
                totalAccounts: snapshots.length,
                onlineAccounts: snapshots.filter((s) => s.online).length,
                totalBalance: Number(totalBalance.toFixed(2)),
                totalEquity: Number(totalEquity.toFixed(2)),
                totalTrades,
                avgWinRate: Number(avgWinRate.toFixed(1)),
                bestPerformer: { broker: bestPerformer?.broker, profitFactor: bestPerformer?.profitFactor },
                worstPerformer: { broker: worstPerformer?.broker, profitFactor: worstPerformer?.profitFactor },
            },
        });
    } catch (err) {
        console.error("Compare API error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
