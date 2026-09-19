"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, RefreshCw, Wifi, WifiOff, ArrowLeft, TrendingUp, TrendingDown,
    Minus, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type SpreadData = Record<string, {
    bid: number; ask: number; spread: number; spreadPips: number;
    change24h: number; high24h: number; low24h: number;
}>;

export default function SpreadMonitorPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [data, setData] = useState<SpreadData | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState(0);
    const [autoRefresh, setAutoRefresh] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/analytics/spreads", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) { setData(json.spreads); setLastUpdate(json.timestamp); }
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) fetchData(); }, [user, fetchData]);

    useEffect(() => {
        if (!autoRefresh || !user) return;
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [autoRefresh, user, fetchData]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</Link></div></div>);
    }

    const symbols = data ? Object.entries(data).sort((a, b) => b[1].spreadPips - a[1].spreadPips) : [];
    const avgSpread = symbols.length > 0 ? symbols.reduce((sum, [, v]) => sum + v.spreadPips, 0) / symbols.length : 0;
    const wideSpreads = symbols.filter(([, v]) => v.spreadPips > avgSpread * 2);

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Spread Monitor</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Real-time bid/ask spreads across major instruments</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setAutoRefresh((a) => !a)}
                            className={cn("flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition", autoRefresh ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400" : "border-border/30 bg-muted text-muted-foreground")}
                        >
                            {autoRefresh ? <Wifi size={13} /> : <WifiOff size={13} />}
                            {autoRefresh ? "Live (10s)" : "Paused"}
                        </button>
                        <button type="button" onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/30 transition disabled:opacity-50">
                            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                        </button>
                    </div>
                </div>

                {/* Stats */}
                <div className="mb-6 grid grid-cols-3 gap-4" data-guide="stats">
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avg Spread</p>
                        <p className="mt-1 text-xl font-bold font-mono text-foreground">{avgSpread.toFixed(1)} pips</p>
                    </div>
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Instruments</p>
                        <p className="mt-1 text-xl font-bold font-mono text-foreground">{symbols.length}</p>
                    </div>
                    <div className={cn("rounded-2xl border p-4", wideSpreads.length > 0 ? "border-amber-500/10 bg-amber-500/[0.03]" : "border-emerald-500/10 bg-emerald-500/[0.03]")}>
                        <p className={cn("text-[10px] font-semibold uppercase tracking-wider", wideSpreads.length > 0 ? "text-amber-500/60" : "text-emerald-500/60")}>Wide Spreads</p>
                        <p className={cn("mt-1 text-xl font-bold font-mono", wideSpreads.length > 0 ? "text-amber-400" : "text-emerald-400")}>{wideSpreads.length}</p>
                    </div>
                </div>

                {loading && !data ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : data ? (
                    <div className="space-y-3">
                        {symbols.map(([symbol, info]) => {
                            const isWide = info.spreadPips > avgSpread * 2;
                            const isNormal = info.spreadPips <= avgSpread * 1.5;

                            return (
                                <div key={symbol} className={cn("rounded-2xl border p-5 transition-all", isWide ? "border-amber-500/15 bg-amber-500/[0.03]" : "border-border/30 bg-muted/50 hover:bg-muted")}>
                                    <div className="flex items-center justify-between">
                                        {/* Symbol + Prices */}
                                        <div className="flex items-center gap-5">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-base font-bold text-foreground">{symbol}</span>
                                                    {isWide && <AlertTriangle size={13} className="text-amber-400" />}
                                                </div>
                                                <div className="mt-1 flex items-center gap-3">
                                                    <span className="text-xs text-muted-foreground">Bid</span>
                                                    <span className="font-mono text-sm font-semibold text-emerald-400">{info.bid}</span>
                                                </div>
                                                <div className="mt-0.5 flex items-center gap-3">
                                                    <span className="text-xs text-muted-foreground">Ask</span>
                                                    <span className="font-mono text-sm font-semibold text-rose-400">{info.ask}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Spread */}
                                        <div className="text-center">
                                            <p className="text-[10px] uppercase text-muted-foreground">Spread</p>
                                            <p className={cn("mt-0.5 text-xl font-bold font-mono", isWide ? "text-amber-400" : isNormal ? "text-emerald-400" : "text-muted-foreground")}>
                                                {info.spreadPips}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">pips</p>
                                        </div>

                                        {/* 24h Change */}
                                        <div className="text-center">
                                            <p className="text-[10px] uppercase text-muted-foreground">24h</p>
                                            <div className={cn("mt-0.5 flex items-center gap-1", info.change24h >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                {info.change24h > 0 ? <TrendingUp size={13} /> : info.change24h < 0 ? <TrendingDown size={13} /> : <Minus size={13} />}
                                                <span className="font-mono text-sm font-bold">{info.change24h >= 0 ? "+" : ""}{info.change24h}%</span>
                                            </div>
                                        </div>

                                        {/* High/Low */}
                                        <div className="hidden text-right sm:block">
                                            <p className="text-[10px] uppercase text-muted-foreground">24h Range</p>
                                            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{info.high24h} — {info.low24h}</p>
                                        </div>

                                        {/* Spread Bar */}
                                        <div className="hidden w-24 md:block">
                                            <div className="h-1.5 overflow-hidden rounded-full bg-muted/30">
                                                <div
                                                    className={cn("h-full rounded-full transition-all", isWide ? "bg-amber-500" : isNormal ? "bg-emerald-500" : "bg-muted")}
                                                    style={{ width: `${Math.min(100, (info.spreadPips / (avgSpread * 3)) * 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {lastUpdate > 0 && (
                            <p className="text-center text-[10px] text-muted-foreground">
                                Last updated: {new Date(lastUpdate).toLocaleTimeString()} · Auto-refresh {autoRefresh ? "ON (10s)" : "OFF"}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <Wifi size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No spread data available</p>
                    </div>
                )}
            </div>
        </div>
    );
}
