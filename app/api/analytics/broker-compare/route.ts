import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type BrokerProfile = {
    broker: string;
    totalBalance: number;
    totalEquity: number;
    avgSpread: number;
    avgSpreadCost: number;
    totalSwaps: number;
    totalSwapCost: number;
    totalCost: number;
    totalPnl: number;
    netPnl: number;
    positionsCount: number;
    avgPositionDuration: number;
    symbols: { symbol: string; avgSpread: number; avgSwapLong: number; avgSwapShort: number; positions: number }[];
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const accountsSnap = await adminDatabase.ref(`trading_accounts/${user.uid}`).get();
        if (!accountsSnap.exists()) return NextResponse.json({ success: true, brokers: [], totalCost: 0 });

        const accountsData = accountsSnap.val();
        const brokerMap = new Map<string, BrokerProfile>();

        for (const [, accRaw] of Object.entries(accountsData)) {
            const acc = accRaw as Record<string, unknown>;
            const broker = String(acc.broker || "Unknown");
            const balance = Number(acc.balance || 0);
            const equity = Number(acc.equity || 0);

            if (!brokerMap.has(broker)) {
                brokerMap.set(broker, {
                    broker, totalBalance: balance, totalEquity: equity,
                    avgSpread: 0, avgSpreadCost: 0, totalSwaps: 0, totalSwapCost: 0,
                    totalCost: 0, totalPnl: 0, netPnl: 0, positionsCount: 0, avgPositionDuration: 0, symbols: [],
                });
            } else {
                const bp = brokerMap.get(broker)!;
                bp.totalBalance += balance;
                bp.totalEquity += equity;
            }
        }

        const tradesSnap = await adminDatabase.ref(`trades/${user.uid}`).get();
        if (tradesSnap.exists()) {
            const allTrades = tradesSnap.val();
            for (const [, userTrades] of Object.entries(allTrades)) {
                const trades = userTrades as Record<string, Record<string, unknown>>;
                for (const [, tradeRaw] of Object.entries(trades)) {
                    const t = tradeRaw as Record<string, unknown>;
                    const broker = String(t.broker || "Unknown");
                    const symbol = String(t.symbol || "");
                    const profit = Number(t.profit || 0);
                    const swap = Number(t.swap || 0);
                    const commission = Number(t.commission || 0);
                    const volume = Number(t.volume || 1);
                    const openTime = Number(t.openTime || 0);
                    const closeTime = Number(t.closeTime || 0);

                    if (!brokerMap.has(broker)) continue;
                    const bp = brokerMap.get(broker)!;
                    bp.totalPnl += profit;
                    bp.totalSwaps += swap;
                    bp.totalSwapCost += Math.abs(swap);
                    bp.totalCost += Math.abs(commission);

                    let symbolEntry = bp.symbols.find((s) => s.symbol === symbol);
                    if (!symbolEntry) {
                        symbolEntry = { symbol, avgSpread: 0, avgSwapLong: 0, avgSwapShort: 0, positions: 0 };
                        bp.symbols.push(symbolEntry);
                    }
                    symbolEntry.positions++;
                }
            }
        }

        const brokers = Array.from(brokerMap.values()).map((bp) => {
            bp.netPnl = Number((bp.totalPnl - bp.totalSwapCost - bp.totalCost).toFixed(2));
            bp.symbols.sort((a, b) => b.positions - a.positions);
            return bp;
        });

        const totalCost = brokers.reduce((sum, b) => sum + b.totalSwapCost + b.totalCost, 0);

        return NextResponse.json({ success: true, brokers, totalCost: Number(totalCost.toFixed(2)) });
    } catch (err) {
        console.error("Broker compare error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
