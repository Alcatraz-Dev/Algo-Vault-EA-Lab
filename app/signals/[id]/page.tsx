"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Brain,
    Calculator,
    Eye,
    Flame,
    Heart,
    Loader2,
    ShieldAlert,
    TrendingDown,
    TrendingUp,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { AISignal, SignalTimelineEvent } from "@/lib/ai-signals/types";
import { formatPrice } from "@/lib/ai-signals/symbol-specs";
import ConfidenceBreakdown from "@/components/signals/ConfidenceBreakdown";
import SignalTimeline from "@/components/signals/SignalTimeline";
import SignalChart from "@/components/signals/SignalChart";

type Params = { id: string };

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
    SCANNING: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
    FORMING: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
    WATCH: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
    READY: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    ACTIVE: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    TP1_HIT: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    TP2_HIT: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    TP3_HIT: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    RUNNER: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    CANCELLED: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" },
    EXPIRED: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
    STOPPED: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" },
    COMPLETED: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
};

const STRENGTH_STYLES: Record<string, { bg: string; text: string; border: string }> = {
    WEAK: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
    MODERATE: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
    GOOD: { bg: "bg-sky-500/10", text: "text-sky-400", border: "border-sky-500/20" },
    STRONG: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
    VERY_STRONG: { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/20" },
    HIGH_CONVICTION: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
};

const REGIME_LABELS: Record<string, string> = {
    TRENDING_BULLISH: "Trending Bullish",
    TRENDING_BEARISH: "Trending Bearish",
    RANGING: "Ranging",
    BREAKOUT: "Breakout",
    REVERSAL: "Reversal",
    HIGH_VOLATILITY: "High Volatility",
    LOW_VOLATILITY: "Low Volatility",
    UNCERTAIN: "Uncertain",
};

function strengthColor(s: string) {
    if (s === "HIGH_CONVICTION") return "text-emerald-400";
    if (s === "VERY_STRONG") return "text-indigo-400";
    if (s === "STRONG") return "text-blue-400";
    if (s === "GOOD") return "text-sky-400";
    if (s === "MODERATE") return "text-amber-300";
    return "text-muted-foreground";
}

function confidenceColor(c: number) {
    if (c >= 80) return "text-emerald-400";
    if (c >= 60) return "text-amber-400";
    return "text-rose-400";
}

function formatTime(ts: number) {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatTimeAgo(ts: number) {
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

export default function SignalDetailPage({ params }: { params: Promise<Params> }) {
    const { id } = use(params);
    const [user, setUser] = useState<User | null>(null);
    const [signal, setSignal] = useState<AISignal | null>(null);
    const [events, setEvents] = useState<SignalTimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [following, setFollowing] = useState(false);
    const [followLoading, setFollowLoading] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [executionResult, setExecutionResult] = useState<{ ok: boolean; msg: string; commandId?: string } | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const token = await user.getIdToken();
                const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
                setLoading(true);
                setError(null);
                const r = await fetch(`/api/ai-signals/${id}`, { headers });
                if (!r.ok) throw new Error("Failed to load signal");
                const data = await r.json();
                setSignal(data.signal);
                setEvents(data.events || []);
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Failed to load signal");
            } finally {
                setLoading(false);
            }
        })();
    }, [user, id]);

    // Auth token helper
    async function authHeaders() {
        const token = await user?.getIdToken();
        return { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
    }

    async function handleFollow() {
        if (!signal || followLoading) return;
        setFollowLoading(true);
        try {
            const action = following ? "unfollow" : "follow";
            const headers = await authHeaders();
            await fetch("/api/ai-signals/follow", {
                method: "POST",
                headers,
                body: JSON.stringify({ signalId: signal.id, action }),
            });
            setFollowing(!following);
            setSignal((prev) =>
                prev
                    ? { ...prev, followCount: prev.followCount + (following ? -1 : 1) }
                    : prev
            );
        } finally {
            setFollowLoading(false);
        }
    }

    async function handleCancel() {
        if (!signal || cancelling) return;
        if (!confirm("Cancel this signal?")) return;
        setCancelling(true);
        try {
            const headers = await authHeaders();
            const r = await fetch(`/api/ai-signals/${signal.id}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({ status: "CANCELLED" }),
            });
            if (r.ok) {
                const data = await r.json();
                setSignal(data.signal);
                setEvents((prev) => [
                    {
                        id: `${signal.id}_CANCELLED_${Date.now()}`,
                        timestamp: Date.now(),
                        type: "STATUS_CHANGE",
                        message: "Signal cancelled by user",
                    },
                    ...prev,
                ]);
            }
        } finally {
            setCancelling(false);
        }
    }

    async function handleExecuteTrade() {
        if (!signal || executing) return;
        setExecutionResult(null);

        const confirmMsg = [
            `Execute ${signal.direction} trade on ${signal.symbol}?`,
            "",
            `Entry: ${formatPrice(signal.entry, signal.symbol)}`,
            `SL: ${formatPrice(signal.stopLoss, signal.symbol)}`,
            signal.tp1 ? `TP1: ${formatPrice(signal.tp1, signal.symbol)}` : "",
            `R:R ${signal.riskReward.toFixed(1)} · Risk ${signal.suggestedRiskPercent}%`,
            "",
            "The trade will be sent to your AlgoVault MT5 account.",
        ].filter(Boolean).join("\n");

        if (!confirm(confirmMsg)) return;

        setExecuting(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/ai-signals/${signal.id}/execute`, {
                method: "POST",
                headers,
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setExecutionResult({
                    ok: true,
                    msg: `${data.action} ${data.volume} lots on ${data.symbol} — command queued. The EA will execute it on MT5.`,
                    commandId: data.commandId,
                });
                setSignal((prev) => prev ? { ...prev, tradeCount: (prev.tradeCount || 0) + 1 } : prev);
            } else {
                setExecutionResult({ ok: false, msg: data.error || "Execution failed." });
            }
        } catch {
            setExecutionResult({ ok: false, msg: "Network error — trade not sent." });
        } finally {
            setExecuting(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                    <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                    <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
                </div>
                <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
                        <p className="text-sm text-muted-foreground">Loading signal...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !signal) {
        return (
            <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                    <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                    <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
                </div>
                <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <ShieldAlert className="h-12 w-12 text-rose-500" />
                        <p className="text-lg font-semibold text-foreground">Signal not found</p>
                        <p className="text-sm text-muted-foreground">{error || "This signal may have been removed."}</p>
                        <Link
                            href="/signals"
                            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                        >
                            <ArrowLeft size={16} />
                            Back to Signals
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const statusStyle = STATUS_STYLES[signal.status] || STATUS_STYLES.SCANNING;
    const strengthStyle = STRENGTH_STYLES[signal.strength] || STRENGTH_STYLES.WEAK;
    const isBuy = signal.direction === "BUY";
    const isActive = ["ACTIVE", "READY", "RUNNER", "TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(signal.status);

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            {/* BACKGROUND GRADIENT GLOWS */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>

            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                {/* BACK LINK */}
                <Link
                    href="/signals"
                    className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                >
                    <ArrowLeft size={16} />
                    Back to Signals
                </Link>

                {/* HEADER */}
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between" data-guide="page-header">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                                {signal.symbol}
                            </h1>

                            <span
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                                    isBuy
                                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                        : "border-rose-500/20 bg-rose-500/10 text-rose-400"
                                }`}
                            >
                                {isBuy ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                {signal.direction}
                            </span>

                            <span
                                className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                            >
                                {signal.status.replace(/_/g, " ")}
                            </span>

                            <span className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                                signal.tier === "PRO"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            }`}>
                                {signal.tier || "FREE"}
                            </span>

                            {signal.result && signal.result !== "PENDING" && (
                                <span className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                                    signal.result === "WIN"
                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                        : signal.result === "LOSS"
                                        ? "bg-red-500/10 text-red-400 border-red-500/20"
                                        : "bg-muted/10 text-muted-foreground border-border/30"
                                }`}>
                                    {signal.result} {signal.resultR > 0 ? "+" : ""}{Number(signal.resultR || 0).toFixed(2)}R
                                </span>
                            )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-1.5">
                                <span className={`text-2xl font-black font-mono ${confidenceColor(signal.confidence)}`}>
                                    {signal.confidence}%
                                </span>
                                <span className="text-xs text-muted-foreground">confidence</span>
                            </div>

                            <div className="h-5 w-px bg-muted/10" />

                            <span
                                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${strengthStyle.bg} ${strengthStyle.text} ${strengthStyle.border}`}
                            >
                                <Flame size={10} />
                                {signal.strength.replace(/_/g, " ")}
                            </span>

                            <div className="h-5 w-px bg-muted/10" />

                            <span className="text-sm text-muted-foreground">
                                R:R {signal.riskReward.toFixed(1)}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {isActive && (
                            <button
                                onClick={handleFollow}
                                disabled={followLoading}
                                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                                    following
                                        ? "border-amber-500/20 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                                        : "border-border/30 bg-muted/5 text-foreground hover:bg-muted/10 hover:text-foreground"
                                }`}
                            >
                                {followLoading ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <Heart size={16} className={following ? "fill-amber-400" : ""} />
                                )}
                                {following ? "Following" : "Follow"}
                            </button>
                        )}
                        <Link
                            href="/signals"
                            className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                        >
                            <Eye size={16} />
                            All Signals
                        </Link>
                    </div>
                </div>

                {/* MAIN CONTENT: 2 COLUMN LAYOUT */}
                <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">

                    {/* LEFT COLUMN (2/3) */}
                    <div className="space-y-6 lg:col-span-2">

                        {/* SIGNAL LEVELS CARD */}
                        <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Signal Levels
                            </h3>
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                                <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Entry</p>
                                    <p className="mt-1 font-mono text-lg font-bold text-foreground">
                                        {formatPrice(signal.entry, signal.symbol)}
                                    </p>
                                </div>
                                <div className="rounded-xl border border-rose-500/10 bg-rose-500/5 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-rose-500/60">Stop Loss</p>
                                    <p className="mt-1 font-mono text-lg font-bold text-rose-400">
                                        {formatPrice(signal.stopLoss, signal.symbol)}
                                    </p>
                                </div>
                                {signal.tp1 && (
                                    <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-emerald-500/60">TP1</p>
                                        <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
                                            {formatPrice(signal.tp1, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {signal.tp2 && (
                                    <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-emerald-500/60">TP2</p>
                                        <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
                                            {formatPrice(signal.tp2, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {signal.tp3 && (
                                    <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-emerald-500/60">TP3</p>
                                        <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
                                            {formatPrice(signal.tp3, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-amber-500/60">Risk:Reward</p>
                                    <p className="mt-1 font-mono text-lg font-bold text-amber-400">
                                        {signal.riskReward.toFixed(1)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* PRICE CHART */}
                        <SignalChart signal={signal} height={400} />

                        {/* MARKET ANALYSIS CARD */}
                        <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Market Analysis
                            </h3>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {signal.analysis.regime && (
                                    <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Regime</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">
                                            {REGIME_LABELS[signal.analysis.regime] || signal.analysis.regime}
                                        </p>
                                    </div>
                                )}
                                {signal.analysis.trend && (
                                    <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Trend</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{signal.analysis.trend}</p>
                                    </div>
                                )}
                                {signal.analysis.structure && (
                                    <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Structure</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{signal.analysis.structure}</p>
                                    </div>
                                )}
                                {signal.analysis.liquidity && (
                                    <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Liquidity</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{signal.analysis.liquidity}</p>
                                    </div>
                                )}
                                {signal.analysis.momentum && (
                                    <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Momentum</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{signal.analysis.momentum}</p>
                                    </div>
                                )}
                                {signal.analysis.volume && (
                                    <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Volume</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{signal.analysis.volume}</p>
                                    </div>
                                )}
                                {signal.analysis.orderFlow && (
                                    <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Order Flow</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{signal.analysis.orderFlow}</p>
                                    </div>
                                )}
                                {signal.analysis.higherTimeframe && (
                                    <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Higher Timeframe</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{signal.analysis.higherTimeframe}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* AI REASONING CARD */}
                        {signal.reasoning && (
                            <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl p-5">
                                <div className="mb-3 flex items-center gap-2">
                                    <Brain size={14} className="text-amber-400" />
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                        AI Reasoning
                                    </h3>
                                </div>
                                <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                                    {signal.reasoning}
                                </p>
                            </div>
                        )}

                        {/* SIGNAL TIMELINE */}
                        <SignalTimeline events={events} />
                    </div>

                    {/* RIGHT COLUMN (1/3) */}
                    <div className="space-y-6">

                        {/* CONFIDENCE BREAKDOWN */}
                        <ConfidenceBreakdown breakdown={signal.confidenceBreakdown} />

                        {/* RISK CALCULATOR CARD */}
                        <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl p-5">
                            <div className="mb-4 flex items-center gap-2">
                                <Calculator size={14} className="text-amber-400" />
                                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Risk Calculator
                                </h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Suggested Risk</span>
                                    <span className="font-mono text-sm font-bold text-amber-400">
                                        {signal.suggestedRiskPercent}%
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">SL Distance</span>
                                    <span className="font-mono text-sm font-bold text-rose-400">
                                        {Math.abs(signal.entry - signal.stopLoss).toFixed(0)} pips
                                    </span>
                                </div>
                                {signal.tp1 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">TP1 Distance</span>
                                        <span className="font-mono text-sm font-bold text-emerald-400">
                                            {Math.abs(signal.tp1 - signal.entry).toFixed(0)} pips
                                        </span>
                                    </div>
                                )}
                                {signal.tp2 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">TP2 Distance</span>
                                        <span className="font-mono text-sm font-bold text-emerald-400">
                                            {Math.abs(signal.tp2 - signal.entry).toFixed(0)} pips
                                        </span>
                                    </div>
                                )}
                                {signal.tp3 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">TP3 Distance</span>
                                        <span className="font-mono text-sm font-bold text-emerald-400">
                                            {Math.abs(signal.tp3 - signal.entry).toFixed(0)} pips
                                        </span>
                                    </div>
                                )}
                                <div className="h-px bg-muted/5" />
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Pip Value</span>
                                    <span className="font-mono text-sm font-bold text-muted-foreground">
                                        ${signal.pipValue.toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Typical Spread</span>
                                    <span className="font-mono text-sm font-bold text-muted-foreground">
                                        {signal.typicalSpread} pip{signal.typicalSpread !== 1 ? "s" : ""}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* ACTIONS CARD */}
                        <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Actions
                            </h3>
                            <div className="space-y-3">
                                {isActive && (
                                    <button
                                        onClick={handleFollow}
                                        disabled={followLoading}
                                        className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                                            following
                                                ? "border-amber-500/20 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                                                : "border-border/30 bg-muted/5 text-foreground hover:bg-muted/10 hover:text-foreground"
                                        }`}
                                    >
                                        {followLoading ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Heart size={16} className={following ? "fill-amber-400" : ""} />
                                        )}
                                        {following ? "Unfollow Signal" : "Follow Signal"}
                                    </button>
                                )}
                                {isActive && (
                                    <button
                                        onClick={handleExecuteTrade}
                                        disabled={executing}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                                    >
                                        {executing ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Zap size={16} />
                                        )}
                                        {executing ? "Sending to MT5…" : "Open Trade"}
                                    </button>
                                )}

                                {/* Execution result feedback */}
                                {executionResult && (
                                    <div className={`rounded-xl border p-3 text-xs ${
                                        executionResult.ok
                                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                            : "border-rose-500/20 bg-rose-500/10 text-rose-400"
                                    }`}>
                                        <p>{executionResult.msg}</p>
                                        {executionResult.commandId && (
                                            <p className="mt-1 text-[10px] opacity-60">
                                                Command: {executionResult.commandId}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {isActive && (
                                    <button
                                        onClick={handleCancel}
                                        disabled={cancelling}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
                                    >
                                        {cancelling ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <ShieldAlert size={16} />
                                        )}
                                        Cancel Signal
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* SIGNAL INFO CARD */}
                        <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Signal Info
                            </h3>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Timeframe</span>
                                    <span className="text-sm font-medium text-foreground">{signal.timeframe}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Category</span>
                                    <span className="text-sm font-medium text-foreground capitalize">{signal.category}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Engine Version</span>
                                    <span className="font-mono text-xs text-muted-foreground">{signal.engineVersion}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Strategy Version</span>
                                    <span className="font-mono text-xs text-muted-foreground">{signal.strategyVersion}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Analysis Version</span>
                                    <span className="font-mono text-xs text-muted-foreground">{signal.analysisVersion || "—"}</span>
                                </div>
                                <div className="h-px bg-muted/5" />
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Created</span>
                                    <span className="text-xs text-muted-foreground">{formatTimeAgo(signal.createdAt)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Followers</span>
                                    <span className="text-sm font-medium text-foreground">{signal.followCount}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Trades</span>
                                    <span className="text-sm font-medium text-foreground">{signal.tradeCount}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
