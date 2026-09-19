"use client";

import { useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useUserTradingData } from "@/components/tools/user-data";

export default function TradeTracker({ userId }: { userId: string }) {
    const { accounts, trades, loading, error } = useUserTradingData(userId);
    const [filterSymbol, setFilterSymbol] = useState("all");
    const [filterStatus, setFilterStatus] = useState("all");

    const symbols = useMemo(() => {
        const set = new Set<string>();
        trades.forEach((t) => {
            if (t.symbol) set.add(t.symbol.toUpperCase());
        });
        return ["all", ...Array.from(set)];
    }, [trades]);

    const statuses = ["all", "open", "closed"];

    const filtered = useMemo(() => {
        return trades.filter((t) => {
            if (filterSymbol !== "all") {
                const sym = (t.symbol ?? "").toUpperCase();
                if (sym !== filterSymbol) return false;
            }
            if (filterStatus !== "all") {
                const isOpen = !t.closedAt;
                if (filterStatus === "open" && !isOpen) return false;
                if (filterStatus === "closed" && isOpen) return false;
            }
            return true;
        });
    }, [trades, filterSymbol, filterStatus]);

    const openTrades = useMemo(() => filtered.filter((t) => !t.closedAt), [filtered]);
    const totalPnl = useMemo(() => filtered.reduce((s, t) => s + Number(t.profit ?? 0), 0), [filtered]);
    const openPnl = useMemo(() => openTrades.reduce((s, t) => s + Number(t.profit ?? 0), 0), [openTrades]);

    if (loading) {
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-10 text-sm text-muted-foreground">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-violet-500" />
                Loading your live trades...
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
                so your trades appear here.
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h2 className="text-xl font-bold">Trade Tracking</h2>
                <p className="mt-1 text-sm text-muted-foreground">Monitor open and closed trades in real-time.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Open Trades</p>
                    <p className="mt-1 text-2xl font-bold text-emerald-400">{openTrades.length}</p>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Open P&amp;L</p>
                    <p className={`mt-1 text-2xl font-bold ${openPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {openPnl >= 0 ? "+" : ""}${openPnl.toLocaleString()}
                    </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total P&amp;L</p>
                    <p className={`mt-1 text-2xl font-bold ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {totalPnl >= 0 ? "+" : ""}${totalPnl.toLocaleString()}
                    </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total Trades</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{filtered.length}</p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <select
                    value={filterSymbol}
                    onChange={(e) => setFilterSymbol(e.target.value)}
                    className="rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-foreground focus:border-violet-500 focus:outline-none"
                >
                    {symbols.map((s) => <option key={s} value={s}>{s === "all" ? "All Symbols" : s}</option>)}
                </select>
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-foreground focus:border-violet-500 focus:outline-none"
                >
                    {statuses.map((s) => <option key={s} value={s}>{s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
            </div>

            <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                    <h3 className="font-semibold">Trades ({filtered.length})</h3>
                </div>
                <div className="overflow-x-auto">
                    {filtered.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/50 py-10 text-center text-sm text-muted-foreground">
                            No trades recorded{accounts.length === 1 ? "" : " for this view"}. Run the Expert Advisor on a connected account to stream live trades here.
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                                    <th className="py-3 px-5">Symbol</th>
                                    <th className="py-3 px-4">Type</th>
                                    <th className="py-3 px-4">Account</th>
                                    <th className="py-3 px-4">Volume</th>
                                    <th className="py-3 px-4">Open Price</th>
                                    <th className="py-3 px-4">Close Price</th>
                                    <th className="py-3 px-4">P&amp;L</th>
                                    <th className="py-3 px-4">Opened</th>
                                    <th className="py-3 px-4">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {filtered.map((trade) => {
                                    const profit = Number(trade.profit ?? 0);
                                    const side = (trade.type ?? "").toUpperCase();
                                    const open = !trade.closedAt;
                                    return (
                                        <tr key={`${trade.accountId ?? ""}-${trade.ticket ?? ""}`} className="hover:bg-muted/30">
                                            <td className="py-3 px-5 font-mono font-medium text-foreground">
                                                {(trade.symbol ?? "?").toUpperCase()}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                                    side === "SELL"
                                                        ? "bg-rose-500/10 text-rose-400"
                                                        : "bg-emerald-500/10 text-emerald-400"
                                                }`}>
                                                    {side === "SELL" ? <TrendingDown size={13} /> : <TrendingUp size={13} />} {side || "?"}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-muted-foreground font-mono text-xs">
                                                #{trade.accountId?.slice(-6) ?? "?"}
                                            </td>
                                            <td className="py-3 px-4 font-mono text-muted-foreground">
                                                {Number(trade.volume ?? 0).toFixed(2)}
                                            </td>
                                            <td className="py-3 px-4 font-mono text-muted-foreground">
                                                {Number(trade.openPrice ?? 0).toFixed(5)}
                                            </td>
                                            <td className="py-3 px-4 font-mono text-muted-foreground">
                                                {trade.closePrice != null
                                                    ? Number(trade.closePrice).toFixed(5)
                                                    : "—"}
                                            </td>
                                            <td className={`py-3 px-4 font-medium ${profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
                                            </td>
                                            <td className="py-3 px-4 text-xs text-muted-foreground">
                                                {new Date(Number(trade.openedAt ?? 0)).toLocaleString()}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${open ? "bg-amber-500/10 text-amber-400" : "bg-muted text-muted-foreground"}`}>
                                                    {open ? "● Open" : "✕ Closed"}
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
