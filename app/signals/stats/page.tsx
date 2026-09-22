"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Activity,
    ArrowLeft,
    BarChart3,
    History,
    Loader2,
    Radio,
    Sparkles,
    Target,
    TrendingDown,
    TrendingUp,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { equalTo, onValue, orderByChild, query, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import SignalFeed from "@/components/signals/SignalFeed";
import MarketOverview from "@/components/signals/MarketOverview";
import ProGate from "@/components/subscription/ProGate";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import AreaTrendChart from "@/components/charts/AreaTrendChart";
import BarCompareChart from "@/components/charts/BarCompareChart";
import SignalAnalyticsDashboard from "@/components/signals/SignalAnalyticsDashboard";
import type { AISignal, MarketSentiment, SignalAnalytics } from "@/lib/ai-signals/types";

const FREE_LIMIT = 3;
const PRO_LIMIT = 10;

function getDayKey(timestamp: number) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function formatDay(timestamp: number) {
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    }).format(new Date(timestamp));
}

function formatTimestamp(timestamp: number) {
    if (!Number.isFinite(timestamp)) return "unknown time";
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
    }).format(new Date(timestamp));
}

function formatR(value: number | null | undefined, signed = false) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    const sign = signed && value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toFixed(2)}R`;
}

type ChartPoint = {
    key: string;
    label: string;
    signals: number;
    wins: number;
    losses: number;
    cumulativeR: number;
};

export default function SignalStatsPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [hasPro, setHasPro] = useState(false);
    const [signals, setSignals] = useState<AISignal[]>([]);
    const [analytics, setAnalytics] = useState<SignalAnalytics | null>(null);
    const [sentiments, setSentiments] = useState<MarketSentiment[]>([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [activeTab, setActiveTab] = useState<"live" | "stats">("stats");
    const [dailyCount, setDailyCount] = useState(0);
    const signalsCountRef = useRef(0);
    const dailyCountRef = useRef(0);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthReady(true);
            if (!u) {
                setSignals([]);
                setAnalytics(null);
                setSentiments([]);
                setDailyCount(0);
                dailyCountRef.current = 0;
                setLoading(false);
            }
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;
        const checkSubscription = async () => {
            try {
                const token = await user.getIdToken();
                const res = await fetch("/api/subscription-status", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                setHasPro(Boolean(data.hasSubscription));
            } catch {
                setHasPro(false);
            }
        };
        checkSubscription();
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const startOfDay = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").getTime();
        const endOfDay = startOfDay + 86_400_000;
        const usageQuery = query(ref(database, "aiSignals"), orderByChild("createdFor"), equalTo(user.uid));
        const unsub = onValue(usageQuery, (snapshot) => {
            let count = 0;
            snapshot.forEach((child) => {
                const signal = child.val() as { createdAt?: unknown };
                const createdAt = Number(signal.createdAt);
                if (Number.isFinite(createdAt) && createdAt >= startOfDay && createdAt < endOfDay) count++;
            });
            setDailyCount(count);
            dailyCountRef.current = count;
        });
        return () => unsub();
    }, [user]);

    async function getAuthHeaders(): Promise<Record<string, string>> {
        if (!user) return {};
        const token = await user.getIdToken(/* forceRefresh */ true);
        return { Authorization: `Bearer ${token}` };
    }

    async function fetchSignals() {
        try {
            const res = await fetch("/api/ai-signals", {
                headers: await getAuthHeaders(),
            });
            const data = await res.json();
            if (data.signals) {
                setSignals(data.signals);
                signalsCountRef.current = data.signals.length;
            }
            if (data.dailyCount != null) {
                setDailyCount(data.dailyCount);
                dailyCountRef.current = data.dailyCount;
            }
        } catch (err) {
            console.error("Failed to fetch signals:", err);
        }
    }

    async function fetchAnalytics() {
        try {
            const res = await fetch("/api/ai-signals/analytics", {
                headers: await getAuthHeaders(),
            });
            const data = await res.json();
            if (data.analytics) {
                setAnalytics(data.analytics);
            }
            if (data.sentiments) {
                setSentiments(data.sentiments);
            }
        } catch (err) {
            console.error("Failed to fetch analytics:", err);
        }
    }

    async function handleScan() {
        setScanning(true);
        try {
            const res = await fetch("/api/ai-signals", {
                method: "POST",
                headers: await getAuthHeaders(),
            });
            const data = await res.json();
            if (data.dailyCount != null) {
                setDailyCount(data.dailyCount);
                dailyCountRef.current = data.dailyCount;
            }
            await fetchSignals();
            await fetchAnalytics();
        } catch (err) {
            console.error("Scan failed:", err);
        } finally {
            setScanning(false);
        }
    }

    useEffect(() => {
        if (!user) return;
        const maybeAutoScan = async () => {
            if (signalsCountRef.current > 0) return;
            if (dailyCountRef.current >= FREE_LIMIT) return;
            const key = `signals_autoscan_${user.uid}`;
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, "1");
            await handleScan();
        };
        (async () => {
            await Promise.allSettled([fetchSignals(), fetchAnalytics()]);
            setLoading(false);
            await maybeAutoScan();
        })();
     }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!user) return;
        const interval = setInterval(() => {
            void Promise.allSettled([fetchSignals(), fetchAnalytics()]);
        }, 60_000);
        return () => clearInterval(interval);
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    const chartData = useMemo<ChartPoint[]>(() => {
        const byDay = new Map<string, ChartPoint>();
        const ordered = [...signals].sort((a, b) => Number(a.createdAt) - Number(b.createdAt));

        for (const signal of ordered) {
            const createdAt = Number(signal.createdAt);
            if (!Number.isFinite(createdAt)) continue;
            const key = getDayKey(createdAt);
            const entry = byDay.get(key) || {
                key,
                label: formatDay(createdAt),
                signals: 0,
                wins: 0,
                losses: 0,
                cumulativeR: 0,
            };

            entry.signals += 1;
            if (signal.result === "WIN") entry.wins += 1;
            if (signal.result === "LOSS") entry.losses += 1;
            const resultR = Number(signal.resultR || 0);
            if (signal.result === "WIN" || signal.result === "LOSS" || signal.result === "BREAKEVEN") {
                entry.cumulativeR += resultR;
            }
            byDay.set(key, entry);
        }

        let running = 0;
        return [...byDay.values()].map((entry) => {
            running += entry.cumulativeR;
            return { ...entry, cumulativeR: running };
        });
    }, [signals]);

    const recentSignals = useMemo(
        () => [...signals]
            .filter((s) => s.result && s.result !== "PENDING")
            .sort((a, b) => Number(b.completedAt || b.createdAt) - Number(a.completedAt || a.createdAt))
            .slice(0, 6),
        [signals],
    );

    const proFeedSignals = useMemo(() => signals.filter((s) => s.tier === "PRO"), [signals]);

    const dailyLimit = hasPro ? PRO_LIMIT : FREE_LIMIT;
    const limitReached = dailyCount >= dailyLimit;

    const tabs = [
        { key: "live" as const, label: "Live Feed" },
        { key: "stats" as const, label: "Statistics" },
    ];

    if (!authReady) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading statistics</p>
                </div>
            </main>
        );
    }

    if (!user) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <EmptyState
                    icon={<Zap className="h-5 w-5" />}
                    title="Sign in to view signal statistics"
                    description="Statistics are calculated from the signals available to your account."
                    action={
                        <Link href="/login">
                            <Button>Sign in</Button>
                        </Link>
                    }
                />
            </main>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            {/* BACKGROUND GRADIENT GLOWS */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>

            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                {/* HEADER */}
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between" data-guide="page-header">
                    <div>
                        <Link
                            href="/account"
                            className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                        >
                            <ArrowLeft size={16} />
                            Back to Account
                        </Link>

                        <div className="flex items-center gap-2 text-sm text-amber-400 font-medium">
                            <Sparkles className="h-4 w-4" />
                            Performance Analytics
                        </div>

                        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
                            Signal Statistics
                        </h1>

                        <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                            Real-time performance metrics, historical outcomes, and analytical insights across all recorded signals.
                        </p>
                    </div>

                    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:gap-3 sm:pb-0 scrollbar-none">
                        <Link
                            href="/signals/pro"
                            className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 sm:gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/20"
                        >
                            <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-400 fill-amber-400" />
                            <span>Pro Signals</span>
                        </Link>

                        <button
                            type="button"
                            onClick={handleScan}
                            disabled={scanning}
                            data-guide="scan"
                            className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 sm:gap-2 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium text-foreground transition-colors hover:bg-muted/10"
                        >
                            {scanning ? (
                                <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
                            ) : (
                                <Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            )}
                            <span>{scanning ? "Scanning..." : "Refresh Data"}</span>
                        </button>

                        <Link
                            href="/live"
                            className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 sm:gap-2 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium text-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                        >
                            <Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-400" />
                            <span>Live Performance</span>
                        </Link>

                        <Link
                            href="/signals/history"
                            className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 sm:gap-2 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium text-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                        >
                            <History className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-400" />
                            <span>History</span>
                        </Link>
                    </div>
                </div>

                {/* TAB NAVIGATION */}
                <div className="mt-6 flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border/30 bg-background p-1 scrollbar-none">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                                activeTab === tab.key
                                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {tab.key === "stats" ? <BarChart3 className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* DAILY LIMIT INDICATOR */}
                <div className="mt-6 rounded-2xl border border-border/30 bg-linear-to-br from-background/80 via-background/40 to-background/80 p-4 backdrop-blur-xl" data-guide="daily-limit">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-card">
                                <BarChart3 className="h-5 w-5 text-amber-400" />
                            </div>
                            <div>
                                <p className="text-xs font-medium text-muted-foreground">Daily Signal Usage</p>
                                <p className="text-sm font-bold text-foreground">
                                    {dailyCount} / {dailyLimit} signals used today
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="h-2 w-40 overflow-hidden rounded-full bg-border">
                                <div
                                    className={`h-full rounded-full transition-all ${
                                        limitReached ? "bg-red-500" : "bg-amber-500"
                                    }`}
                                    style={{ width: `${Math.min((dailyCount / dailyLimit) * 100, 100)}%` }}
                                />
                            </div>
                            <span className="text-xs font-semibold text-muted-foreground">
                                {limitReached ? "Limit Reached" : `${dailyLimit - dailyCount} remaining`}
                            </span>
                        </div>
                    </div>
                </div>

                {/* PRO UPGRADE PROMPT */}
                {limitReached && (
                    <ProGate>
                        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20">
                                        <Zap className="h-5 w-5 text-amber-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-foreground">Unlock More Signals</h3>
                                        <p className="text-xs text-muted-foreground">
                                            Upgrade to Pro for {PRO_LIMIT} signals per day, priority alerts, and advanced analytics.
                                        </p>
                                    </div>
                                </div>
                                <Link
                                    href="/pricing"
                                    className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:bg-amber-400 shadow-lg shadow-amber-500/20 whitespace-nowrap shrink-0"
                                >
                                    <Zap className="h-3.5 w-3.5 fill-black" />
                                    Upgrade to Pro
                                </Link>
                            </div>
                        </div>
                    </ProGate>
                )}

                {activeTab === "stats" ? (
                    <>
                        {/* MARKET OVERVIEW */}
                        <div className="mt-8">
                            <div className="mb-4 flex items-center gap-2">
                                <Radio className="h-4 w-4 text-amber-400" />
                                <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Market Overview</h2>
                            </div>
                            {sentiments.length > 0 ? (
                                <MarketOverview sentiments={sentiments} />
                            ) : (
                                <div className="rounded-2xl border border-border/30 bg-card/60 p-8 text-center backdrop-blur-xl">
                                    <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">Market overview data loading...</p>
                                </div>
                            )}
                        </div>

                        {/* ANALYTICS DASHBOARD */}
                        {analytics && (
                            <div className="mt-10">
                                <SignalAnalyticsDashboard analytics={analytics} />
                            </div>
                        )}

                        {/* CHARTS SECTION */}
                        {signals.length > 0 && (
                            <div className="mt-10 grid gap-5 lg:grid-cols-2">
                                <div className="rounded-2xl border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                                    <div className="mb-4 flex items-center gap-2">
                                        <TrendingUp className="h-4 w-4 text-amber-400" />
                                        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Signals by Day</h2>
                                        <span className="rounded-md border border-border/30 bg-muted/5 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                            {chartData.length} days
                                        </span>
                                    </div>
                                    {chartData.length > 0 ? (
                                        <BarCompareChart
                                            data={chartData}
                                            xKey="label"
                                            valueKey="signals"
                                            colorVar="var(--chart-1)"
                                            height={260}
                                            formatValue={(value) => Math.round(value).toLocaleString()}
                                        />
                                    ) : (
                                        <div className="rounded-xl border border-border/30 p-8 text-center">
                                            <p className="text-sm text-muted-foreground">No signal activity yet</p>
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-2xl border border-border/30 bg-card/60 p-5 backdrop-blur-xl">
                                    <div className="mb-4 flex items-center gap-2">
                                        <TrendingDown className="h-4 w-4 text-emerald-400" />
                                        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Cumulative R</h2>
                                    </div>
                                    {chartData.length > 0 ? (
                                        <AreaTrendChart
                                            data={chartData}
                                            xKey="label"
                                            series={[{
                                                key: "cumulativeR",
                                                label: "Cumulative R",
                                                colorVar: "var(--positive)",
                                            }]}
                                            height={260}
                                            formatXAxis={(value) => String(value)}
                                        />
                                    ) : (
                                        <div className="rounded-xl border border-border/30 p-8 text-center">
                                            <p className="text-sm text-muted-foreground">No resolved results yet</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* RECENT RESOLVED SIGNALS TABLE */}
                        <div className="mt-10">
                            <div className="mb-4 flex items-center gap-2">
                                <Target className="h-4 w-4 text-amber-400" />
                                <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Recent Resolved Signals</h2>
                                <span className="rounded-md border border-border/30 bg-muted/5 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                    {recentSignals.length} latest
                                </span>
                            </div>

                            {loading ? (
                                <div className="rounded-2xl border border-border/30 bg-card/60 p-8 backdrop-blur-xl">
                                    <LoadingState label="Loading signal statistics" rows={4} />
                                </div>
                            ) : recentSignals.length > 0 ? (
                                <div className="rounded-2xl border border-border/30 bg-card/60 p-5 backdrop-blur-xl overflow-x-auto">
                                    <table className="w-full min-w-[720px] text-xs">
                                        <thead>
                                            <tr className="border-b border-border text-left text-muted-foreground">
                                                <th className="pb-3 pr-4 font-medium">Symbol</th>
                                                <th className="pb-3 pr-4 font-medium">Timeframe</th>
                                                <th className="pb-3 pr-4 font-medium">Direction</th>
                                                <th className="pb-3 pr-4 font-medium">Status</th>
                                                <th className="pb-3 pr-4 text-right font-medium">Result R</th>
                                                <th className="pb-3 text-right font-medium">Completed</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {recentSignals.map((signal) => (
                                                <tr key={signal.id} className="border-b border-border/20 last:border-0 hover:bg-muted/40">
                                                    <td className="py-3 pr-4 font-semibold text-foreground">{signal.symbol}</td>
                                                    <td className="py-3 pr-4 font-mono text-muted-foreground">{signal.timeframe}</td>
                                                    <td className={`py-3 pr-4 font-semibold ${signal.direction === "BUY" ? "text-positive" : "text-negative"}`}>
                                                        <span className="inline-flex items-center gap-1.5">
                                                            {signal.direction === "BUY" ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                                                            {signal.direction}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 pr-4">
                                                        {signal.status}
                                                    </td>
                                                    <td className={`py-3 pr-4 text-right font-mono font-semibold tabular-nums ${(signal.resultR || 0) >= 0 ? "text-positive" : "text-negative"}`}>
                                                        {formatR(Number(signal.resultR || 0), (signal.resultR || 0) > 0)}
                                                    </td>
                                                    <td className="py-3 text-right font-mono text-muted-foreground tabular-nums">
                                                        {formatTimestamp(Number(signal.completedAt || signal.createdAt))}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-border/30 bg-card/60 p-8 text-center backdrop-blur-xl">
                                    <Target className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">No resolved signals yet</p>
                                </div>
                            )}
                        </div>

                        {/* LIVE PRO SIGNALS FEED */}
                        {hasPro && proFeedSignals.length > 0 && (
                            <div className="mt-10">
                                <div className="mb-4 flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-amber-400" />
                                    <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Live Pro Signals</h2>
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        Live
                                    </span>
                                </div>
                                <SignalFeed
                                    signals={proFeedSignals}
                                    loading={scanning}
                                    onView={(signal) => router.push(`/signals/pro/${signal.id}`)}
                                />
                            </div>
                        )}

                        {/* FINANCIAL DISCLAIMER */}
                        <p className="mt-6 text-center text-[10px] leading-relaxed text-muted-foreground">
                            AI trading signals are analytical tools and are not guaranteed to be profitable. Past performance does not guarantee future results. Trading involves substantial risk of loss.
                        </p>
                    </>
                ) : (
                    <>
                        {/* LIVE PRO SIGNALS */}
                        <div className="mt-8">
                            <div className="mb-4 flex items-center gap-2">
                                <Zap className="h-4 w-4 text-amber-400" />
                                <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Live Pro Signals</h2>
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    Live
                                </span>
                            </div>
                            {hasPro ? (
                                <>
                                    {proFeedSignals.length > 0 ? (
                                        <SignalFeed
                                            signals={proFeedSignals}
                                            loading={scanning}
                                            onView={(signal) => router.push(`/signals/pro/${signal.id}`)}
                                        />
                                    ) : (
                                        <div className="rounded-2xl border border-border/30 bg-card/60 p-8 text-center backdrop-blur-xl">
                                            <Radio className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                                            <p className="text-sm text-muted-foreground">No live Pro signals yet</p>
                                            <p className="text-xs text-muted-foreground mt-1">Signals will appear here when detected</p>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-10 text-center backdrop-blur-xl">
                                    <Zap className="mx-auto mb-3 h-8 w-8 text-amber-400" />
                                    <h3 className="text-sm font-bold text-foreground">Pro Signals Locked</h3>
                                    <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                                        M1 precision signals with real-time entry, SL, TP levels, strength scores, and full reasoning — available with a Pro subscription.
                                    </p>
                                    <Link
                                        href="/pricing"
                                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:bg-amber-400 shadow-lg shadow-amber-500/20"
                                    >
                                        <Zap className="h-3.5 w-3.5 fill-black" />
                                        Upgrade to Pro
                                    </Link>
                                </div>
                            )}
                        </div>

                        {/* PRO ANALYTICS */}
                        {hasPro && analytics && (
                            <div className="mt-10">
                                <div className="mb-4 flex items-center gap-2">
                                    <BarChart3 className="h-4 w-4 text-amber-400" />
                                    <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Pro Analytics</h2>
                                </div>
                                <SignalAnalyticsDashboard analytics={analytics} />
                            </div>
                        )}

                        {/* FINANCIAL DISCLAIMER */}
                        <p className="mt-6 text-center text-[10px] leading-relaxed text-muted-foreground">
                            AI trading signals are analytical tools and are not guaranteed to be profitable. Past performance does not guarantee future results. Trading involves substantial risk of loss.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
