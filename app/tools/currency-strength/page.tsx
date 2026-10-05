"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    Loader2, Shield, RefreshCw, TrendingUp, TrendingDown, Zap,
} from "lucide-react";
import Link from "next/link";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { cn } from "@/lib/utils";

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
        } catch {
            // silent
        } finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchData()); }, [user, fetchData]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">Sign In</Link></div></div>);
    }

    const maxScore = Math.max(...data.map((d) => Math.abs(d.score)), 1);
    const strongest = data[0];
    const weakest = data[data.length - 1];

    return (
        <ToolPageShell
            title="Currency Strength Meter"
            description="Real-time relative strength across 8 major currencies. Lite shows one timeframe; Pro adds MTF and divergence detection."
            badge="lite"
            icon={Zap}
            backHref="/tools"
            showProCTA={false}
            proHeadline="Pro adds multi-timeframe strength, divergence detection, and saved snapshots."
            proFeatures={[
                "MTF strength (M15 / H1 / H4 / D1)",
                "Strength divergence detector (one strong vs another)",
                "Save snapshots to your account",
                "Pair-strength heatmap",
            ]}
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-3 text-xs">
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                        Timeframe: H1 (Lite)
                    </span>
                    <span className="text-muted-foreground">Pro adds M15, H4, D1 and divergence detector.</span>
                </div>
                <div className="flex items-center gap-3">
                    {lastUpdate > 0 && <span className="text-[10px] text-muted-foreground">Updated {new Date(lastUpdate).toLocaleTimeString()}</span>}
                    <button type="button" onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-md border border-border bg-muted px-4 py-2 text-xs text-muted-foreground transition hover:bg-muted/60 disabled:opacity-50">
                        <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                    </button>
                </div>
            </div>

            {strongest && weakest && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-positive/15 bg-positive/[0.04] p-5">
                        <div className="flex items-center gap-2 mb-1"><TrendingUp size={14} className="text-positive" /><span className="text-[10px] font-semibold uppercase tracking-wider text-positive/70">Strongest</span></div>
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">{CURRENCY_FLAGS[strongest.currency]}</span>
                            <div>
                                <p className="text-xl font-bold text-positive">{strongest.currency}</p>
                                <p className="text-xs text-muted-foreground">Score: {strongest.score.toFixed(1)} · {strongest.change >= 0 ? "+" : ""}{strongest.change.toFixed(2)}%</p>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-2xl border border-negative/15 bg-negative/[0.04] p-5">
                        <div className="flex items-center gap-2 mb-1"><TrendingDown size={14} className="text-negative" /><span className="text-[10px] font-semibold uppercase tracking-wider text-negative/70">Weakest</span></div>
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">{CURRENCY_FLAGS[weakest.currency]}</span>
                            <div>
                                <p className="text-xl font-bold text-negative">{weakest.currency}</p>
                                <p className="text-xs text-muted-foreground">Score: {weakest.score.toFixed(1)} · {weakest.change >= 0 ? "+" : ""}{weakest.change.toFixed(2)}%</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {loading && data.length === 0 ? (
                <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : data.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-16 text-center">
                    <Zap size={32} className="mx-auto text-muted-foreground" />
                    <p className="mt-3 text-sm text-muted-foreground">No strength data available</p>
                </div>
            ) : (
                <>
                    <div className="rounded-2xl border border-border bg-card p-6">
                        <h2 className="mb-4 text-sm font-semibold text-foreground">Strength Ranking</h2>
                        <div className="space-y-3">
                            {data.map((curr, idx) => {
                                const barWidth = maxScore > 0 ? (Math.abs(curr.score) / maxScore) * 100 : 0;
                                const isSelected = selected === curr.currency;
                                return (
                                    <div
                                        key={curr.currency}
                                        onClick={() => setSelected(isSelected ? null : curr.currency)}
                                        className={cn("cursor-pointer rounded-md p-3 transition-all", isSelected ? "bg-muted/40" : "hover:bg-muted")}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-bold text-muted-foreground w-4">#{idx + 1}</span>
                                                <span className="text-lg">{CURRENCY_FLAGS[curr.currency]}</span>
                                                <span className="text-sm font-bold text-foreground">{curr.currency}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className={cn("font-mono text-sm font-bold", curr.score > 0 ? "text-positive" : curr.score < 0 ? "text-negative" : "text-muted-foreground")}>
                                                    {curr.score > 0 ? "+" : ""}{curr.score.toFixed(1)}
                                                </span>
                                                <span className={cn("font-mono text-xs", curr.change >= 0 ? "text-positive/70" : "text-negative/70")}>
                                                    {curr.change >= 0 ? "+" : ""}{curr.change.toFixed(2)}%
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/30">
                                                <div
                                                    className={cn("h-full rounded-full transition-all duration-500", curr.score > 0 ? "bg-positive" : curr.score < 0 ? "bg-negative" : "bg-muted")}
                                                    style={{ width: `${barWidth}%` }}
                                                />
                                            </div>
                                        </div>
                                        {isSelected && curr.pairs.length > 0 && (
                                            <div className="mt-3 grid grid-cols-2 gap-1.5 pt-3 border-t border-border/20">
                                                {curr.pairs.map((p) => (
                                                    <div key={p.pair} className="flex items-center justify-between rounded-md bg-muted px-3 py-1.5">
                                                        <span className="font-mono text-[11px] text-muted-foreground">{p.pair}</span>
                                                        <span className={cn("font-mono text-[11px] font-bold", p.change > 0 ? "text-positive" : p.change < 0 ? "text-negative" : "text-muted-foreground")}>
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

                    {strongest && weakest && (
                        <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-5">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
                                <Zap size={14} /> Suggested Pair (Lite)
                            </h3>
                            <p className="mt-2 text-xs text-muted-foreground">
                                Based on current strength: <span className="font-bold text-positive">{strongest.currency}</span> is the strongest and <span className="font-bold text-negative">{weakest.currency}</span> is the weakest.
                            </p>
                            <p className="mt-1 font-mono text-lg font-bold text-foreground">
                                {strongest.currency}{weakest.currency}
                            </p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                                Pro adds the divergence detector: when one currency stays strong but the other is weakening, the setup is more reliable.
                            </p>
                        </div>
                    )}
                </>
            )}
        </ToolPageShell>
    );
}