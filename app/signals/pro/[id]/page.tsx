"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    ArrowLeft,
    CheckCircle2,
    Crosshair,
    Clock,
    Flame,
    Heart,
    Loader2,
    Radio,
    ShieldAlert,
    TrendingDown,
    TrendingUp,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import type { AISignal, SignalTimelineEvent } from "@/lib/ai-signals/types";
import { formatPrice } from "@/lib/ai-signals/symbol-specs";
import ConfidenceBreakdown from "@/components/signals/ConfidenceBreakdown";
import SignalChart from "@/components/signals/SignalChart";
import SignalTimeline from "@/components/signals/SignalTimeline";
import { cn } from "@/lib/utils";

type Params = { id: string };

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
    NEW: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
    READY: { bg: "bg-info/10", text: "text-info", border: "border-info/20" },
    ACTIVE: { bg: "bg-positive/10", text: "text-positive", border: "border-positive/20" },
    TP1_HIT: { bg: "bg-positive/10", text: "text-positive", border: "border-positive/20" },
    TP2_HIT: { bg: "bg-positive/10", text: "text-positive", border: "border-positive/20" },
    TP3_HIT: { bg: "bg-positive/10", text: "text-positive", border: "border-positive/20" },
    RUNNER: { bg: "bg-positive/10", text: "text-positive", border: "border-positive/20" },
    BE_RECOMMENDED: { bg: "bg-warning/10", text: "text-warning", border: "border-warning/20" },
    CANCELLED: { bg: "bg-negative/10", text: "text-negative", border: "border-negative/20" },
    EXPIRED: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
    STOPPED: { bg: "bg-negative/10", text: "text-negative", border: "border-negative/20" },
    COMPLETED: { bg: "bg-positive/10", text: "text-positive", border: "border-positive/20" },
};

