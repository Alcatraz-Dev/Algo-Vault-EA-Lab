"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, RefreshCw, ArrowLeft, TrendingUp, TrendingDown, Minus, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type CurrencyData = {
    currency: string; score: number; change: number;
    pairs: { pair: string; change: number }[];
};

const CURRENCY_FLAGS: Record<string, string> = {
    EUR: "🇪🇺", USD: "🇺🇸", GBP: "🇬🇧", JPY: "🇯🇵",
    AUD: "🇦🇺", CAD: "🇨🇦", CHF: "🇨🇭", NZD: "🇳🇿",
};

export default function CurrencyStrengthPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [data, setData] = useState<CurrencyData[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState(0);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/analytics/currency-strength", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) { setData(json.currencies || []); setLastUpdate(json.timestamp); }
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchData()); }, [user, fetchData]);

    useEffect(() => {
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</Link></div></div>);
    }

    const maxScore = Math.max(...data.map((d) => Math.abs(d.score)), 1);
    const strongest = data[0];
    const weakest = data[data.length - 1];

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Currency Strength Meter</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Real-time relative strength across 8 major currencies</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {lastUpdate > 0 && <span className="text-[10px] text-muted-foreground">Updated {new Date(lastUpdate).toLocaleTimeString()}</span>}
                        <button type="button" onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/30 transition disabled:opacity-50">
                            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                        </button>
                    </div>
                </div>

                {/* Strongest / Weakest */}
                {strongest && weakest && (
                    <div className="mb-6 grid grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-5">
                            <div className="flex items-center gap-2 mb-1"><TrendingUp size={14} className="text-emerald-400" /><span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500/60">Strongest</span></div>
                            <div className="flex items-center gap-3">
                                <span className="text-2xl">{CURRENCY_FLAGS[strongest.currency]}</span>
                                <div>
                                    <p className="text-xl font-bold text-emerald-400">{strongest.currency}</p>
                                    <p className="text-xs text-muted-foreground">Score: {strongest.score.toFixed(1)} · {strongest.change >= 0 ? "+" : ""}{strongest.change.toFixed(2)}%</p>
                                </div>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-rose-500/15 bg-rose-500/[0.04] p-5">
                            <div className="flex items-center gap-2 mb-1"><TrendingDown size={14} className="text-rose-400" /><span className="text-[10px] font-semibold uppercase tracking-wider text-rose-500/60">Weakest</span></div>
                            <div className="flex items-center gap-3">
                                <span className="text-2xl">{CURRENCY_FLAGS[weakest.currency]}</span>
                                <div>
                                    <p className="text-xl font-bold text-rose-400">{weakest.currency}</p>
                                    <p className="text-xs text-muted-foreground">Score: {weakest.score.toFixed(1)} · {weakest.change >= 0 ? "+" : ""}{weakest.change.toFixed(2)}%</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {loading && data.length === 0 ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : data.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <Zap size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No strength data available</p>
                    </div>
                ) : (
                    <>
                        {/* Strength Bars */}
                        <div className="mb-6 rounded-2xl border border-border/30 bg-muted/50 p-6">
                            <h2 className="mb-4 text-sm font-semibold text-foreground">Strength Ranking</h2>
                            <div className="space-y-3">
                                {data.map((curr, idx) => {
                                    const barWidth = maxScore > 0 ? (Math.abs(curr.score) / maxScore) * 100 : 0;
                                    const isSelected = selected === curr.currency;

                                    return (
                                        <div
                                            key={curr.currency}
                                            onClick={() => setSelected(isSelected ? null : curr.currency)}
                                            className={cn("cursor-pointer rounded-xl p-3 transition-all", isSelected ? "bg-muted/30" : "hover:bg-muted")}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs font-bold text-muted-foreground w-4">#{idx + 1}</span>
                                                    <span className="text-lg">{CURRENCY_FLAGS[curr.currency]}</span>
                                                    <span className="text-sm font-bold text-foreground">{curr.currency}</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className={cn("font-mono text-sm font-bold", curr.score > 0 ? "text-emerald-400" : curr.score < 0 ? "text-rose-400" : "text-muted-foreground")}>
                                                        {curr.score > 0 ? "+" : ""}{curr.score.toFixed(1)}
                                                    </span>
                                                    <span className={cn("font-mono text-xs", curr.change >= 0 ? "text-emerald-400/60" : "text-rose-400/60")}>
                                                        {curr.change >= 0 ? "+" : ""}{curr.change.toFixed(2)}%
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/20">
                                                    <div
                                                        className={cn("h-full rounded-full transition-all duration-500", curr.score > 0 ? "bg-emerald-500" : curr.score < 0 ? "bg-rose-500" : "bg-muted")}
                                                        style={{ width: `${barWidth}%` }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Expanded Pairs */}
                                            {isSelected && curr.pairs.length > 0 && (
                                                <div className="mt-3 grid grid-cols-2 gap-1.5 pt-3 border-t border-border/20">
                                                    {curr.pairs.map((p) => (
                                                        <div key={p.pair} className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5">
                                                            <span className="font-mono text-[11px] text-muted-foreground">{p.pair}</span>
                                                            <span className={cn("font-mono text-[11px] font-bold", p.change > 0 ? "text-emerald-400" : p.change < 0 ? "text-rose-400" : "text-muted-foreground")}>
                                                                {p.change >= 0 ? "+" : ""}{p.change.toFixed(2)}%
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Best Pair Suggestion */}
                        {strongest && weakest && (
                            <div className="rounded-2xl border border-violet-500/15 bg-violet-500/[0.04] p-5">
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-violet-400">
                                    <Zap size={14} /> Suggested Pair
                                </h3>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    Based on current strength: <span className="font-bold text-emerald-400">{strongest.currency}</span> is the strongest and <span className="font-bold text-rose-400">{weakest.currency}</span> is the weakest.
                                </p>
                                <p className="mt-1 font-mono text-lg font-bold text-foreground">
                                    {strongest.currency}{weakest.currency}
                                </p>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                    Consider {strongest.currency} as base currency and {weakest.currency} as quote currency.
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
