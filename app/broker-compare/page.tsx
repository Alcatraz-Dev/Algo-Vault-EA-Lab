"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader2, Shield, RefreshCw, ArrowDownRight, ArrowUpRight, DollarSign, BarChart3, Percent, ArrowLeft } from "lucide-react";
import SiteNavbar from "@/components/navbar/SiteNavbar";
import Link from "next/link";
import { cn } from "@/lib/utils";

type BrokerProfile = {
    broker: string; totalBalance: number; totalEquity: number;
    avgSpread: number; avgSpreadCost: number; totalSwaps: number;
    totalSwapCost: number; totalCost: number; totalPnl: number; netPnl: number;
    positionsCount: number;
    symbols: { symbol: string; avgSpread: number; avgSwapLong: number; avgSwapShort: number; positions: number }[];
};

export default function BrokerComparePage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [brokers, setBrokers] = useState<BrokerProfile[]>([]);
    const [totalCost, setTotalCost] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/analytics/broker-compare", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) { setBrokers(json.brokers); setTotalCost(json.totalCost); }
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) fetchData(); }, [user, fetchData]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><SiteNavbar /><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><SiteNavbar /><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><a href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</a></div></div>);
    }

    const bestBroker = brokers.reduce((best, b) => b.netPnl > (best?.netPnl || -Infinity) ? b : best, brokers[0]);
    const highestCost = brokers.reduce((worst, b) => b.totalCost > (worst?.totalCost || -Infinity) ? b : worst, brokers[0]);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <SiteNavbar />
<div className="mx-auto max-w-7xl px-4 py-8">
                    <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition">
                        <ArrowLeft size={12} /> Back to Account
                    </Link>
                    <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Broker Comparison</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Compare trading costs, swaps, and net performance across brokers</p>
                    </div>
                    <button type="button" onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition disabled:opacity-50">
                        <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                    </button>
                </div>

                {loading && brokers.length === 0 ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : brokers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/30 p-16 text-center">
                        <BarChart3 size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No broker data available</p>
                        <a href="/admin/trading-accounts" className="mt-3 inline-block text-xs text-violet-400 hover:underline">Connect an account</a>
                    </div>
                ) : (
                    <>
                        {/* Summary */}
                        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4" data-guide="stats">
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Brokers</p>
                                <p className="mt-1 text-2xl font-bold text-foreground">{brokers.length}</p>
                            </div>
                            <div className="rounded-xl border border-rose-500/10 bg-rose-500/[0.04] p-4">
                                <p className="text-[10px] font-semibold uppercase text-rose-400">Total Cost (Swaps + Comm)</p>
                                <p className="mt-1 text-2xl font-bold text-rose-400">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                            </div>
                            {bestBroker && (
                                <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.04] p-4">
                                    <p className="text-[10px] font-semibold uppercase text-emerald-500">Best Net P/L</p>
                                    <p className="mt-1 text-lg font-bold text-emerald-400">{bestBroker.broker}</p>
                                    <p className="text-xs font-mono text-emerald-400/80">+${bestBroker.netPnl.toLocaleString()}</p>
                                </div>
                            )}
                            {highestCost && (
                                <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.04] p-4">
                                    <p className="text-[10px] font-semibold uppercase text-amber-500">Highest Cost</p>
                                    <p className="mt-1 text-lg font-bold text-amber-400">{highestCost.broker}</p>
                                    <p className="text-xs font-mono text-amber-400/80">${highestCost.totalCost.toLocaleString()}</p>
                                </div>
                            )}
                        </div>

                        {/* Broker Cards */}
                        <div className="space-y-4">
                            {brokers.sort((a, b) => b.netPnl - a.netPnl).map((bp) => (
                                <div key={bp.broker} className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <h3 className="text-lg font-bold text-foreground">{bp.broker}</h3>
                                            <p className="text-xs text-muted-foreground">${bp.totalBalance.toLocaleString()} balance</p>
                                        </div>
                                        <div className={cn("text-right", bp.netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            <p className="text-xs text-muted-foreground">Net P/L (after costs)</p>
                                            <p className="text-xl font-bold font-mono">{bp.netPnl >= 0 ? "+" : ""}${bp.netPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                                        <div className="rounded-lg bg-muted p-3">
                                            <p className="text-[9px] uppercase text-muted-foreground">Gross P/L</p>
                                            <p className={cn("mt-0.5 font-mono text-sm font-bold", bp.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>${bp.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                        <div className="rounded-lg bg-muted p-3">
                                            <p className="text-[9px] uppercase text-muted-foreground">Swap Costs</p>
                                            <p className="mt-0.5 font-mono text-sm font-bold text-rose-400">-${bp.totalSwapCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                        <div className="rounded-lg bg-muted p-3">
                                            <p className="text-[9px] uppercase text-muted-foreground">Commission</p>
                                            <p className="mt-0.5 font-mono text-sm font-bold text-amber-400">-${bp.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                        <div className="rounded-lg bg-muted p-3">
                                            <p className="text-[9px] uppercase text-muted-foreground">Total Costs</p>
                                            <p className="mt-0.5 font-mono text-sm font-bold text-muted-foreground">${(bp.totalSwapCost + bp.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                        <div className="rounded-lg bg-muted p-3">
                                            <p className="text-[9px] uppercase text-muted-foreground">Equity</p>
                                            <p className="mt-0.5 font-mono text-sm font-bold text-foreground">${bp.totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                    </div>

                                    {bp.symbols.length > 0 && (
                                        <div className="mt-4">
                                            <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Traded Symbols</p>
                                            <div className="flex flex-wrap gap-2">
                                                {bp.symbols.slice(0, 8).map((s) => (
                                                    <span key={s.symbol} className="rounded-lg border border-border/30 bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                                                        {s.symbol} <span className="text-muted-foreground">×{s.positions}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