const STRENGTH_STYLES: Record<string, { bg: string; text: string; border: string }> = {
    WEAK: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
    MODERATE: { bg: "bg-warning/10", text: "text-warning", border: "border-warning/20" },
    GOOD: { bg: "bg-info/10", text: "text-info", border: "border-info/20" },
    STRONG: { bg: "bg-info/10", text: "text-info", border: "border-info/20" },
    VERY_STRONG: { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" },
    HIGH_CONVICTION: { bg: "bg-positive/10", text: "text-positive", border: "border-positive/20" },
};

const STYLE_LABELS: Record<string, string> = {
    SCALPING: "Scalping",
    INTRADAY: "Intraday",
    SWING: "Swing",
    UNKNOWN: "Unknown",
};

function formatTimeAgo(ts: number | undefined): string {
    if (!ts) return "Unknown";
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

export default function ProSignalDetailPage({ params }: { params: Promise<Params> }) {
    const { id } = use(params);
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [hasPro, setHasPro] = useState<boolean>(false);
    const [signal, setSignal] = useState<AISignal | null>(null);
    const [events, setEvents] = useState<SignalTimelineEvent[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
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
                const sub = await onSubscriptionChange(user.uid);
                setHasPro(sub.hasSubscription);
            } catch {
                setHasPro(false);
            }
        })();
    }, [user]);

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const token = await user.getIdToken();
                const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
                setLoading(true);
                setError(null);
                const r = await fetch(`/api/pro-signals/${id}`, { headers });
                if (!r.ok) throw new Error("Failed to load signal");
                const data = await r.json();

                const raw = data.signal;
                if (!raw) {
                    setError("Signal not found");
                    return;
                }

                const normalized = {
                    ...({
                        id: raw.id,
                        symbol: raw.symbol,
                        direction: raw.direction,
                        timeframe: raw.timeframe,
                        category: raw.category || "forex",
                        tier: "PRO",
                        entry: raw.entry,
                        stopLoss: raw.stopLoss,
                        tp1: raw.tp1,
                        tp2: raw.tp2,
                        tp3: raw.tp3,
                        tp4: raw.tp4,
                        confidence: raw.confidence || 0,
                        strength: raw.parserMetadata?.confidence
                            ? raw.parserMetadata.confidence >= 95
                                ? "HIGH_CONVICTION"
                                : raw.parserMetadata.confidence >= 85
                                ? "VERY_STRONG"
                                : raw.parserMetadata.confidence >= 75
                                ? "STRONG"
                                : raw.parserMetadata.confidence >= 65
                                ? "GOOD"
                                : raw.parserMetadata.confidence >= 50
                                ? "MODERATE"
                                : "WEAK"
                            : "MODERATE",
                        marketRegime: "HIGH_VOLATILITY",
                        riskReward: raw.riskReward || 2.0,
                        status: raw.displayStatus || "WATCH",
                        result: "PENDING",
                        resultR: 0,
                        profitPoints: 0,
                        tp1Hit: false,
                        tp2Hit: false,
                        tp3Hit: false,
                        analysis: raw.analysis || {},
                        confidenceBreakdown: raw.confidenceBreakdown || {
                            trendAlignment: { score: raw.confidence || 0, max: 100, detail: "" },
                            marketStructure: { score: 0, max: 100, detail: "" },
                            liquidity: { score: 0, max: 100, detail: "" },
                            momentum: { score: 0, max: 100, detail: "" },
                            volume: { score: 0, max: 100, detail: "" },
                            orderFlow: { score: 0, max: 100, detail: "" },
                            entryConfirmation: { score: raw.confidence || 0, max: 100, detail: "" },
                            total: raw.confidence || 0,
                        } as AISignal["confidenceBreakdown"],
                        reasoning: "",
                        currentPrice: raw.entry,
                        distanceToEntry: 0,
                        distanceToSL: Math.abs(raw.entry - raw.stopLoss),
                        createdAt: raw.createdAt,
                        updatedAt: raw.lastUpdateAt || raw.createdAt,
                        expiresAt: raw.expirationAt || 0,
                        engineVersion: "",
                        strategyVersion: "",
                        analysisVersion: "",
                        generatedBy: "Telegram Signal Engine",
                        lastCheckedAt: Date.now(),
                        followCount: raw.followCount || 0,
                        tradeCount: raw.tradeCount || 0,
                        suggestedRiskPercent: 1,
                        pipValue: 0.01,
                        contractSize: 100000,
                        typicalSpread: 1,
                        digits: 5,
                        timeline: [],
                        sourceMetadata: raw.sourceMetadata,
                        rawMessageId: raw.rawMessageId,
                        style: raw.style,
                    } as unknown as AISignal),
                    tp5: raw.tp5,
                } as AISignal & { tp5?: number };

                setSignal(normalized);
                setEvents(data.events || []);
                setFollowing(Boolean(data.isFollowed));
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Failed to load signal");
            } finally {
                setLoading(false);
            }
        })();
    }, [user, id]);

    async function authHeaders() {
        const token = await user?.getIdToken();
        return { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
    }

    async function handleFollow() {
        if (!signal || followLoading) return;
        const nextFollowing = !following;
        setFollowLoading(true);
        try {
            const headers = await authHeaders();
            const response = await fetch("/api/pro-signals/follow", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    signalId: signal.id,
                    action: nextFollowing ? "follow" : "unfollow",
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || "Unable to update follow state.");
            }

            setFollowing(nextFollowing);
            setSignal((prev) =>
                prev
                    ? { ...prev, followCount: data.followCount ?? prev.followCount + (nextFollowing ? 1 : -1) }
                    : prev
            );
        } catch (err) {
            setExecutionResult({
                ok: false,
                msg: err instanceof Error ? err.message : "Unable to update follow state.",
            });
        } finally {
            setFollowLoading(false);
        }
    }

    async function handleCancel() {
        if (!signal || cancelling) return;
        if (!confirm(`Cancel this Pro signal on ${signal.symbol} (${signal.direction})?`)) return;
        setCancelling(true);
        try {
            const headers = await authHeaders();
            const r = await fetch(`/api/pro-signals/${signal.id}`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ action: "cancel" }),
            });
            if (r.ok) {
                setSignal((prev) => (prev ? { ...prev, status: "CANCELLED" } : prev));
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

        const tp1Price = signal.tp1 ? `\nTP1: ${formatPrice(signal.tp1, signal.symbol)}` : "";
        const tp2Price = signal.tp2 ? `\nTP2: ${formatPrice(signal.tp2, signal.symbol)}` : "";
        const tp3Price = signal.tp3 ? `\nTP3: ${formatPrice(signal.tp3, signal.symbol)}` : "";

        const confirmMsg = [
            `Execute ${signal.direction} trade on ${signal.symbol}?`,
            "",
            `Entry: ${formatPrice(signal.entry, signal.symbol)}`,
            `SL: ${formatPrice(signal.stopLoss, signal.symbol)}`,
            tp1Price,
            tp2Price,
            tp3Price,
            `R:R ${signal.riskReward.toFixed(1)} · Risk ${signal.suggestedRiskPercent}%`,
            "",
            "The trade will be sent to your AlgoVault MT5 account.",
        ].filter(Boolean).join("\n");

        if (!confirm(confirmMsg)) return;

        setExecuting(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/pro-signals/execute", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    signalId: signal.id,
                    mt5Account: "default",
                    volume: 0.01,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setExecutionResult({
                    ok: true,
                    msg: `${data.signal.direction || signal.direction} ${0.01} lots on ${signal.symbol} — command queued. The EA will execute it on MT5.`,
                    commandId: data.commandId ?? data.ticket,
                });
                setSignal((prev) =>
                    prev ? { ...prev, tradeCount: (prev.tradeCount || 0) + 1 } : prev
                );
            } else {
                setExecutionResult({ ok: false, msg: data.error || "Execution failed." });
            }
        } catch {
            setExecutionResult({ ok: false, msg: "Network error — trade not sent." });
        } finally {
            setExecuting(false);
        }
    }

    if (!user || !hasPro) {
        return (
            <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
                <div className="max-w-md w-full rounded-lg border border-warning/20 bg-card p-8 text-center shadow-sm">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-warning/10 border border-warning/20">
                        <Zap className="h-7 w-7 text-warning" />
                    </div>
                    <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                        AlgoVault Pro Signals
                    </h1>
                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                        Access real-time institutional signals, instant SL/TP tracking, conflict detection, and MT5 execution. Requires an active Pro subscription.
                    </p>
                    <div className="mt-6 flex flex-col gap-3">
                        <Link
                            href="/pricing"
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-warning px-5 py-3 text-xs font-bold text-foreground transition-colors hover:bg-warning shadow-sm"
                        >
                            <Zap className="h-4 w-4 fill-black" />
                            Upgrade to Pro
                        </Link>
                        <Link
                            href="/signals"
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back to Signals
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-background text-foreground">
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                </div>
                <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-8 w-8 animate-spin text-warning" />
                        <p className="text-sm text-muted-foreground">Loading Pro signal...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !signal) {
        return (
            <div className="min-h-screen bg-background text-foreground">
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                </div>
                <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <ShieldAlert className="h-12 w-12 text-negative" />
                        <p className="text-lg font-semibold text-foreground">Signal not found</p>
                        <p className="text-sm text-muted-foreground">{error || "This signal may have been removed."}</p>
                        <Link
                            href="/signals/pro"
                            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                        >
                            <ArrowLeft size={16} />
                            Back to Pro Signals
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const statusStyle = STATUS_STYLES[signal.status] || STATUS_STYLES.NEW;
    const strengthStyle = STRENGTH_STYLES[signal.strength] || STRENGTH_STYLES.MODERATE;
    const isBuy = signal.direction === "BUY";
    const isActive = ["ACTIVE", "READY", "RUNNER", "TP1_HIT", "TP2_HIT", "TP3_HIT", "NEW", "BE_RECOMMENDED"].includes(signal.status);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
            </div>

            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link
                    href="/signals/pro"
                    className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                >
                    <ArrowLeft size={16} />
                    Back to Pro Signals
                </Link>

                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between" data-guide="page-header">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                                {signal.symbol}
                            </h1>

                            <span
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                                    isBuy
                                        ? "border-positive/20 bg-positive/10 text-positive"
                                        : "border-negative/20 bg-negative/10 text-negative"
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

                            <span className="rounded-lg border px-2 py-1 text-[11px] font-bold uppercase tracking-wider bg-warning/10 text-warning border-warning/20">
                                PRO
                            </span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-1.5">
                                <span className={`text-2xl font-black font-numeric ${signal.confidence >= 80 ? "text-positive" : signal.confidence >= 60 ? "text-warning" : "text-negative"}`}>
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

                            <div className="h-5 w-px bg-muted/10" />

                            {signal.timeframe && (
                                <span className="inline-flex items-center gap-1 rounded-lg border border-border/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                    <Clock size={10} />
                                    {signal.timeframe}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {isActive && (
                            <button
                                onClick={handleFollow}
                                disabled={followLoading}
                                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                                    following
                                        ? "border-warning/20 bg-warning/10 text-warning hover:bg-warning/20"
                                        : "border-border/30 bg-muted/5 text-foreground hover:bg-muted/10 hover:text-foreground"
                                }`}
                            >
                                {followLoading ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <Heart size={16} className={following ? "fill-warning" : ""} />
                                )}
                                {following ? "Following" : "Follow"}
                            </button>
                        )}
                        <Link
                            href="/signals/pro"
                            className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
                        >
                            <Radio size={16} />
                            Pro Feed
                        </Link>
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="space-y-6 lg:col-span-2">
                        <SignalChart signal={signal} height={400} />

                        <div className="rounded-lg border border-border/30 bg-card p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Signal Levels
                            </h3>
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                                <div className="rounded-xl border border-border/10 bg-muted/50 p-3">
                                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Entry</p>
                                    <p className="mt-1 font-numeric text-lg font-bold text-foreground">
                                        {formatPrice(signal.entry, signal.symbol)}
                                    </p>
                                </div>
                                <div className="rounded-xl border border-negative/10 bg-negative/5 p-3">
                                    <p className="text-[11px] uppercase tracking-wider text-negative/60">Stop Loss</p>
                                    <p className="mt-1 font-numeric text-lg font-bold text-negative">
                                        {formatPrice(signal.stopLoss, signal.symbol)}
                                    </p>
                                </div>
                                {signal.tp1 && (
                                    <div className="rounded-xl border border-positive/10 bg-positive/5 p-3">
                                        <p className="text-[11px] uppercase tracking-wider text-positive/60">TP1</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice(signal.tp1, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {signal.tp2 && (
                                    <div className="rounded-xl border border-positive/10 bg-positive/5 p-3">
                                        <p className="text-[11px] uppercase tracking-wider text-positive/60">TP2</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice(signal.tp2, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {signal.tp3 && (
                                    <div className="rounded-xl border border-positive/10 bg-positive/5 p-3">
                                        <p className="text-[11px] uppercase tracking-wider text-positive/60">TP3</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice(signal.tp3, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {signal.tp4 && (
                                    <div className="rounded-xl border border-positive/10 bg-positive/5 p-3">
                                        <p className="text-[11px] uppercase tracking-wider text-positive/60">TP4</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice(signal.tp4, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {(signal as AISignal & { tp5?: number }).tp5 && (
                                    <div className="rounded-xl border border-positive/10 bg-positive/5 p-3">
                                        <p className="text-[11px] uppercase tracking-wider text-positive/60">TP5</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice((signal as AISignal & { tp5?: number }).tp5!, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                <div className="rounded-xl border border-warning/10 bg-warning/5 p-3">
                                    <p className="text-[11px] uppercase tracking-wider text-warning/60">Risk:Reward</p>
                                    <p className="mt-1 font-numeric text-lg font-bold text-warning">
                                        {signal.riskReward.toFixed(1)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <SignalTimeline events={events} />
                    </div>

                    <div className="space-y-6">
                        <ConfidenceBreakdown breakdown={signal.confidenceBreakdown} />

                        <div className="rounded-lg border border-border/30 bg-card p-5">
                            <div className="mb-4 flex items-center gap-2">
                                <Crosshair size={14} className="text-warning" />
                                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Signal Meta
                                </h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Style</span>
                                    <span className="text-sm font-medium text-foreground capitalize">
                                        {STYLE_LABELS[(signal as AISignal & { style?: string }).style || "UNKNOWN"] || (signal as AISignal & { style?: string }).style || "Unknown"}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Timeframe</span>
                                    <span className="text-sm font-medium text-foreground">{signal.timeframe}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Tier</span>
                                    <span className="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-warning/10 text-warning border-warning/20">
                                        PRO
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Followers</span>
                                    <span className="text-sm font-medium text-foreground">{signal.followCount}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Trades</span>
                                    <span className="text-sm font-medium text-foreground">{signal.tradeCount}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Created</span>
                                    <span className="text-xs text-muted-foreground">{formatTimeAgo(signal.createdAt)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-border/30 bg-card p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Risk Calculator
                            </h3>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Suggested Risk</span>
                                    <span className="font-numeric text-sm font-bold text-warning">
                                        {signal.suggestedRiskPercent}%
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">SL Distance</span>
                                    <span className="font-numeric text-sm font-bold text-negative">
                                        {Math.abs(signal.entry - signal.stopLoss).toFixed(0)} pips
                                    </span>
                                </div>
                                {signal.tp1 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">TP1 Distance</span>
                                        <span className="font-numeric text-sm font-bold text-positive">
                                            {Math.abs(signal.tp1 - signal.entry).toFixed(0)} pips
                                        </span>
                                    </div>
                                )}
                                {signal.tp2 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">TP2 Distance</span>
                                        <span className="font-numeric text-sm font-bold text-positive">
                                            {Math.abs(signal.tp2 - signal.entry).toFixed(0)} pips
                                        </span>
                                    </div>
                                )}
                                {signal.tp3 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">TP3 Distance</span>
                                        <span className="font-numeric text-sm font-bold text-positive">
                                            {Math.abs(signal.tp3 - signal.entry).toFixed(0)} pips
                                        </span>
                                    </div>
                                )}
                                <div className="h-px bg-muted/5" />
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Pip Value</span>
                                    <span className="font-numeric text-sm font-bold text-muted-foreground">
                                        ${(signal.pipValue || 0.01).toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Typical Spread</span>
                                    <span className="font-numeric text-sm font-bold text-muted-foreground">
                                        {signal.typicalSpread || 1} pip{signal.typicalSpread !== 1 ? "s" : ""}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-border/30 bg-card p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Actions
                            </h3>
                            <div className="space-y-3">
                                {isActive && (
                                    <button
                                        onClick={handleExecuteTrade}
                                        disabled={executing}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-positive/20 bg-positive/10 px-4 py-2.5 text-sm font-medium text-positive transition-colors hover:bg-positive/20 disabled:opacity-50"
                                    >
                                        {executing ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Zap size={16} />
                                        )}
                                        {executing ? "Sending to MT5…" : "Open Trade"}
                                    </button>
                                )}

                                {executionResult && (
                                    <div className={cn(
                                        "rounded-xl border p-3 text-xs",
                                        executionResult.ok
                                            ? "border-positive/20 bg-positive/10 text-positive"
                                            : "border-negative/20 bg-negative/10 text-negative"
                                    )}>
                                        <p>{executionResult.msg}</p>
                                        {executionResult.commandId && (
                                            <p className="mt-1 text-[11px] opacity-60">
                                                Command: {executionResult.commandId}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {isActive && (
                                    <button
                                        onClick={handleCancel}
                                        disabled={cancelling}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-negative/20 bg-negative/10 px-4 py-2.5 text-sm font-medium text-negative transition-colors hover:bg-negative/20"
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
                    </div>
                </div>
            </div>
        </div>
    );
}
