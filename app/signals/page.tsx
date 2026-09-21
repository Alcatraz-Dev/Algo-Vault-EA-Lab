"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Activity,
    ArrowLeft,
    BarChart3,
    CheckCircle2,
    CircleDollarSign,
    Globe,
    History,
    Layers,
    Loader2,
    Lock,
    Radar,
    Radio,
    ShieldCheck,
    Sparkles,
    Target,
    TrendingDown,
    TrendingUp,
    Zap,
} from "lucide-react";

import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";

import SignalFeed from "@/components/signals/SignalFeed";
import MarketOverview from "@/components/signals/MarketOverview";
import ProGate from "@/components/subscription/ProGate";
import type { AISignal, MarketSentiment, SignalAnalytics } from "@/lib/ai-signals/types";

const FREE_LIMIT = 3;
const PRO_LIMIT = 10;

export default function AiSignalsPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [hasPro, setHasPro] = useState(false);
    const [signals, setSignals] = useState<AISignal[]>([]);
    const [analytics, setAnalytics] = useState<SignalAnalytics | null>(null);
    const [sentiments, setSentiments] = useState<MarketSentiment[]>([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [dailyCount, setDailyCount] = useState(0);
    const [activeTab, setActiveTab] = useState<"all" | "active" | "ready" | "forming">("all");
    const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
    const signalsCountRef = useRef(0);
    const dailyCountRef = useRef(0);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (!u) {
                setSignals([]);
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

    function handleFollow(signalId: string) {
        setFollowedIds((prev) => {
            const next = new Set(prev);
            if (next.has(signalId)) {
                next.delete(signalId);
            } else {
                next.add(signalId);
            }
            return next;
        });
    }

    async function handleTrade(signal: AISignal) {
        try {
            const token = await user?.getIdToken();
            const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
            const res = await fetch("/api/signals/execute", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    signalId: signal.id,
                    symbol: signal.symbol,
                    direction: signal.direction,
                    entryPrice: signal.entry,
                    stopLoss: signal.stopLoss,
                    takeProfit: signal.tp1,
                    mt5Account: "default",
                }),
            });
            const data = await res.json();
            if (!data.success) {
                console.error("Trade execution failed:", data.error);
            }
        } catch (err) {
            console.error("Trade execution error:", err);
        }
    }

    async function handleComplete(signal: AISignal) {
        if (!confirm(`Complete this signal on ${signal.symbol} (${signal.direction})?`)) return;
        try {
            const token = await user?.getIdToken();
            const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
            const res = await fetch("/api/signals/complete", {
                method: "POST",
                headers,
                body: JSON.stringify({ signalId: signal.id }),
            });
            const data = await res.json();
            if (data.success) {
                setSignals((prev) =>
                    prev.map((s) =>
                        s.id === signal.id
                            ? { ...s, status: "COMPLETED" as const, result: data.result, resultR: data.resultR }
                            : s
                    )
                );
            } else {
                console.error("Complete failed:", data.error);
            }
        } catch (err) {
            console.error("Complete error:", err);
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

    const topSignals = useMemo(() => {
        return [...signals]
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 3);
    }, [signals]);

    const filteredSignals = useMemo(() => {
        if (activeTab === "all") return signals;
        return signals.filter((s) => s.status === activeTab.toUpperCase());
    }, [signals, activeTab]);

    const freeSignals = useMemo(
        () => filteredSignals.filter((s) => s.tier === "FREE"),
        [filteredSignals]
    );

    const proSignals = useMemo(
        () => filteredSignals.filter((s) => s.tier === "PRO"),
        [filteredSignals]
    );

    const dailyLimit = hasPro ? PRO_LIMIT : FREE_LIMIT;
    const limitReached = dailyCount >= dailyLimit;

    const tabs = [
        { key: "all" as const, label: "All Signals", count: signals.length },
        { key: "active" as const, label: "Active", count: signals.filter((s) => s.status === "ACTIVE").length },
        { key: "ready" as const, label: "Ready", count: signals.filter((s) => s.status === "READY").length },
        { key: "forming" as const, label: "Forming", count: signals.filter((s) => s.status === "FORMING").length },
    ];

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
                            Multi-Asset AI Signal Engine
                        </div>

                        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
                            Live AI Signals
                        </h1>

                        <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                            Real-time institutional-grade trading signals across forex, gold, indices, and crypto. Powered by multi-factor confidence scoring.
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
                                <Radar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            )}
                            <span>{scanning ? "Scanning..." : "Scan for Signals"}</span>
                        </button>

                        <Link
                            href="/live"
                            className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 sm:gap-2 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium text-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                        >
                            <Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-400" />
                            <span>Live Performance</span>
                        </Link>

                        <Link
                            href="/signals/stats"
                            className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 sm:gap-2 rounded-xl border border-border/30 bg-muted/5 px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium text-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                        >
                            <BarChart3 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-400" />
                            <span>Statistics</span>
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

                {/* DAILY LIMIT INDICATOR */}
                <div className="mt-6 rounded-2xl border border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 p-4 backdrop-blur-xl" data-guide="daily-limit">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-card">
                                <CircleDollarSign className="h-5 w-5 text-amber-400" />
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
                                        <Lock className="h-5 w-5 text-amber-400" />
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

                {/* MARKET OVERVIEW */}
                <div className="mt-8">
                    <div className="mb-4 flex items-center gap-2">
                        <Globe className="h-4 w-4 text-amber-400" />
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

                {/* TOP OPPORTUNITIES */}
                {topSignals.length > 0 && (
                    <div className="mt-10">
                        <div className="mb-5 flex items-center gap-2">
                            <Target className="h-4 w-4 text-amber-400" />
                            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
                                Top Opportunities
                            </h2>
                            <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                                Highest Confidence
                            </span>
                        </div>

                        <div className="grid gap-5 md:grid-cols-3" data-guide="top-signals">
                            {topSignals.map((signal, idx) => (
                                <div
                                    key={signal.id}
                                    className="relative rounded-2xl border border-border/30 bg-linear-to-br from-background/80 via-background/40 to-background/80 p-5 backdrop-blur-xl transition-all hover:border-border/50"
                                >
                                    <div className="absolute -top-3 -left-3 flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-[11px] font-black text-foreground shadow-lg shadow-amber-500/30">
                                        #{idx + 1}
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold ${
                                                    signal.direction === "BUY"
                                                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                                                        : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                                                }`}
                                            >
                                                {signal.direction === "BUY" ? (
                                                    <TrendingUp className="h-5 w-5" />
                                                ) : (
                                                    <TrendingDown className="h-5 w-5" />
                                                )}
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-foreground">{signal.symbol}</h3>
                                                <p className="text-xs text-muted-foreground">{signal.timeframe} · {signal.category}</p>
                                            </div>
                                        </div>
                                        <span
                                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                                signal.direction === "BUY"
                                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                                    : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                                            }`}
                                        >
                                            {signal.direction}
                                        </span>
                                    </div>

                                    <div className="mt-4 flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
                                            <Sparkles className="h-3.5 w-3.5" />
                                            <span>{signal.confidence}% Confidence</span>
                                        </div>
                                        <span className="font-mono text-muted-foreground">R:R {signal.riskReward.toFixed(1)}</span>
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-border/30 p-3 text-xs">
                                        <div>
                                            <span className="text-muted-foreground block text-[10px]">Entry</span>
                                            <span className="font-mono font-bold text-foreground">{signal.entry}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground block text-[10px]">Stop Loss</span>
                                            <span className="font-mono font-bold text-rose-400">{signal.stopLoss}</span>
                                        </div>
                                        {signal.tp1 && (
                                            <div className="mt-1">
                                                <span className="text-muted-foreground block text-[10px]">TP1</span>
                                                <span className="font-mono font-bold text-emerald-400">{signal.tp1}</span>
                                            </div>
                                        )}
                                        {signal.tp2 && (
                                            <div className="mt-1">
                                                <span className="text-muted-foreground block text-[10px]">TP2</span>
                                                <span className="font-mono font-bold text-emerald-400">{signal.tp2}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* SIGNAL FEED — FREE + PRO SECTIONS */}
                <div className="mt-10">
                    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                            <Radio className="h-4 w-4 text-amber-400" />
                            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Signal Feed</h2>
                            <span className="rounded-md border border-border/30 bg-muted/5 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                {signals.length} signals
                            </span>
                        </div>

                        {/* TABS */}
                        <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border/30 bg-background p-1 scrollbar-none" data-guide="tabs">
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
                                    <span>{tab.label}</span>
                                    {tab.count > 0 && (
                                        <span className="ml-0.5 rounded-full bg-muted/10 px-1.5 py-0.5 text-[10px]">
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {loading ? (
                        <div className="rounded-2xl border border-border/30 bg-card/60 p-16 text-center backdrop-blur-xl">
                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-3" />
                            <p className="text-sm text-muted-foreground">Loading signals...</p>
                        </div>
                    ) : (
                        <>
                            {/* FREE SECTION — M5/M15 */}
                            <div className="mb-8">
                                <div className="mb-3 flex items-center gap-2">
                                    <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">FREE</span>
                                    <span className="text-xs text-muted-foreground">M5 · M15 signals</span>
                                    <span className="rounded-full bg-muted/10 px-2 py-0.5 text-[10px] text-muted-foreground">{freeSignals.length}</span>
                                </div>
                                <SignalFeed signals={freeSignals} loading={scanning} onView={(signal) => router.push(`/signals/${signal.id}`)} onFollow={handleFollow} onTrade={handleTrade} onComplete={handleComplete} followedIds={followedIds} />
                            </div>

                            {/* PRO SECTION — M1 */}
                            <div className="relative mb-8">
                                <div className="mb-3 flex items-center gap-2">
                                    <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">PRO</span>
                                    <span className="text-xs text-muted-foreground">M1 precision signals — Pro only</span>
                                    <span className="rounded-full bg-muted/10 px-2 py-0.5 text-[10px] text-muted-foreground">{proSignals.length}</span>
                                </div>

                                {hasPro ? (
                                    <SignalFeed signals={proSignals} loading={scanning} onView={(signal) => router.push(`/signals/${signal.id}`)} onFollow={handleFollow} onTrade={handleTrade} onComplete={handleComplete} followedIds={followedIds} />
                                ) : (
                                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-10 text-center backdrop-blur-xl">
                                        <Lock className="mx-auto mb-3 h-8 w-8 text-amber-400" />
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
                        </>
                    )}

                    {/* FINANCIAL DISCLAIMER — required by spec §30 */}
                    <p className="mt-6 text-center text-[10px] leading-relaxed text-muted-foreground">
                        AI trading signals are analytical tools and are not guaranteed to be profitable. Past performance does not guarantee future results. Trading involves substantial risk of loss.
                    </p>
                </div>

                {/* ANALYTICS SUMMARY */}
                {analytics && (
                    <div className="mt-10 rounded-2xl border border-border/30 bg-card/60 p-6 backdrop-blur-xl" data-guide="analytics">
                        <div className="flex items-center gap-2 mb-5">
                            <BarChart3 className="h-4 w-4 text-amber-400" />
                            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
                                Signal Analytics
                            </h2>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-xl border border-border/30  p-4">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>Total Signals</span>
                                    <Target className="h-4 w-4 text-amber-400" />
                                </div>
                                <div className="mt-2 text-2xl font-black text-foreground">{analytics.totalSignals}</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                    {analytics.activeSignals} active right now
                                </div>
                            </div>

                            <div className="rounded-xl border border-border/30  p-4">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>Win Rate</span>
                                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                </div>
                                <div className="mt-2 text-2xl font-black text-emerald-400">{analytics.winRate}%</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                    {analytics.winningSignals}W / {analytics.losingSignals}L
                                </div>
                            </div>

                            <div className="rounded-xl border border-border/30  p-4">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>Avg R:R</span>
                                    <Layers className="h-4 w-4 text-blue-400" />
                                </div>
                                <div className="mt-2 text-2xl font-black text-foreground">{analytics.averageRR.toFixed(1)}</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                    Avg confidence: {analytics.averageConfidence.toFixed(0)}%
                                </div>
                            </div>

                            <div className="rounded-xl border border-border/30  p-4">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>TP Hit Rates</span>
                                    <ShieldCheck className="h-4 w-4 text-purple-400" />
                                </div>
                                <div className="mt-2 space-y-1 text-sm font-bold">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">TP1:</span>
                                        <span className="text-emerald-400">{analytics.tp1HitRate}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">TP2:</span>
                                        <span className="text-emerald-400">{analytics.tp2HitRate}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">SL:</span>
                                        <span className="text-red-400">{analytics.slRate}%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


