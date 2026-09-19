"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Calendar,
    ChevronDown,
    Loader2,
    Search,
    Target,
    TrendingDown,
    TrendingUp,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { AISignal, SignalResult } from "@/lib/ai-signals/types";

type PeriodFilter = "today" | "week" | "month" | "last7" | "last30" | "last90" | "all";

const PERIOD_OPTIONS: { label: string; value: PeriodFilter }[] = [
    { label: "Today", value: "today" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
    { label: "Last 7 Days", value: "last7" },
    { label: "Last 30 Days", value: "last30" },
    { label: "Last 90 Days", value: "last90" },
    { label: "All Time", value: "all" },
];

const TIER_OPTIONS: { label: string; value: "FREE" | "PRO" | "all" }[] = [
    { label: "All Tiers", value: "all" },
    { label: "Free", value: "FREE" },
    { label: "Pro", value: "PRO" },
];

const TIMEFRAMES = ["M1", "M5", "M15"];

function resultBadge(result: SignalResult, resultR: number) {
    const map: Record<SignalResult, { label: string; color: string; bg: string }> = {
        WIN: { label: "WIN", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
        LOSS: { label: "LOSS", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
        BREAKEVEN: { label: "BE", color: "text-muted-foreground", bg: "bg-muted/10 border-border/30" },
        EXPIRED: { label: "EXPIRED", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
        CANCELLED: { label: "CANCELLED", color: "text-muted-foreground", bg: "bg-border/40 border-border/20" },
        PENDING: { label: "PENDING", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
    };

    const badge = map[result] || map.PENDING;

    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.bg} ${badge.color}`}>
            {badge.label}
            {resultR !== 0 && result !== "PENDING" && (
                <span className="ml-0.5">{resultR > 0 ? "+" : ""}{resultR.toFixed(2)}R</span>
            )}
        </span>
    );
}

export default function SignalHistoryPage() {
    const [user, setUser] = useState<User | null>(null);
    const [signals, setSignals] = useState<AISignal[]>([]);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<PeriodFilter>("all");
    const [tierFilter, setTierFilter] = useState<"FREE" | "PRO" | "all">("all");
    const [timeframeFilter, setTimeframeFilter] = useState<string>("all");
    const [directionFilter, setDirectionFilter] = useState<"BUY" | "SELL" | "all">("all");
    const [search, setSearch] = useState("");
    const [periodOpen, setPeriodOpen] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;

        async function loadSignals() {
            try {
                const token = await user!.getIdToken(true);
                setLoading(true);
                const params = new URLSearchParams({ period, limit: "200" });
                if (tierFilter !== "all") params.set("tier", tierFilter);
                if (timeframeFilter !== "all") params.set("timeframe", timeframeFilter);
                if (directionFilter !== "all") params.set("direction", directionFilter);

                const res = await fetch(`/api/signals/history?${params}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (data.signals) setSignals(data.signals);
            } catch (err) {
                console.error("Failed to fetch signal history:", err);
            } finally {
                setLoading(false);
            }
        }

        loadSignals();
    }, [user, period, tierFilter, timeframeFilter, directionFilter]);

    const filtered = useMemo(() => {
        if (!search.trim()) return signals;
        const q = search.toLowerCase().trim();
        return signals.filter((s) => s.symbol.toLowerCase().includes(q));
    }, [signals, search]);

    const stats = useMemo(() => {
        const completed = filtered.filter((s) => s.result === "WIN" || s.result === "LOSS" || s.result === "BREAKEVEN");
        const wins = filtered.filter((s) => s.result === "WIN").length;
        const losses = filtered.filter((s) => s.result === "LOSS").length;
        const totalR = completed.reduce((a, s) => a + Number(s.resultR || 0), 0);
        const winRate = completed.length > 0 ? (wins / completed.length) * 100 : 0;
        const avgR = completed.length > 0 ? totalR / completed.length : 0;
        return { wins, losses, totalR, winRate, avgR, total: completed.length };
    }, [filtered]);

    if (!user) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>

            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link
                    href="/signals"
                    className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                >
                    <ArrowLeft size={16} />
                    Back to Signals
                </Link>

                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between" data-guide="page-header">
                    <div>
                        <div className="flex items-center gap-2 text-sm text-amber-400 font-medium">
                            <Calendar className="h-4 w-4" />
                            Signal History
                        </div>
                        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
                            History &amp; Results
                        </h1>
                        <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                            Every signal generated by the AI engine — winners, losers, expired, and cancelled — tracked with full result calculation based on the trade-management model.
                        </p>
                    </div>
                </div>

                {/* FILTERS */}
                <div className="mt-6 flex flex-wrap items-center gap-2" data-guide="filters">
                    {/* Period */}
                    <div className="relative">
                        <button
                            onClick={() => setPeriodOpen(!periodOpen)}
                            className="flex h-8 items-center gap-1.5 rounded-lg border border-border/30 bg-card/40 px-3 text-xs text-muted-foreground transition-colors hover:border-border/50 hover:text-foreground"
                        >
                            <Calendar size={12} />
                            {PERIOD_OPTIONS.find((o) => o.value === period)?.label}
                            <ChevronDown size={12} />
                        </button>
                        {periodOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setPeriodOpen(false)} />
                                <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-border/30 bg-card p-1 shadow-xl backdrop-blur-xl">
                                    {PERIOD_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            onClick={() => { setPeriod(opt.value); setPeriodOpen(false); }}
                                            className={`flex w-full items-center rounded-lg px-3 py-1.5 text-xs transition-colors ${
                                                period === opt.value ? "bg-amber-500/10 text-amber-400" : "text-muted-foreground hover:bg-muted/5 hover:text-foreground"
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Tier */}
                    <div className="flex items-center gap-1 rounded-lg border border-border/30 bg-card/40 p-0.5">
                        {TIER_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => setTierFilter(opt.value)}
                                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                                    tierFilter === opt.value
                                        ? "bg-amber-500/20 text-amber-400"
                                        : "text-muted-foreground hover:text-muted-foreground"
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {/* Timeframe */}
                    <div className="flex items-center gap-1 rounded-lg border border-border/30 bg-card/40 p-0.5">
                        <button
                            onClick={() => setTimeframeFilter("all")}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                                timeframeFilter === "all" ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground hover:text-muted-foreground"
                            }`}
                        >
                            All TF
                        </button>
                        {TIMEFRAMES.map((tf) => (
                            <button
                                key={tf}
                                onClick={() => setTimeframeFilter(tf)}
                                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                                    timeframeFilter === tf ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground hover:text-muted-foreground"
                                }`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>

                    {/* Direction */}
                    <div className="flex items-center gap-1 rounded-lg border border-border/30 bg-card/40 p-0.5">
                        {(["all", "BUY", "SELL"] as const).map((dir) => (
                            <button
                                key={dir}
                                onClick={() => setDirectionFilter(dir)}
                                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                                    directionFilter === dir ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground hover:text-muted-foreground"
                                }`}
                            >
                                {dir === "all" ? "All" : dir}
                            </button>
                        ))}
                    </div>

                    {/* Search */}
                    <div className="relative ml-auto">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search symbol..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-8 w-40 rounded-lg border border-border/30 bg-card/40 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-amber-500/30"
                        />
                    </div>
                </div>

                {/* STATS ROW */}
                <div className="mt-6 grid gap-3 sm:grid-cols-5">
                    <div className="rounded-xl border border-border/30 bg-card/60 p-4 text-center backdrop-blur-xl">
                        <p className="text-[10px] text-muted-foreground uppercase">Completed</p>
                        <p className="mt-1 text-2xl font-black text-foreground">{stats.total}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center backdrop-blur-xl">
                        <p className="text-[10px] text-emerald-400 uppercase">Win Rate</p>
                        <p className="mt-1 text-2xl font-black text-emerald-400">{stats.winRate.toFixed(1)}%</p>
                        <p className="text-[10px] text-muted-foreground">{stats.wins}W / {stats.losses}L</p>
                    </div>
                    <div className="rounded-xl border border-border/30 bg-card/60 p-4 text-center backdrop-blur-xl">
                        <p className="text-[10px] text-muted-foreground uppercase">Total R</p>
                        <p className={`mt-1 text-2xl font-black ${stats.totalR >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {stats.totalR >= 0 ? "+" : ""}{stats.totalR.toFixed(2)}R
                        </p>
                    </div>
                    <div className="rounded-xl border border-border/30 bg-card/60 p-4 text-center backdrop-blur-xl">
                        <p className="text-[10px] text-muted-foreground uppercase">Avg R</p>
                        <p className={`mt-1 text-2xl font-black ${stats.avgR >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {stats.avgR >= 0 ? "+" : ""}{stats.avgR.toFixed(2)}R
                        </p>
                    </div>
                    <div className="rounded-xl border border-border/30 bg-card/60 p-4 text-center backdrop-blur-xl">
                        <p className="text-[10px] text-muted-foreground uppercase">Tier</p>
                        <p className="mt-1 text-sm font-bold text-foreground">{tierFilter === "all" ? "All" : tierFilter}</p>
                    </div>
                </div>

                {/* RESULTS TABLE */}
                <div className="mt-8 rounded-2xl border border-border/30 bg-card/60 backdrop-blur-xl overflow-hidden">
                    {loading ? (
                        <div className="p-16 text-center">
                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-3" />
                            <p className="text-sm text-muted-foreground">Loading signal history...</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="p-16 text-center">
                            <Target className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                            <p className="text-sm font-medium text-muted-foreground">No signals found</p>
                            <p className="text-xs text-muted-foreground">Try adjusting your filters</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-border/30 text-muted-foreground">
                                        <th className="px-4 py-3 text-left font-medium">Symbol</th>
                                        <th className="px-4 py-3 text-left font-medium">Tier</th>
                                        <th className="px-4 py-3 text-left font-medium">TF</th>
                                        <th className="px-4 py-3 text-left font-medium">Direction</th>
                                        <th className="px-4 py-3 text-right font-medium">Entry</th>
                                        <th className="px-4 py-3 text-right font-medium">SL</th>
                                        <th className="px-4 py-3 text-right font-medium">TP1</th>
                                        <th className="px-4 py-3 text-right font-medium">Confidence</th>
                                        <th className="px-4 py-3 text-center font-medium">Result</th>
                                        <th className="px-4 py-3 text-right font-medium">R</th>
                                        <th className="px-4 py-3 text-left font-medium">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {filtered.map((signal) => (
                                        <tr key={signal.id} className="transition-colors hover:bg-muted/50">
                                            <td className="px-4 py-3 font-bold text-foreground">{signal.symbol}</td>
                                            <td className="px-4 py-3">
                                                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                                                    signal.tier === "PRO"
                                                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                                        : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                                }`}>
                                                    {signal.tier || "FREE"}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-muted-foreground">{signal.timeframe}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1 font-semibold ${
                                                    signal.direction === "BUY" ? "text-emerald-400" : "text-rose-400"
                                                }`}>
                                                    {signal.direction === "BUY" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                                    {signal.direction}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-foreground">{signal.entry}</td>
                                            <td className="px-4 py-3 text-right font-mono text-red-400">{signal.stopLoss}</td>
                                            <td className="px-4 py-3 text-right font-mono text-emerald-400">{signal.tp1}</td>
                                            <td className="px-4 py-3 text-right font-bold text-foreground">{signal.confidence}%</td>
                                            <td className="px-4 py-3 text-center">
                                                {resultBadge(signal.result || "PENDING", Number(signal.resultR || 0))}
                                            </td>
                                            <td className={`px-4 py-3 text-right font-mono font-bold ${
                                                (signal.resultR || 0) >= 0 ? "text-emerald-400" : "text-red-400"
                                            }`}>
                                                {signal.result === "PENDING" ? "—" : `${Number(signal.resultR || 0) > 0 ? "+" : ""}${Number(signal.resultR || 0).toFixed(2)}R`}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-muted-foreground">{signal.status}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <p className="mt-6 text-center text-[10px] leading-relaxed text-muted-foreground">
                    AI trading signals are analytical tools and are not guaranteed to be profitable. Past performance does not guarantee future results. Trading involves substantial risk of loss.
                </p>
            </div>
        </div>
    );
}