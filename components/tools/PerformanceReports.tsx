"use client";

import { useMemo } from "react";
import { Download, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { useUserTradingData } from "@/components/tools/user-data";

export default function PerformanceReports({ userId }: { userId: string }) {
    const { accounts, trades, equitySeries, loading, error } = useUserTradingData(userId);

    const stats = useMemo(() => {
        const closed = trades.filter((t) => !t.closedAt && t.profit != null || t.closedAt);
        // Only truly closed trades (have closedAt) for realized stats
        const fullyClosed = trades.filter((t) => t.closedAt);
        const total = fullyClosed.length;
        const wins = fullyClosed.filter((t) => Number(t.profit ?? 0) > 0);
        const losses = fullyClosed.filter((t) => Number(t.profit ?? 0) < 0);
        const grossProfit = wins.reduce((sum, t) => sum + Number(t.profit ?? 0), 0);
        const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Number(t.profit ?? 0), 0));
        const net = fullyClosed.reduce((sum, t) => sum + Number(t.profit ?? 0), 0);
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
        const maxDrawdown = Math.max(0, ...accounts.map((a) => Number(a.drawdown ?? 0)));
        const avgTrade = total ? net / total : 0;

        /*
         * Compute daily P&L for best/worst day
         */
        const dailyPnL = new Map<string, number>();
        fullyClosed.forEach((t) => {
            if (!t.closedAt) return;
            const day = new Date(Number(t.closedAt)).toISOString().slice(0, 10);
            dailyPnL.set(day, (dailyPnL.get(day) || 0) + Number(t.profit ?? 0));
        });
        const dailyValues = Array.from(dailyPnL.values());
        const bestDay = dailyValues.length ? Math.max(...dailyValues) : 0;
        const worstDay = dailyValues.length ? Math.min(...dailyValues) : 0;

        /*
         * Consecutive wins/losses
         */
        let consecutiveWins = 0, consecutiveLosses = 0, maxWins = 0, maxLosses = 0;
        let prevProfit = 0;
        const sortedClosed = [...fullyClosed].sort(
            (a, b) => (Number(a.closedAt) || 0) - (Number(b.closedAt) || 0)
        );
        sortedClosed.forEach((t) => {
            const profit = Number(t.profit ?? 0);
            if (profit > 0) {
                consecutiveWins++;
                consecutiveLosses = 0;
                maxWins = Math.max(maxWins, consecutiveWins);
            } else if (profit < 0) {
                consecutiveLosses++;
                consecutiveWins = 0;
                maxLosses = Math.max(maxLosses, consecutiveLosses);
            } else {
                consecutiveWins = 0;
                consecutiveLosses = 0;
            }
            prevProfit = profit;
        });

        return {
            totalTrades: total,
            winRate: total ? (wins.length / total) * 100 : 0,
            net,
            grossProfit,
            grossLoss,
            profitFactor,
            avgWin: wins.length ? grossProfit / wins.length : 0,
            avgLoss: losses.length ? grossLoss / losses.length : 0,
            maxDrawdown,
            sharpe: 1.5,
            avgTrade,
            bestDay,
            worstDay,
            consecutiveWins: maxWins,
            consecutiveLosses: maxLosses,
            recoveredIn: 0,
        };
    }, [trades, accounts]);

    const monthlyData = useMemo(() => {
        const monthly = new Map<string, { return: number; trades: number; wins: number }>();
        trades.filter((t) => t.closedAt).forEach((t) => {
            if (!t.closedAt) return;
            const month = new Date(Number(t.closedAt)).toISOString().slice(0, 7);
            const existing = monthly.get(month) || { return: 0, trades: 0, wins: 0 };
            existing.return += Number(t.profit ?? 0);
            existing.trades += 1;
            if (Number(t.profit ?? 0) > 0) existing.wins += 1;
            monthly.set(month, existing);
        });
        return Array.from(monthly.entries())
            .map(([month, data]) => ({
                month,
                return: data.return,
                trades: data.trades,
                winRate: data.trades ? (data.wins / data.trades) * 100 : 0,
            }))
            .sort((a, b) => b.month.localeCompare(a.month))
            .slice(0, 12);
    }, [trades]);

    if (loading) {
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-10 text-sm text-muted-foreground">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-violet-500" />
                Generating your performance report...
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-8 text-sm text-rose-400">
                {error}
            </div>
        );
    }

    if (accounts.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
                No connected MT5 accounts yet. Add one in{" "}
                <a href="/account/settings?tab=mt5" className="font-semibold text-violet-400 underline underline-offset-2 hover:text-violet-300">
                    Settings → MT5 Accounts
                </a>{" "}
                to see your performance reports.
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h2 className="text-xl font-bold">Performance Reports</h2>
                <p className="mt-1 text-sm text-muted-foreground">Comprehensive analytics and performance summaries from your connected accounts.</p>
            </div>

            {/* KPI Grid */}
            <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total Trades</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{stats.totalTrades}</p>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Win Rate</p>
                    <p className="mt-1 text-2xl font-bold text-emerald-400">{stats.winRate.toFixed(1)}%</p>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Net Profit</p>
                    <p className={`mt-1 text-2xl font-bold ${stats.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {stats.net >= 0 ? "+" : ""}${stats.net.toFixed(2)}
                    </p>
                </div>
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-5">
                    <p className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold">Max Drawdown</p>
                    <p className="mt-1 text-2xl font-bold text-rose-400">{stats.maxDrawdown.toFixed(2)}%</p>
                </div>
            </div>

            {/* Secondary stats */}
            <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Profit Factor</p>
                    <p className="mt-1 text-xl font-bold text-foreground">
                        {!isFinite(stats.profitFactor) ? "∞" : stats.profitFactor.toFixed(2)}
                    </p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Avg Trade</p>
                    <p className="mt-1 text-xl font-bold text-foreground">${stats.avgTrade.toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Best/Worst Day</p>
                    <p className="mt-1 text-sm font-bold text-emerald-400">+${stats.bestDay.toFixed(0)}</p>
                    <p className="text-sm font-bold text-rose-400">-${Math.abs(stats.worstDay).toFixed(0)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Consec. Wins/Losses</p>
                    <p className="mt-1 text-xl font-bold text-emerald-400">{stats.consecutiveWins}W</p>
                    <p className="text-xl font-bold text-rose-400">{stats.consecutiveLosses}L</p>
                </div>
            </div>

            {/* Monthly Performance */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                    <h3 className="font-semibold">Monthly Performance</h3>
                    <button className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition">
                        <Download size={12} /> Export CSV
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                                <th className="py-3 px-5">Month</th>
                                <th className="py-3 px-4">Return</th>
                                <th className="py-3 px-4">Trades</th>
                                <th className="py-3 px-4">Win Rate</th>
                                <th className="py-3 px-4">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {monthlyData.map((row) => (
                                <tr key={row.month} className="hover:bg-muted/30">
                                    <td className="py-3 px-5 font-medium">{row.month}</td>
                                    <td className={`py-3 px-4 font-medium ${row.return >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                        {row.return > 0 ? "+" : ""}${row.return.toFixed(0)}
                                    </td>
                                    <td className="py-3 px-4 text-muted-foreground">{row.trades}</td>
                                    <td className="py-3 px-4 text-muted-foreground">{row.winRate.toFixed(0)}%</td>
                                    <td className="py-3 px-4">
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${row.return >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                                            {row.return >= 0 ? "Profitable" : "Draw"}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
