"use client";

import { useMemo, useState } from "react";
import { Activity, Filter, TrendingDown, TrendingUp } from "lucide-react";
import { useUserTradingData } from "@/components/tools/user-data";

function directionIcon(type?: string) {
    return (type ?? "").toUpperCase() === "SELL" ? (
        <TrendingDown size={13} className="text-rose-400" />
    ) : (
        <TrendingUp size={13} className="text-emerald-400" />
    );
}

export default function OrderFlow({ userId }: { userId: string }) {
    const { accounts, trades, loading, error } = useUserTradingData(userId);
    const [accountFilter, setAccountFilter] = useState("all");

    const filtered = useMemo(() => {
        const list =
            accountFilter === "all" ? trades : trades.filter((t) => t.accountId === accountFilter);
        return [...list].sort(
            (a, b) =>
                (Number(b.closedAt ?? b.openedAt ?? 0) || 0) - (Number(a.closedAt ?? a.openedAt ?? 0) || 0)
        );
    }, [trades, accountFilter]);

    if (loading) {
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-10 text-sm text-muted-foreground">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-violet-500" />
                Loading your trade history...
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
                <Activity className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                No connected MT5 accounts yet. Add one in{" "}
                <a href="/account/settings?tab=mt5" className="font-semibold text-violet-400 underline underline-offset-2 hover:text-violet-300">
                    Settings → MT5 Accounts
                </a>{" "}
                so your orders appear here.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Account filter */}
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 w-fit">
                <Filter size={14} className="ml-2 text-muted-foreground" />
                <button
                    type="button"
                    onClick={() => setAccountFilter("all")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${accountFilter === "all" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                    All accounts
                </button>
                {accounts.map((account) => (
                    <button
                        key={account.accountId}
                        type="button"
                        onClick={() => setAccountFilter(account.accountId)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-mono transition ${accountFilter === account.accountId ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        #{account.mt5Account ?? account.accountId}
                    </button>
                ))}
            </div>

            {/* Stat strip */}
            <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total Trades</p>
                    <p className="mt-1 text-xl font-bold">{filtered.length}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Open</p>
                    <p className="mt-1 text-xl font-bold text-amber-400">
                        {filtered.filter((t) => !t.closedAt).length}
                    </p>
                </div>
                <div className="rounded-xl border border-border bg-card p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Closed</p>
                    <p className="mt-1 text-xl font-bold text-emerald-400">
                        {filtered.filter((t) => t.closedAt).length}
                    </p>
                </div>
                <div className="rounded-xl border border-border bg-card p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Realized P/L</p>
                    <p
                        className={`mt-1 text-xl font-bold ${
                            filtered.reduce((s, t) => s + Number(t.profit ?? 0), 0) >= 0
                                ? "text-emerald-400"
                                : "text-rose-400"
                        }`}
                    >
                        ${filtered.reduce((s, t) => s + Number(t.profit ?? 0), 0).toFixed(2)}
                    </p>
                </div>
            </div>

            {/* Trades table */}
            <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold">Order Flow</h3>
                <div className="mt-3 overflow-x-auto">
                    {filtered.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                            No trades recorded for this view yet. Run the Expert Advisor on a
                            connected account to stream live orders here.
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                                    <th className="py-2 pr-4 font-medium">Symbol</th>
                                    <th className="py-2 pr-4 font-medium">Side</th>
                                    <th className="py-2 pr-4 font-medium">Volume</th>
                                    <th className="py-2 pr-4 font-medium">Open Price</th>
                                    <th className="py-2 pr-4 font-medium">Close Price</th>
                                    <th className="py-2 pr-4 font-medium">Profit</th>
                                    <th className="py-2 pr-4 font-medium">Opened</th>
                                    <th className="py-2 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((trade) => {
                                    const profit = Number(trade.profit ?? 0);
                                    const side = (trade.type ?? "").toUpperCase();
                                    const open = !trade.closedAt;
                                    return (
                                        <tr
                                            key={`${trade.accountId ?? ""}-${trade.ticket ?? ""}`}
                                            className="border-b border-border/60 last:border-0"
                                        >
                                            <td className="py-2.5 pr-4 font-mono font-medium text-foreground">
                                                {(trade.symbol ?? "?").toUpperCase()}
                                            </td>
                                            <td className="py-2.5 pr-4">
                                                <span
                                                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                                        side === "SELL"
                                                            ? "bg-rose-500/10 text-rose-400"
                                                            : "bg-emerald-500/10 text-emerald-400"
                                                    }`}
                                                >
                                                    {directionIcon(trade.type)} {side || "?"}
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-4 font-mono text-muted-foreground">
                                                {Number(trade.volume ?? 0).toFixed(2)}
                                            </td>
                                            <td className="py-2.5 pr-4 font-mono text-muted-foreground">
                                                {Number(trade.openPrice ?? 0).toFixed(5)}
                                            </td>
                                            <td className="py-2.5 pr-4 font-mono text-muted-foreground">
                                                {trade.closePrice != null
                                                    ? Number(trade.closePrice).toFixed(5)
                                                    : "—"}
                                            </td>
                                            <td
                                                className={`py-2.5 pr-4 font-semibold ${
                                                    profit >= 0 ? "text-emerald-400" : "text-rose-400"
                                                }`}
                                            >
                                                {profit >= 0 ? "+" : ""}
                                                {profit.toFixed(2)}
                                            </td>
                                            <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                                                {new Date(Number(trade.openedAt ?? 0)).toLocaleString()}
                                            </td>
                                            <td className="py-2.5">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                                        open
                                                            ? "bg-amber-500/10 text-amber-400"
                                                            : "bg-muted text-muted-foreground"
                                                    }`}
                                                >
                                                    {open ? "OPEN" : "CLOSED"}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}