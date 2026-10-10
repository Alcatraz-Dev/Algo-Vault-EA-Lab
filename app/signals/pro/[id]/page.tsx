"use client";

import { use, useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Calculator,
    Crosshair,
    Flame,
    Heart,
    Loader2,
    Radio,
    RefreshCw,
    Shield,
    ShieldAlert,
    Target,
    TrendingDown,
    TrendingUp,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { ref as dbRef, onValue } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import type { AISignal, SignalTimelineEvent } from "@/lib/ai-signals/types";
import { formatPrice, getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import ConfidenceBreakdown from "@/components/signals/ConfidenceBreakdown";
import SignalTerminalChart from "@/components/signals/SignalTerminalChart";
import SignalTimeline from "@/components/signals/SignalTimeline";
import { cn } from "@/lib/utils";
import { useLivePrices } from "@/hooks/useLivePrices";

type Params = { id: string };

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
    SCANNING: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
    FORMING: { bg: "bg-info/10", text: "text-info-foreground", border: "border-info/30" },
    WATCH: { bg: "bg-warning/10", text: "text-warning-foreground", border: "border-warning/30" },
    READY: { bg: "bg-positive/10", text: "text-positive-foreground", border: "border-positive/30" },
    ACTIVE: { bg: "bg-positive/10", text: "text-positive-foreground", border: "border-positive/30" },
    TP1_HIT: { bg: "bg-positive/10", text: "text-positive-foreground", border: "border-positive/30" },
    TP2_HIT: { bg: "bg-positive/10", text: "text-positive-foreground", border: "border-positive/30" },
    TP3_HIT: { bg: "bg-positive/10", text: "text-positive-foreground", border: "border-positive/30" },
    RUNNER: { bg: "bg-positive/10", text: "text-positive-foreground", border: "border-positive/30" },
    CANCELLED: { bg: "bg-negative/10", text: "text-negative-foreground", border: "border-negative/30" },
    EXPIRED: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
    STOPPED: { bg: "bg-negative/10", text: "text-negative-foreground", border: "border-negative/30" },
    COMPLETED: { bg: "bg-positive/10", text: "text-positive-foreground", border: "border-positive/30" },
    NEW: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
};

const STRENGTH_STYLES: Record<string, { bg: string; text: string; border: string }> = {
    WEAK: { bg: "bg-muted/10", text: "text-muted-foreground", border: "border-border/30" },
    MODERATE: { bg: "bg-warning/10", text: "text-warning-foreground", border: "border-warning/30" },
    GOOD: { bg: "bg-info/10", text: "text-info-foreground", border: "border-info/30" },
    STRONG: { bg: "bg-info/10", text: "text-info-foreground", border: "border-info/30" },
    VERY_STRONG: { bg: "bg-info/10", text: "text-info-foreground", border: "border-info/30" },
    HIGH_CONVICTION: { bg: "bg-positive/10", text: "text-positive-foreground", border: "border-positive/30" },
};

function confidenceColor(c: number) {
    if (c >= 80) return "text-positive";
    if (c >= 60) return "text-warning";
    return "text-negative";
}

/* ─── Live Price Panel (shared with signals/[id]) ─── */
function LivePricePanel({ signal, lastUpdatedAt, onRefresh }: {
    signal: AISignal;
    lastUpdatedAt: number;
    onRefresh: () => void;
}) {
    const symbols = signal.symbol ? [signal.symbol] : [];
    const { prices, lastUpdatedAt: pricesUpdatedAt } = useLivePrices(symbols, { intervalMs: 5_000 });
    const liveQuote = prices[signal.symbol] ?? null;
    const isLive = liveQuote != null && liveQuote > 0;

    // Pro signals have no stored market snapshot — fall back to the entry
    // price so the panel always shows a meaningful level when no live quote
    // is available (market closed, provider down).
    const lastKnown = Number(signal.currentPrice) > 0 ? Number(signal.currentPrice) : (signal.entry > 0 ? signal.entry : null);
    const displayPrice = isLive ? liveQuote : lastKnown;

    const slDist  = Math.abs(signal.entry - signal.stopLoss);
    const tp1Dist = signal.tp1 ? Math.abs(signal.tp1 - signal.entry) : 0;
    const isBuy   = signal.direction === "BUY";

    // progress along SL→Entry→TP1 track
    let progress: number;
    if (displayPrice == null || displayPrice <= 0 || !signal.tp1) {
        // No price at all — park the cursor at entry (its exact position on
        // the SL→TP track) instead of a fake mid-track guess.
        progress = slDist + tp1Dist > 0 ? (slDist / (slDist + tp1Dist)) * 100 : 50;
    } else {
        const totalRange = slDist + tp1Dist;
        const fromSl = isBuy ? displayPrice - signal.stopLoss : signal.stopLoss - displayPrice;
        progress = Math.min(100, Math.max(0, (fromSl / totalRange) * 100));
    }

    const priceVsEntry = displayPrice != null && signal.entry > 0
        ? ((displayPrice - signal.entry) / signal.entry) * 100
        : null;
    const inFavor = priceVsEntry == null ? true : (isBuy ? priceVsEntry >= 0 : priceVsEntry <= 0);
    const secSinceQuote = pricesUpdatedAt > 0 ? Math.round((Date.now() - pricesUpdatedAt) / 1000) : null;

    return (
        <div className={cn("mt-6 rounded-lg border border-border bg-card p-5")}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${isLive ? "animate-pulse bg-positive" : "bg-muted-foreground/40"}`} />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {isLive ? "Live Market" : "Market Price"}
                    </span>
                    {displayPrice != null && displayPrice > 0 && (
                        <span className={`font-numeric text-lg font-black ${isBuy ? "text-positive" : "text-negative"}`}>
                            {formatPrice(displayPrice, signal.symbol)}
                        </span>
                    )}
                    {displayPrice == null && <span className="text-xs text-muted-foreground">Connecting…</span>}
                    {!isLive && displayPrice != null && (
                        <span className="rounded-md border border-border/30 bg-muted/10 px-1.5 py-0.5 text-micro font-semibold uppercase text-muted-foreground">
                            entry
                        </span>
                    )}
                    {priceVsEntry != null && (
                        <span className={`font-numeric text-micro font-semibold ${inFavor ? "text-positive" : "text-negative"}`}>
                            {priceVsEntry >= 0 ? "+" : ""}{priceVsEntry.toFixed(2)}% vs entry
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {isLive && secSinceQuote !== null && <span className="text-micro text-muted-foreground">{secSinceQuote}s ago</span>}
                    <button onClick={onRefresh} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition">
                        <RefreshCw size={12} />
                    </button>
                </div>
            </div>
            <div className="space-y-2">
                <div className="flex items-center justify-between text-micro">
                    <span className="flex items-center gap-1 text-negative font-numeric font-semibold">
                        <Shield size={9} />{formatPrice(signal.stopLoss, signal.symbol)}
                    </span>
                    <span className="font-numeric text-muted-foreground/60">Entry {formatPrice(signal.entry, signal.symbol)}</span>
                    {signal.tp1 && (
                        <span className="flex items-center gap-1 text-positive font-numeric font-semibold">
                            {formatPrice(signal.tp1, signal.symbol)}<Target size={9} />
                        </span>
                    )}
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/20">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-info transition-all duration-500"
                        style={{ width: `${progress}%` }} />
                    <div className="absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full border-2 border-background bg-foreground shadow-md transition-all duration-500"
                        style={{ left: `${progress}%` }} />
                </div>
                <div className="flex justify-between text-micro text-muted-foreground/40">
                    <span className="font-numeric">SL {slDist >= 1 ? slDist.toFixed(0) : slDist.toFixed(4)} pts</span>
                    {signal.tp1 && <span className="font-numeric">TP1 {tp1Dist >= 1 ? tp1Dist.toFixed(0) : tp1Dist.toFixed(4)} pts · {signal.riskReward.toFixed(1)}R</span>}
                </div>
            </div>
        </div>
    );
}

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

/** Convert a raw price distance into pips using the symbol's pip size. */
function formatPips(distance: number, symbol: string): string {
    const spec = getSymbolSpec(symbol);
    const pipSize = spec?.pipSize ?? 0.0001;
    if (!Number.isFinite(distance) || distance <= 0) return "0";
    const pips = distance / pipSize;
    return pips >= 100 ? pips.toFixed(0) : pips >= 10 ? pips.toFixed(1) : pips.toFixed(2);
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
    const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
    const userRef = useRef<User | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); userRef.current = u; });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!user) return;
        (async () => {
            try { const sub = await onSubscriptionChange(user.uid); setHasPro(sub.hasSubscription); } catch { setHasPro(false); }
        })();
    }, [user]);

    const fetchSignal = useCallback(async (u: User | null) => {
        if (!u) return;
        try {
            const token = await u.getIdToken();
            const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
            const r = await fetch(`/api/pro-signals/${id}`, { headers });
            if (!r.ok) throw new Error("Failed to load signal");
            const data = await r.json();
            const raw = data.signal;
            if (!raw) { setError("Signal not found"); return; }
            // Use the real symbol spec so digits / pip size / spread match the
            // instrument (e.g. XAUUSD = 2 digits, not the hardcoded 5).
            const spec = getSymbolSpec(raw.symbol);
            const normalized = {
                ...({
                    id: raw.id, symbol: raw.symbol, direction: raw.direction,
                    timeframe: raw.timeframe, category: raw.category || "forex", tier: "PRO",
                    entry: raw.entry, stopLoss: raw.stopLoss, tp1: raw.tp1, tp2: raw.tp2, tp3: raw.tp3, tp4: raw.tp4,
                    confidence: raw.confidence || 0,
                    strength: raw.parserMetadata?.confidence
                        ? raw.parserMetadata.confidence >= 95 ? "HIGH_CONVICTION"
                        : raw.parserMetadata.confidence >= 85 ? "VERY_STRONG"
                        : raw.parserMetadata.confidence >= 75 ? "STRONG"
                        : raw.parserMetadata.confidence >= 65 ? "GOOD"
                        : raw.parserMetadata.confidence >= 50 ? "MODERATE" : "WEAK"
                        : "MODERATE",
                    marketRegime: "HIGH_VOLATILITY", riskReward: raw.riskReward || 2.0,
                    status: raw.displayStatus || "WATCH", result: "PENDING", resultR: 0, profitPoints: 0,
                    tp1Hit: false, tp2Hit: false, tp3Hit: false,
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
                    reasoning: "", currentPrice: raw.entry, distanceToEntry: 0,
                    distanceToSL: Math.abs(raw.entry - raw.stopLoss),
                    createdAt: raw.createdAt, updatedAt: raw.lastUpdateAt || raw.createdAt, expiresAt: raw.expirationAt || 0,
                    engineVersion: "", strategyVersion: "", analysisVersion: "",
                    generatedBy: "Telegram Signal Engine", lastCheckedAt: Date.now(),
                    followCount: raw.followCount || 0, tradeCount: raw.tradeCount || 0,
                    suggestedRiskPercent: 1,
                    pipValue: spec?.pipSize ?? 0.01,
                    contractSize: spec?.contractSize ?? 100000,
                    typicalSpread: spec?.typicalSpread ?? 1,
                    digits: spec?.digits ?? 5,
                    timeline: [], sourceMetadata: raw.sourceMetadata, rawMessageId: raw.rawMessageId, style: raw.style,
                } as unknown as AISignal),
                tp5: raw.tp5,
            } as AISignal & { tp5?: number };
            // Never show a broken R:R — coerce to a finite number for display.
            const rr = Number(normalized.riskReward);
            normalized.riskReward = Number.isFinite(rr) && rr > 0 ? rr : 0;
            setSignal(normalized);
            setEvents(data.events || []);
            setFollowing(Boolean(data.isFollowed));
            setLastUpdatedAt(Date.now());
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load signal");
        }
    }, [id]);

    // Initial load
    useEffect(() => {
        if (!user) return;
        setLoading(true); setError(null);
        fetchSignal(user).finally(() => setLoading(false));
    }, [user, fetchSignal]);

    // Firebase onValue — real-time updates on pro signal node (telegramSignals)
    useEffect(() => {
        if (!user) return;
        const signalRef = dbRef(database, `telegramSignals/${id}`);
        const unsub = onValue(signalRef, (snapshot) => {
            if (!snapshot.exists()) return;
            // Re-fetch via API to get fully normalized data
            void fetchSignal(userRef.current);
        });
        return () => unsub();
    }, [user, id, fetchSignal]);

    // 30s auto-refresh fallback
    useEffect(() => {
        if (!user) return;
        const interval = setInterval(() => { void fetchSignal(userRef.current); }, 30_000);
        return () => clearInterval(interval);
    }, [user, fetchSignal]);

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
            <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
                <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
                    <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                            <Zap className="h-7 w-7 text-primary" />
                        </div>
                        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                            AlgoVault Pro Signals
                        </h1>
                        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                            Access real-time institutional signals, instant SL/TP tracking, conflict detection, and MT5 execution. Requires an active Pro subscription.
                        </p>
                        <div className="mt-6 flex flex-col gap-3">
                            <Link
                                href="/pricing"
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                                <Zap className="h-4 w-4" />
                                Upgrade to Pro
                            </Link>
                            <Link
                                href="/signals"
                                className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-5 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Back to Signals
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
                <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Loading Pro signal...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !signal) {
        return (
            <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
                <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <ShieldAlert className="h-12 w-12 text-negative" />
                        <p className="text-lg font-semibold text-foreground">Signal not found</p>
                        <p className="text-sm text-muted-foreground">{error || "This signal may have been removed."}</p>
                        <Link
                            href="/signals/pro"
                            className="mt-4 inline-flex items-center gap-2 rounded-md border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10"
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
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
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
                            <h1 className="text-2xl font-semibold tracking-tight">
                                {signal.symbol}
                            </h1>

                            <span
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                                    isBuy
                                        ? "border-positive/30 bg-positive/10 text-positive-foreground"
                                        : "border-negative/30 bg-negative/10 text-negative-foreground"
                                }`}
                            >
                                {isBuy ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                {signal.direction}
                            </span>

                            <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                            >
                                {signal.status.replace(/_/g, " ")}
                            </span>

                            <span className={`rounded-full border px-2 py-1 text-micro font-bold uppercase tracking-wider ${
                                signal.tier === "PRO"
                                    ? "bg-primary/10 text-primary border-primary/30"
                                    : "bg-muted/40 text-muted-foreground border-border/30"
                            }`}>
                                {signal.tier || "FREE"}
                            </span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-1.5">
                                <span className={`text-2xl font-black font-numeric ${confidenceColor(signal.confidence)}`}>
                                    {signal.confidence}%
                                </span>
                                <span className="text-xs text-muted-foreground">confidence</span>
                            </div>

                            <div className="h-5 w-px bg-muted/10" />

                            <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-wider ${strengthStyle.bg} ${strengthStyle.text} ${strengthStyle.border}`}
                            >
                                <Flame size={10} />
                                {signal.strength.replace(/_/g, " ")}
                            </span>

                            <div className="h-5 w-px bg-muted/10" />

                            <span className="text-sm text-muted-foreground">
                                R:R <span className="font-numeric">{signal.riskReward.toFixed(1)}</span>
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {isActive && (
                            <button
                                onClick={handleFollow}
                                disabled={followLoading}
                                className={`inline-flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                                    following
                                        ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                                        : "border-border/30 bg-muted/5 text-foreground hover:bg-muted/10"
                                }`}
                            >
                                {followLoading ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <Heart size={16} className={following ? "fill-primary text-primary" : ""} />
                                )}
                                {following ? "Following" : "Follow"}
                            </button>
                        )}
                        <Link
                            href="/signals/pro"
                            className="inline-flex items-center gap-2 rounded-md border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10"
                        >
                            <Radio size={16} />
                            Pro Feed
                        </Link>
                    </div>
                </div>

                <LivePricePanel signal={signal} lastUpdatedAt={lastUpdatedAt} onRefresh={() => void fetchSignal(user)} />

                <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="space-y-6 lg:col-span-2">
                        <SignalTerminalChart signal={signal} height={460} />

                        <div className="rounded-lg border border-border bg-card p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Signal Levels
                            </h3>
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                                <div className="rounded-lg border border-border/30 bg-muted/50 p-3">
                                    <p className="text-micro uppercase tracking-wider text-muted-foreground">Entry</p>
                                    <p className="mt-1 font-numeric text-lg font-bold text-foreground">
                                        {formatPrice(signal.entry, signal.symbol)}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-negative/30 bg-negative/5 p-3">
                                    <p className="text-micro uppercase tracking-wider text-negative-foreground/70">Stop Loss</p>
                                    <p className="mt-1 font-numeric text-lg font-bold text-negative">
                                        {formatPrice(signal.stopLoss, signal.symbol)}
                                    </p>
                                </div>
                                {signal.tp1 && (
                                    <div className="rounded-lg border border-positive/30 bg-positive/5 p-3">
                                        <p className="text-micro uppercase tracking-wider text-positive-foreground/70">TP1</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice(signal.tp1, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {signal.tp2 && (
                                    <div className="rounded-lg border border-positive/30 bg-positive/5 p-3">
                                        <p className="text-micro uppercase tracking-wider text-positive-foreground/70">TP2</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice(signal.tp2, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {signal.tp3 && (
                                    <div className="rounded-lg border border-positive/30 bg-positive/5 p-3">
                                        <p className="text-micro uppercase tracking-wider text-positive-foreground/70">TP3</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice(signal.tp3, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {signal.tp4 && (
                                    <div className="rounded-lg border border-positive/30 bg-positive/5 p-3">
                                        <p className="text-micro uppercase tracking-wider text-positive-foreground/70">TP4</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice(signal.tp4, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                {(signal as AISignal & { tp5?: number }).tp5 && (
                                    <div className="rounded-lg border border-positive/30 bg-positive/5 p-3">
                                        <p className="text-micro uppercase tracking-wider text-positive-foreground/70">TP5</p>
                                        <p className="mt-1 font-numeric text-lg font-bold text-positive">
                                            {formatPrice((signal as AISignal & { tp5?: number }).tp5!, signal.symbol)}
                                        </p>
                                    </div>
                                )}
                                <div className="rounded-lg border border-info/30 bg-info/5 p-3">
                                    <p className="text-micro uppercase tracking-wider text-info-foreground/70">Risk:Reward</p>
                                    <p className="mt-1 font-numeric text-lg font-bold text-info">
                                        {signal.riskReward.toFixed(1)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <SignalTimeline events={events} />
                    </div>

                    <div className="space-y-6">
                        <ConfidenceBreakdown breakdown={signal.confidenceBreakdown} />

                        <div className="rounded-lg border border-border bg-card p-5">
                            <div className="mb-4 flex items-center gap-2">
                                <Crosshair size={14} className="text-muted-foreground" />
                                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Signal Info
                                </h3>
                            </div>
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
                                    <span className="font-numeric text-xs text-muted-foreground">{signal.engineVersion}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Strategy Version</span>
                                    <span className="font-numeric text-xs text-muted-foreground">{signal.strategyVersion}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Analysis Version</span>
                                    <span className="font-numeric text-xs text-muted-foreground">{signal.analysisVersion || "—"}</span>
                                </div>
                                <div className="h-px bg-muted/5" />
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Created</span>
                                    <span className="text-xs text-muted-foreground">{formatTimeAgo(signal.createdAt)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Followers</span>
                                    <span className="text-sm font-medium font-numeric text-foreground">{signal.followCount}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Trades</span>
                                    <span className="text-sm font-medium font-numeric text-foreground">{signal.tradeCount}</span>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-border bg-card p-5">
                            <div className="mb-4 flex items-center gap-2">
                                <Calculator size={14} className="text-muted-foreground" />
                                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Risk Calculator
                                </h3>
                            </div>
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
                                        {formatPips(Math.abs(signal.entry - signal.stopLoss), signal.symbol)} pips
                                    </span>
                                </div>
                                {signal.tp1 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">TP1 Distance</span>
                                        <span className="font-numeric text-sm font-bold text-positive">
                                            {formatPips(Math.abs(signal.tp1 - signal.entry), signal.symbol)} pips
                                        </span>
                                    </div>
                                )}
                                {signal.tp2 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">TP2 Distance</span>
                                        <span className="font-numeric text-sm font-bold text-positive">
                                            {formatPips(Math.abs(signal.tp2 - signal.entry), signal.symbol)} pips
                                        </span>
                                    </div>
                                )}
                                {signal.tp3 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">TP3 Distance</span>
                                        <span className="font-numeric text-sm font-bold text-positive">
                                            {formatPips(Math.abs(signal.tp3 - signal.entry), signal.symbol)} pips
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

                        <div className="rounded-lg border border-border bg-card p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Actions
                            </h3>
                            <div className="space-y-3">
                                {isActive && (
                                    <button
                                        onClick={handleExecuteTrade}
                                        disabled={executing}
                                        className="flex w-full items-center justify-center gap-2 rounded-md border border-positive/30 bg-positive/10 px-4 py-2.5 text-sm font-medium text-positive transition-colors hover:bg-positive/20 disabled:opacity-50"
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
                                    <div className={`rounded-md border p-3 text-xs ${
                                        executionResult.ok
                                            ? "border-positive/30 bg-positive/10 text-positive-foreground"
                                            : "border-negative/30 bg-negative/10 text-negative-foreground"
                                    }`}>
                                        <p>{executionResult.msg}</p>
                                        {executionResult.commandId && (
                                            <p className="mt-1 text-micro opacity-60">
                                                Command: {executionResult.commandId}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {isActive && (
                                    <button
                                        onClick={handleCancel}
                                        disabled={cancelling}
                                        className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
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
