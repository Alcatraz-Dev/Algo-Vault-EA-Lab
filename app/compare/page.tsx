"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, RefreshCw, Trophy, ArrowDownRight, ArrowUpRight, BarChart3,
    ArrowLeft, TrendingUp, TrendingDown, Activity, Wallet, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type AccountSnap = {
    accountId: string; mt5Account: string; broker: string;
    balance: number; equity: number; margin: number; freeMargin: number;
    marginLevel: number; drawdown: number; floatingPnl: number;
    positionsCount: number; buyVolume: number; sellVolume: number; netExposure: number;
    winCount: number; lossCount: number; totalTrades: number; winRate: number;
    avgWin: number; avgLoss: number; profitFactor: number; expectancy: number;
    sharpeRatio: number; online: boolean;
};

type Comparison = {
    totalAccounts: number; onlineAccounts: number; totalBalance: number; totalEquity: number;
    totalTrades: number; avgWinRate: number;
    bestPerformer: { broker: string; profitFactor: number } | null;
    worstPerformer: { broker: string; profitFactor: number } | null;
};

const COLUMNS = [
    { key: "balance" as const, label: "Balance", format: "currency" as const },
    { key: "equity" as const, label: "Equity", format: "currency" as const },
    { key: "floatingPnl" as const, label: "P/L", format: "pnl" as const },
    { key: "drawdown" as const, label: "Drawdown", format: "percent" as const },
    { key: "winRate" as const, label: "Win %", format: "percent" as const },
    { key: "totalTrades" as const, label: "Trades", format: "number" as const },
    { key: "profitFactor" as const, label: "PF", format: "number" as const },
    { key: "avgWin" as const, label: "Avg Win", format: "currency" as const },
    { key: "avgLoss" as const, label: "Avg Loss", format: "currency" as const },
    { key: "positionsCount" as const, label: "Positions", format: "number" as const },
];

function formatValue(val: number, format: string): string {
    switch (format) {
        case "currency": return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        case "pnl": return `${val >= 0 ? "+" : ""}$${val.toFixed(2)}`;
        case "percent": return `${val.toFixed(1)}%`;
        default: return String(val);
    }
}

function getValueColor(key: string, val: number): string {
    if (key === "floatingPnl") return val >= 0 ? "text-emerald-400" : "text-rose-400";
    if (key === "drawdown") return val > 10 ? "text-rose-400" : val > 5 ? "text-amber-400" : "text-muted-foreground";
    if (key === "winRate") return val >= 60 ? "text-emerald-400" : val >= 45 ? "text-muted-foreground" : "text-rose-400";
    if (key === "profitFactor") return val >= 2 ? "text-emerald-400" : val >= 1 ? "text-muted-foreground" : "text-rose-400";
    if (key === "avgWin") return "text-emerald-400/80";
    if (key === "avgLoss") return "text-rose-400/80";
    return "text-muted-foreground";
}

