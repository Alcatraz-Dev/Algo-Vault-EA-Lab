import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type Trade = {
    ticket: string; symbol: string; type: string; volume: number;
    openPrice: number; closePrice: number; profit: number; swap: number;
    commission: number; openTime: number; closeTime: number; broker: string;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const accountId = request.nextUrl.searchParams.get("accountId");
        const period = request.nextUrl.searchParams.get("period") || "30";

        if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

        const accountSnap = await adminDatabase.ref(`trading_accounts/${user.uid}/${accountId}`).get();
        if (!accountSnap.exists()) return NextResponse.json({ error: "Account not found" }, { status: 404 });

        const acc = accountSnap.val() as Record<string, unknown>;
        const balance = Number(acc.balance || 0);
        const equity = Number(acc.equity || 0);
        const broker = String(acc.broker || "");
        const mt5Account = String(acc.mt5Account || "");

        const daysAgo = Date.now() - Number(period) * 24 * 60 * 60 * 1000;
        const tradesSnap = await adminDatabase.ref(`trades/${user.uid}/${accountId}`).get();

        const trades: Trade[] = [];
        if (tradesSnap.exists()) {
            const data = tradesSnap.val();
            for (const [, tradeRaw] of Object.entries(data)) {
                const t = tradeRaw as Record<string, unknown>;
                const closeTime = Number(t.closeTime || 0);
                if (closeTime >= daysAgo) {
                    trades.push({
                        ticket: String(t.ticket || ""),
                        symbol: String(t.symbol || ""),
                        type: String(t.type || ""),
                        volume: Number(t.volume || 0),
                        openPrice: Number(t.openPrice || 0),
                        closePrice: Number(t.closePrice || 0),
                        profit: Number(t.profit || 0),
                        swap: Number(t.swap || 0),
                        commission: Number(t.commission || 0),
                        openTime: Number(t.openTime || 0),
                        closeTime: closeTime,
                        broker: String(t.broker || ""),
                    });
                }
            }
        }

        // Gateway trades are indexed under bot_trades/{botId}/{ticket}, not under
        // trades/{uid}/{accountId}. Resolve the user's bots via the index, filter
        // to the requested account, then pull trades from each matching bot.
        if (trades.length === 0) {
            const botIndexSnap = await adminDatabase.ref(`user_bots_index/${user.uid}`).get();
            if (botIndexSnap.exists()) {
                const botIndex = botIndexSnap.val() as Record<string, unknown>;
                for (const botId of Object.keys(botIndex)) {
                    const botSnap = await adminDatabase.ref(`user_bots/${botId}`).get();
                    if (!botSnap.exists()) continue;
                    const bot = botSnap.val() as Record<string, unknown>;
                    const botMt5Account = String(bot.mt5Account || "");
                    const botAccountId = `gateway_${botMt5Account}`;
                    if (botAccountId !== accountId) continue;

                    const botTradesSnap = await adminDatabase.ref(`bot_trades/${botId}`).get();
                    if (!botTradesSnap.exists()) continue;
                    const botTrades = botTradesSnap.val() as Record<string, unknown>;
                    for (const [, tradeRaw] of Object.entries(botTrades)) {
                        const t = tradeRaw as Record<string, unknown>;
                        const closeTime = Number(t.closedAt || t.closeTime || 0);
                        if (closeTime >= daysAgo) {
                            trades.push({
                                ticket: String(t.ticket || ""),
                                symbol: String(t.symbol || ""),
                                type: String(t.type || ""),
                                volume: Number(t.volume || 0),
                                openPrice: Number(t.openPrice || 0),
                                closePrice: Number(t.closePrice || 0),
                                profit: Number(t.profit || 0),
                                swap: Number(t.swap || 0),
                                commission: Number(t.commission || 0),
                                openTime: Number(t.openedAt || t.openTime || 0),
                                closeTime: closeTime,
                                broker: String(t.broker || acc.broker || ""),
                            });
                        }
                    }
                }
            }
        }

        trades.sort((a, b) => b.closeTime - a.closeTime);

        const wins = trades.filter((t) => t.profit > 0);
        const losses = trades.filter((t) => t.profit < 0);
        const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
        const totalSwap = trades.reduce((sum, t) => sum + t.swap, 0);
        const totalCommission = trades.reduce((sum, t) => sum + t.commission, 0);
        const netPnl = totalProfit + totalSwap + totalCommission;
        const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
        const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.profit, 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + t.profit, 0) / losses.length : 0;
        const profitFactor = Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : avgWin > 0 ? 999 : 0;

        // Daily equity curve
        const dailyPnl: Record<string, number> = {};
        for (const trade of trades) {
            const day = new Date(trade.closeTime).toISOString().split("T")[0];
            dailyPnl[day] = (dailyPnl[day] || 0) + trade.profit + trade.swap + trade.commission;
        }

        // Max drawdown
        let runningBalance = balance - netPnl;
        let peak = runningBalance;
        let maxDrawdown = 0;
        const equityCurve = Object.entries(dailyPnl).sort(([a], [b]) => a.localeCompare(b));
        for (const [, pnl] of equityCurve) {
            runningBalance += pnl;
            if (runningBalance > peak) peak = runningBalance;
            const dd = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0;
            if (dd > maxDrawdown) maxDrawdown = dd;
        }

        // By symbol
        const bySymbol: Record<string, { trades: number; profit: number; winRate: number }> = {};
        for (const trade of trades) {
            if (!bySymbol[trade.symbol]) bySymbol[trade.symbol] = { trades: 0, profit: 0, winRate: 0 };
            bySymbol[trade.symbol].trades++;
            bySymbol[trade.symbol].profit += trade.profit + trade.swap + trade.commission;
        }
        for (const sym of Object.keys(bySymbol)) {
            const symTrades = trades.filter((t) => t.symbol === sym);
            const symWins = symTrades.filter((t) => t.profit > 0);
            bySymbol[sym].winRate = symTrades.length > 0 ? (symWins.length / symTrades.length) * 100 : 0;
        }

        return NextResponse.json({
            success: true,
            statement: {
                account: { mt5Account, broker, balance: Number(balance.toFixed(2)), equity: Number(equity.toFixed(2)) },
                period: `${period} days`,
                summary: {
                    totalTrades: trades.length, wins: wins.length, losses: losses.length,
                    winRate: Number(winRate.toFixed(1)), totalProfit: Number(totalProfit.toFixed(2)),
                    totalSwap: Number(totalSwap.toFixed(2)), totalCommission: Number(totalCommission.toFixed(2)),
                    netPnl: Number(netPnl.toFixed(2)), avgWin: Number(avgWin.toFixed(2)),
                    avgLoss: Number(avgLoss.toFixed(2)), profitFactor: Number(profitFactor.toFixed(2)),
                    maxDrawdown: Number(maxDrawdown.toFixed(2)),
                },
                bySymbol: Object.entries(bySymbol).map(([symbol, data]) => ({
                    symbol, ...data, profit: Number(data.profit.toFixed(2)), winRate: Number(data.winRate.toFixed(1)),
                })).sort((a, b) => b.profit - a.profit),
                equityCurve,
                trades: trades.slice(0, 500),
            },
        });
    } catch (err) {
        console.error("Statement error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
