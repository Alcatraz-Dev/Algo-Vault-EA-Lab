"use client";

import { ReactNode, useMemo } from "react";
import { Award, Crosshair, LineChart, Percent, TrendingDown, TrendingUp } from "lucide-react";
import { EquityPoint, TradeRecord, useUserTradingData } from "@/components/tools/user-data";

function Sparkline({ series }: { series: EquityPoint[] }) {
    if (series.length < 2) {
        return (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                Not enough equity history yet.
            </div>
        );
    }

    const W = 100;
    const H = 32;
    const values = series.map((p) => p.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    const points = series
        .map((p, i) => {
            const x = (i / (series.length - 1)) * W;
            const y = H - ((p.equity - min) / span) * (H - 2) - 1;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");

    const area = `0,${H} ${points} ${W},${H}`;

    return (
        <div className="rounded-xl border border-border bg-muted/30 p-3">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-32 w-full">
                <defs>
                    <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <polygon points={area} fill="url(#equityFill)" />
                <polyline
                    points={points}
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth="0.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                />
            </svg>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{new Date(series[0].timestamp).toLocaleDateString()}</span>
                <span className="font-semibold text-foreground">
                    ${series[series.length - 1].equity.toFixed(2)}
                </span>
                <span>{new Date(series[series.length - 1].timestamp).toLocaleDateString()}</span>
            </div>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
    positive,
}: {
    icon: ReactNode;
    label: string;
    value: string;
    positive?: boolean;
}) {
    return (
        <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                {icon}
                <span className="uppercase tracking-wider">{label}</span>
            </div>
            <p
                className={`mt-2 text-2xl font-bold ${
                    positive === undefined ? "text-foreground" : positive ? "text-emerald-400" : "text-rose-400"
                }`}
            >
                {value}
            </p>
        </div>
    );
}

export default function AdvancedAnalysis({ userId }: { userId: string }) {
    const { accounts, liveAccounts, trades, equitySeries, loading, error } = useUserTradingData(userId);

    const stats = useMemo(() => {
        const closed = trades.filter((t) => t.openPrice != null);
        const total = closed.length;
        const wins = closed.filter((t) => Number(t.profit ?? 0) > 0);
        const losses = closed.filter((t) => Number(t.profit ?? 0) < 0);
        const grossProfit = wins.reduce((sum, t) => sum + Number(t.profit ?? 0), 0);
        const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Number(t.profit ?? 0), 0));
        const net = closed.reduce((sum, t) => sum + Number(t.profit ?? 0), 0);
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
        const avgWin = wins.length ? grossProfit / wins.length : 0;
        const avgLoss = losses.length ? grossLoss / losses.length : 0;
        const biggestWin = wins.length ? Math.max(...wins.map((t) => Number(t.profit ?? 0))) : 0;
        const biggestLoss = losses.length ? Math.min(...losses.map((t) => Number(t.profit ?? 0))) : 0;
        const buyCount = closed.filter((t) => (t.type ?? "").toUpperCase() === "BUY").length;
        const sellCount = closed.filter((t) => (t.type ?? "").toUpperCase() === "SELL").length;
        const maxDrawdown = accounts.reduce((max, a) => Math.max(max, Number(a.drawdown ?? 0)), 0);

        return {
            total,
            net,
            winRate: total ? (wins.length / total) * 100 : 0,
            profitFactor,
            avgWin,
            avgLoss,
            biggestWin,
            biggestLoss,
            buyCount,
            sellCount,
            maxDrawdown,
        };
    }, [trades, accounts]);

    if (loading) {
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-10 text-sm text-muted-foreground">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-violet-500" />
                Analyzing your accounts & trades...
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
                <Crosshair className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                No connected MT5 accounts yet. Add one in{" "}
                <a href="/account/settings?tab=mt5" className="font-semibold text-violet-400 underline underline-offset-2 hover:text-violet-300">
                    Settings → MT5 Accounts
                </a>{" "}
                so your accounts appear here.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {liveAccounts.length === 0 && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs text-amber-200/90">
                    <div>
                        <p className="font-semibold text-amber-300">
                            Connected account{accounts.length === 1 ? "" : "s"} found — waiting for live telemetry.
                        </p>
                        <p className="mt-1 leading-relaxed text-amber-200/70">
                            Run the Expert Advisor on these account numbers:
                            {accounts.map((a) => ` #${a.mt5Account ?? a.accountId}`).join(",")}
                            . Once it sends its first heartbeat, equity curves and trade analysis populate here automatically.
                        </p>
                    </div>
                </div>
            )}
            {/* Stat cards */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    icon={<TrendingUp size={13} className="text-emerald-400" />}
                    label="Net Profit"
                    value={`$${stats.net.toFixed(2)}`}
                    positive={stats.net >= 0}
                />
                <StatCard
                    icon={<Percent size={13} className="text-violet-400" />}
                    label="Win Rate"
                    value={`${stats.winRate.toFixed(1)}%`}
                    positive={stats.winRate >= 50}
                />
                <StatCard
                    icon={<Award size={13} className="text-amber-400" />}
                    label="Profit Factor"
                    value={!isFinite(stats.profitFactor) ? "∞" : stats.profitFactor.toFixed(2)}
                    positive={stats.profitFactor >= 1}
                />
                <StatCard
                    icon={<TrendingDown size={13} className="text-rose-400" />}
                    label="Max Drawdown"
                    value={`${stats.maxDrawdown.toFixed(2)}%`}
                />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                {/* Equity curve */}
                <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <LineChart size={15} className="text-violet-400" /> Equity Curve
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        Combined balance across your {accounts.length} connected account{accounts.length === 1 ? "" : "s"}.
                    </p>
                    <div className="mt-4">
                        <Sparkline series={equitySeries} />
                    </div>
                </div>

                {/* Trade mix */}
                <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="text-sm font-semibold">Buy / Sell Mix</h3>
                    <div className="mt-4 space-y-3">
                        <div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Buy</span>
                                <span className="font-semibold text-emerald-400">{stats.buyCount}</span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-emerald-500"
                                    style={{
                                        width: `${stats.buyCount + stats.sellCount > 0 ? (stats.buyCount / (stats.buyCount + stats.sellCount)) * 100 : 0}%`,
                                    }}
                                />
                            </div>
                        </div>
                        <div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Sell</span>
                                <span className="font-semibold text-rose-400">{stats.sellCount}</span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-rose-500"
                                    style={{
                                        width: `${stats.buyCount + stats.sellCount > 0 ? (stats.sellCount / (stats.buyCount + stats.sellCount)) * 100 : 0}%`,
                                    }}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-center">
                            <div className="rounded-xl bg-muted/50 py-2">
                                <p className="text-[11px] text-emerald-400">Avg Win</p>
                                <p className="text-sm font-bold text-foreground">${stats.avgWin.toFixed(2)}</p>
                            </div>
                            <div className="rounded-xl bg-muted/50 py-2">
                                <p className="text-[11px] text-rose-400">Avg Loss</p>
                                <p className="text-sm font-bold text-foreground">-${stats.avgLoss.toFixed(2)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Per-symbol table */}
            <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold">Performance by Symbol</h3>
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                                <th className="py-2 pr-4 font-medium">Symbol</th>
                                <th className="py-2 pr-4 font-medium">Trades</th>
                                <th className="py-2 pr-4 font-medium">Win Rate</th>
                                <th className="py-2 pr-4 font-medium">Net</th>
                                <th className="py-2 font-medium">Best / Worst</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(
                                trades.reduce((acc, trade) => {
                                    const symbol = (trade.symbol || "?").toUpperCase();
                                    if (!acc[symbol]) acc[symbol] = [];
                                    acc[symbol].push(trade);
                                    return acc;
                                }, {} as Record<string, TradeRecord[]>)
                            ).map(([symbol, list]) => {
                                const wins = list.filter((t) => Number(t.profit ?? 0) > 0);
                                const net = list.reduce((s, t) => s + Number(t.profit ?? 0), 0);
                                const best = Math.max(0, ...list.map((t) => Number(t.profit ?? 0)));
                                const worst = Math.min(0, ...list.map((t) => Number(t.profit ?? 0)));
                                return (
                                    <tr key={symbol} className="border-b border-border/60 last:border-0">
                                        <td className="py-2.5 pr-4 font-mono font-medium text-foreground">{symbol}</td>
                                        <td className="py-2.5 pr-4 text-muted-foreground">{list.length}</td>
                                        <td className="py-2.5 pr-4 text-muted-foreground">
                                            {list.length ? ((wins.length / list.length) * 100).toFixed(0) : 0}%
                                        </td>
                                        <td className={`py-2.5 pr-4 font-semibold ${net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                            {net >= 0 ? "+" : ""}${net.toFixed(2)}
                                        </td>
                                        <td className="py-2.5 text-muted-foreground">
                                            +${best.toFixed(0)} / -${Math.abs(worst).toFixed(0)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}