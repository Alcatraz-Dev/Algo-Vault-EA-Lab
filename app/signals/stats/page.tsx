"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    BarChart3,
    Calendar,
    ChevronDown,
    History,
    Loader2,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { AISignal, SignalStats } from "@/lib/ai-signals/types";
import AreaTrendChart from "@/components/charts/AreaTrendChart";
import BarCompareChart from "@/components/charts/BarCompareChart";

type Period = "today" | "week" | "month" | "last7" | "last30" | "last90" | "all";

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
    { label: "Today", value: "today" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
    { label: "Last 7 Days", value: "last7" },
    { label: "Last 30 Days", value: "last30" },
    { label: "Last 90 Days", value: "last90" },
    { label: "All Time", value: "all" },
];

function signClass(value: number) {
    return value >= 0 ? "text-emerald-400" : "text-red-400";
}

export default function SignalStatsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [stats, setStats] = useState<SignalStats | null>(null);
    const [signals, setSignals] = useState<AISignal[]>([]);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<Period>("last30");
    const [periodOpen, setPeriodOpen] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;

        async function load() {
            try {
                const token = await user!.getIdToken(true);
                setLoading(true);
                const headers = { Authorization: `Bearer ${token}` };

                const statsRes = await fetch(`/api/signals/stats?period=${period}`, { headers });
                const statsData = await statsRes.json();
                if (statsData.stats) setStats(statsData.stats);

                const historyRes = await fetch(`/api/signals/history?period=${period}&limit=300`, { headers });
                const historyData = await historyRes.json();
                if (historyData.signals) setSignals(historyData.signals);
            } catch (err) {
                console.error("Failed to fetch signal stats:", err);
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [user, period]);

    const chartData = useMemo(() => {
        const byDay = new Map<string, { label: string; signals: number; wins: number; losses: number; cumulativeR: number }>();

        for (const signal of [...signals].sort((a, b) => a.createdAt - b.createdAt)) {
            const day = new Date(signal.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const entry = byDay.get(day) || { label: day, signals: 0, wins: 0, losses: 0, cumulativeR: 0 };
            entry.signals += 1;
            if (signal.result === "WIN") entry.wins += 1;
            if (signal.result === "LOSS") entry.losses += 1;
            entry.cumulativeR += Number(signal.resultR || 0);
            byDay.set(day, entry);
        }

        let running = 0;
        return [...byDay.values()].map((entry) => {
            running += entry.cumulativeR;
            return { ...entry, cumulativeR: running };
        });
    }, [signals]);

    const outcomeCounts = useMemo(() => {
        return [
            { label: "Wins", count: signals.filter((s) => s.result === "WIN").length },
            { label: "Losses", count: signals.filter((s) => s.result === "LOSS").length },
            { label: "Breakeven", count: signals.filter((s) => s.result === "BREAKEVEN").length },
            { label: "Expired", count: signals.filter((s) => s.result === "EXPIRED").length },
            { label: "Cancelled", count: signals.filter((s) => s.result === "CANCELLED").length },
        ];
    }, [signals]);

    if (!user) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const statCards = [
        { label: "Total Signals", value: stats?.totalSignals ?? 0, suffix: "", cls: "text-foreground" },
        { label: "Win Rate", value: stats?.winRate ?? 0, suffix: "%", cls: "text-emerald-400" },
        { label: "Total R", value: stats?.totalR ?? 0, suffix: "R", cls: signClass(stats?.totalR || 0) },
        { label: "Avg R", value: stats?.averageR ?? 0, suffix: "R", cls: signClass(stats?.averageR || 0) },
        { label: "Profit Factor", value: stats?.profitFactor ?? 0, suffix: "", cls: "text-foreground" },
        { label: "Max Drawdown", value: stats?.maxDrawdown ?? 0, suffix: "R", cls: "text-red-400" },
    ];

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>

            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/signals" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
                    <ArrowLeft size={16} />
                    Back to Signals
                </Link>

                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between" data-guide="page-header">
                    <div>
                        <div className="flex items-center gap-2 text-sm text-amber-400 font-medium">
                            <BarChart3 className="h-4 w-4" />
                            Signal Performance
                        </div>
                        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Statistics</h1>
                        <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                            Win rates, R performance, profit factor, streaks and target hit rates — computed from every recorded signal, FREE and PRO separately on the server.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <button
                                onClick={() => setPeriodOpen(!periodOpen)}
                                className="flex h-9 items-center gap-1.5 rounded-xl border border-border/30 bg-card/40 px-3 text-xs text-muted-foreground transition-colors hover:border-border/50 hover:text-foreground"
                            >
                                <Calendar size={13} />
                                {PERIOD_OPTIONS.find((o) => o.value === period)?.label}
                                <ChevronDown size={13} />
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
                        <Link
                            href="/signals/history"
                            className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 text-xs font-medium text-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                        >
                            <History className="h-3.5 w-3.5" />
                            History
                        </Link>
                    </div>
                </div>

                {loading ? (
                    <div className="mt-8 rounded-2xl border border-border/30 bg-card/60 p-20 text-center backdrop-blur-xl">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">Computing statistics...</p>
                    </div>
                ) : (
                    <>
                        {/* SUMMARY CARDS */}
                        <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-guide="stats">
                            {statCards.map((card) => (
                                <div key={card.label} className="rounded-xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{card.label}</p>
                                    <p className={`mt-1.5 text-2xl font-black ${card.cls}`}>
                                        {card.value > 0 && card.suffix === "R" ? "+" : ""}
                                        {Number(card.value || 0).toFixed(card.label.includes("Rate") ? 1 : 2)}
                                        {card.suffix}
                                    </p>
                                </div>
                            ))}
                        </div>

                        {/* CHARTS */}
                        <div className="mt-8 grid gap-6 lg:grid-cols-2">
                            <div className="rounded-2xl border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                                <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Signals per Day
                                </h3>
                                <BarCompareChart
                                    data={chartData}
                                    xKey="label"
                                    valueKey="signals"
                                    colorVar="#f59e0b"
                                />
                            </div>

                            <div className="rounded-2xl border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                                <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Cumulative R
                                </h3>
                                <AreaTrendChart
                                    data={chartData}
                                    xKey="label"
                                    series={[{ key: "cumulativeR", label: "Cumulative R", colorVar: "#10b981" }]}
                                />
                            </div>

                            <div className="rounded-2xl border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                                <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Wins vs Losses
                                </h3>
                                <BarCompareChart
                                    data={outcomeCounts}
                                    xKey="label"
                                    valueKey="count"
                                    colorVar="#3b82f6"
                                    cellColors={(entry) =>
                                        entry.label === "Wins"
                                            ? "#10b981"
                                            : entry.label === "Losses"
                                            ? "#ef4444"
                                            : entry.label === "Breakeven"
                                            ? "#a1a1aa"
                                            : "#f59e0b"
                                    }
                                />
                            </div>

                            <div className="rounded-2xl border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                                <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Target Hit Rates
                                </h3>
                                <div className="space-y-4 pt-2">
                                    {[
                                        { label: "TP1", value: stats?.tp1HitRate ?? 0, color: "bg-emerald-500" },
                                        { label: "TP2", value: stats?.tp2HitRate ?? 0, color: "bg-blue-500" },
                                        { label: "TP3", value: stats?.tp3HitRate ?? 0, color: "bg-indigo-500" },
                                    ].map((row) => (
                                        <div key={row.label}>
                                            <div className="mb-1 flex items-center justify-between text-xs">
                                                <span className="text-muted-foreground">{row.label}</span>
                                                <span className="font-bold text-foreground">{row.value.toFixed(1)}%</span>
                                            </div>
                                            <div className="h-2 w-full overflow-hidden rounded-full bg-border">
                                                <div
                                                    className={`h-full rounded-full ${row.color}`}
                                                    style={{ width: `${Math.min(row.value, 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border/10 pt-4">
                                    <div>
                                        <p className="text-[10px] text-muted-foreground uppercase">Avg Strength</p>
                                        <p className="mt-1 text-lg font-black text-foreground">
                                            {stats?.averageSignalStrength?.toFixed(1) ?? "—"}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-muted-foreground uppercase">Signal Strength</p>
                                        <p className="mt-1 text-lg font-black text-foreground">
                                            {stats?.averageSignalStrength ? "on 0–100 scale" : "—"}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* EXTENDED METRICS */}
                        <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                            {[
                                { label: "Largest Win", value: stats?.largestWin ?? 0, cls: "text-emerald-400" },
                                { label: "Largest Loss", value: stats?.largestLoss ?? 0, cls: "text-red-400" },
                                { label: "Max Win Streak", value: stats?.maxWinningStreak ?? 0, cls: "text-emerald-400" },
                                { label: "Max Loss Streak", value: stats?.maxLosingStreak ?? 0, cls: "text-red-400" },
                                { label: "Avg Win", value: stats?.averageWin ?? 0, cls: "text-emerald-400" },
                                { label: "Avg Loss", value: stats?.averageLoss ?? 0, cls: "text-red-400" },
                            ].map((card) => (
                                <div key={card.label} className="rounded-xl border border-border/30 bg-card/60 p-4 text-center backdrop-blur-xl">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{card.label}</p>
                                    <p className={`mt-1 text-lg font-black ${card.cls}`}>
                                        {Number(card.value || 0).toFixed(2)}
                                    </p>
                                </div>
                            ))}
                        </div>

                        <p className="mt-8 text-center text-[10px] leading-relaxed text-muted-foreground">
                            AI trading signals are analytical tools and are not guaranteed to be profitable. Past performance does not guarantee future results. Trading involves substantial risk of loss.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}