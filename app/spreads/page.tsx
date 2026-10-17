"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, RefreshCw, Wifi, WifiOff, TrendingUp, TrendingDown,
    Minus, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import ModernPageHeader from "@/components/ui/modern-page-header";

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

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchData()); }, [user, fetchData]);

    useEffect(() => {
        if (!autoRefresh || !user) return;
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [autoRefresh, user, fetchData]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-md bg-black px-6 py-2.5 text-sm font-semibold text-white hover:bg-black/80 transition-colors">Sign In</Link></div></div>);
    }

    const symbols = data ? Object.entries(data).sort((a, b) => b[1].spreadPips - a[1].spreadPips) : [];
    const avgSpread = symbols.length > 0 ? symbols.reduce((sum, [, v]) => sum + v.spreadPips, 0) / symbols.length : 0;
    const wideSpreads = symbols.filter(([, v]) => v.spreadPips > avgSpread * 2);

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
            <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="mb-6">
                    <ModernPageHeader
                        backHref="/account"
                        backLabel="Back to Account"
                        eyebrow="Execution"
                        title="Spread Monitor"
                        subtitle="Real-time bid/ask spreads across major instruments"
                        actions={
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setAutoRefresh((a) => !a)}
                                    className={cn("flex items-center gap-2 rounded-md border px-4 py-2.5 text-xs font-medium transition-colors", autoRefresh ? "border-positive/30 bg-positive/10 text-positive" : "border-border bg-muted text-muted-foreground")}
                                >
                                    {autoRefresh ? <Wifi size={13} /> : <WifiOff size={13} />}
                                    {autoRefresh ? "Live (10s)" : "Paused"}
                                </button>
                                <button type="button" onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-md border border-border bg-muted px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors disabled:opacity-50">
                                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                                </button>
                            </div>
                        }
                    />
                </div>

                {/* Stats */}
                <div className="mb-6 grid grid-cols-3 gap-4" data-guide="stats">
                    <div className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] p-4">
                        <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Avg Spread</p>
                        <p className="mt-1 text-xl font-bold font-numeric text-foreground">{avgSpread.toFixed(1)} pips</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] p-4">
                        <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Instruments</p>
                        <p className="mt-1 text-xl font-bold font-numeric text-foreground">{symbols.length}</p>
                    </div>
                    <div className={cn("rounded-lg border p-4", wideSpreads.length > 0 ? "border-warning/20 bg-warning/5" : "border-positive/20 bg-positive/5")}>
                        <p className={cn("text-micro font-semibold uppercase tracking-wider", wideSpreads.length > 0 ? "text-warning" : "text-positive")}>Wide Spreads</p>
                        <p className={cn("mt-1 text-xl font-bold font-numeric", wideSpreads.length > 0 ? "text-warning" : "text-positive")}>{wideSpreads.length}</p>
                    </div>
                </div>

                {loading && !data ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                ) : data ? (
                    <div className="space-y-3">
                        {symbols.map(([symbol, info]) => {
                            const isWide = info.spreadPips > avgSpread * 2;
                            const isNormal = info.spreadPips <= avgSpread * 1.5;

                            return (
                                <div key={symbol} className={cn("rounded-lg border p-5 transition-colors", isWide ? "border-warning/20 bg-warning/5" : "border-border bg-muted/50 hover:bg-muted")}>
                                    <div className="flex items-center justify-between">
                                        {/* Symbol + Prices */}
                                        <div className="flex items-center gap-5">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-base font-bold text-foreground">{symbol}</span>
                                                    {isWide && <AlertTriangle size={13} className="text-warning" />}
                                                </div>
                                                <div className="mt-1 flex items-center gap-3">
                                                    <span className="text-xs text-muted-foreground">Bid</span>
                                                    <span className="font-numeric text-sm font-semibold text-positive">{info.bid}</span>
                                                </div>
                                                <div className="mt-0.5 flex items-center gap-3">
                                                    <span className="text-xs text-muted-foreground">Ask</span>
                                                    <span className="font-numeric text-sm font-semibold text-negative">{info.ask}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Spread */}
                                        <div className="text-center">
                                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Spread</p>
                                            <p className={cn("mt-0.5 text-xl font-bold font-numeric", isWide ? "text-warning" : isNormal ? "text-positive" : "text-muted-foreground")}>
                                                {info.spreadPips}
                                            </p>
                                            <p className="text-micro text-muted-foreground">pips</p>
                                        </div>

                                        {/* 24h Change */}
                                        <div className="text-center">
                                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">24h</p>
                                            <div className={cn("mt-0.5 flex items-center gap-1", info.change24h >= 0 ? "text-positive" : "text-negative")}>
                                                {info.change24h > 0 ? <TrendingUp size={13} /> : info.change24h < 0 ? <TrendingDown size={13} /> : <Minus size={13} />}
                                                <span className="font-numeric text-sm font-bold">{info.change24h >= 0 ? "+" : ""}{info.change24h}%</span>
                                            </div>
                                        </div>

                                        {/* High/Low */}
                                        <div className="hidden text-right sm:block">
                                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">24h Range</p>
                                            <p className="mt-0.5 font-numeric text-xs text-muted-foreground">{info.high24h} — {info.low24h}</p>
                                        </div>

                                        {/* Spread Bar */}
                                        <div className="hidden w-24 md:block">
                                            <div className="h-1.5 overflow-hidden rounded-full bg-muted/30">
                                                <div
                                                    className={cn("h-full rounded-full transition-all", isWide ? "bg-warning" : isNormal ? "bg-positive" : "bg-muted")}
                                                    style={{ width: `${Math.min(100, (info.spreadPips / (avgSpread * 3)) * 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {lastUpdate > 0 && (
                            <p className="text-center text-micro text-muted-foreground">
                                Last updated: {new Date(lastUpdate).toLocaleTimeString()} · Auto-refresh {autoRefresh ? "ON (10s)" : "OFF"}
                            </p>
                        )}
                    </div>
                ) : (
                    <EmptyState
                        icon={<Wifi size={20} />}
                        title="No spread data available"
                        description="The spreads feed returned no instruments. Refresh or check back shortly."
                    />
                )}
            </div>
        </div>
    );
}