export default function ComparePage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [accounts, setAccounts] = useState<AccountSnap[]>([]);
    const [comparison, setComparison] = useState<Comparison | null>(null);
    const [loading, setLoading] = useState(true);
    const [sortKey, setSortKey] = useState<keyof AccountSnap>("profitFactor");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/analytics/compare", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) { setAccounts(json.accounts); setComparison(json.comparison); }
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) fetchData(); }, [user, fetchData]);

    if (authLoading) {
        return (
            <div className="flex min-h-screen flex-col bg-background">
                <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background">
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <Shield size={40} className="text-muted-foreground" />
                    <h1 className="text-xl font-semibold text-foreground">Sign in required</h1>
                    <Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">
                        Sign In
                    </Link>
                </div>
            </div>
        );
    }

    const sorted = [...accounts].sort((a, b) => {
        const aVal = Number(a[sortKey] || 0);
        const bVal = Number(b[sortKey] || 0);
        return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });

    const toggleSort = (key: keyof AccountSnap) => {
        if (sortKey === key) setSortDir((d) => d === "desc" ? "asc" : "desc");
        else { setSortKey(key); setSortDir("desc"); }
    };

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="mb-8" data-guide="page-header">
                    <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                        <ArrowLeft size={12} /> Back to Account
                    </Link>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Account Comparison</h1>
                            <p className="mt-1.5 text-sm text-muted-foreground">Side-by-side metrics for all connected MT5 accounts</p>
                        </div>
                        <button
                            type="button"
                            onClick={fetchData}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl border border-border/40 bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground hover:bg-background/15 hover:text-foreground transition disabled:opacity-50"
                        >
                            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                        </button>
                    </div>
                </div>

                {loading && accounts.length === 0 ? (
                    <div className="flex h-64 items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                    </div>
                ) : accounts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10">
                            <BarChart3 size={28} className="text-violet-400" />
                        </div>
                        <h3 className="mt-4 text-base font-semibold text-foreground">No accounts to compare</h3>
                        <p className="mt-1.5 text-sm text-muted-foreground">Connect your MT5 accounts to see a side-by-side comparison.</p>
                        <Link href="/admin/trading-accounts" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">
                            Connect Account
                        </Link>
                    </div>
                ) : (
                    <>
                        {/* Summary Cards */}
                        {comparison && (
                            <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5" data-guide="summary">
                                <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                                            <Wallet size={14} className="text-blue-400" />
                                        </div>
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Balance</span>
                                    </div>
                                    <p className="text-xl font-bold font-mono text-foreground">
                                        ${comparison.totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                                            <Activity size={14} className="text-violet-400" />
                                        </div>
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Equity</span>
                                    </div>
                                    <p className="text-xl font-bold font-mono text-foreground">
                                        ${comparison.totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10">
                                            <BarChart3 size={14} className="text-cyan-400" />
                                        </div>
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Trades</span>
                                    </div>
                                    <p className="text-xl font-bold font-mono text-foreground">{comparison.totalTrades}</p>
                                </div>
                                <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.03] p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                                            <Trophy size={14} className="text-emerald-400" />
                                        </div>
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500/60">Best</span>
                                    </div>
                                    <p className="text-sm font-bold text-emerald-400">{comparison.bestPerformer?.broker || "N/A"}</p>
                                    <p className="text-[10px] text-muted-foreground">PF {comparison.bestPerformer?.profitFactor}</p>
                                </div>
                                <div className="rounded-2xl border border-rose-500/10 bg-rose-500/[0.03] p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10">
                                            <ArrowDownRight size={14} className="text-rose-400" />
                                        </div>
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-500/60">Review</span>
                                    </div>
                                    <p className="text-sm font-bold text-rose-400">{comparison.worstPerformer?.broker || "N/A"}</p>
                                    <p className="text-[10px] text-muted-foreground">PF {comparison.worstPerformer?.profitFactor}</p>
                                </div>
                            </div>
                        )}

                        {/* Comparison Table */}
                        <div className="rounded-2xl border border-border/30 bg-muted/50 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-border/20 bg-muted/50">
                                            <th className="px-5 py-3.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                Account
                                            </th>
                                            {COLUMNS.map((col) => (
                                                <th
                                                    key={col.key}
                                                    onClick={() => toggleSort(col.key)}
                                                    className="cursor-pointer px-4 py-3.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-violet-400 transition select-none"
                                                >
                                                    <span className="inline-flex items-center gap-1">
                                                        {col.label}
                                                        {sortKey === col.key ? (
                                                            sortDir === "desc" ? <ChevronDown size={10} /> : <ChevronUp size={10} />
                                                        ) : null}
                                                    </span>
                                                </th>
                                            ))}
                                            <th className="px-5 py-3.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                Status
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sorted.map((acc, idx) => (
                                            <tr
                                                key={acc.accountId}
                                                className={cn(
                                                    "border-b border-border/10 transition hover:bg-muted",
                                                    idx % 2 === 0 ? "bg-transparent" : "bg-muted/10"
                                                )}
                                            >
                                                <td className="px-5 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            "flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold",
                                                            acc.online ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/50/30 text-muted-foreground"
                                                        )}>
                                                            {acc.broker.charAt(0)}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-foreground">{acc.broker}</p>
                                                            <p className="text-[10px] text-muted-foreground font-mono">{acc.mt5Account}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                {COLUMNS.map((col) => {
                                                    const val = Number(acc[col.key] || 0);
                                                    return (
                                                        <td key={col.key} className={cn("px-4 py-4 text-right font-mono text-xs", getValueColor(col.key, val))}>
                                                            {formatValue(val, col.format)}
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-5 py-4 text-right">
                                                    <span className={cn(
                                                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium",
                                                        acc.online ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/50/30 text-muted-foreground"
                                                    )}>
                                                        <span className={cn("h-1.5 w-1.5 rounded-full", acc.online ? "bg-emerald-400 animate-pulse" : "bg-muted")} />
                                                        {acc.online ? "Online" : "Offline"}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="mt-4 flex items-center justify-between text-[10px] text-muted-foreground px-1">
                            <span>
                                Sorted by <span className="text-muted-foreground">{sortKey}</span> ({sortDir === "desc" ? "highest first" : "lowest first"})
                            </span>
                            <span>
                                {accounts.length} accounts · {accounts.filter((a) => a.online).length} online
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
