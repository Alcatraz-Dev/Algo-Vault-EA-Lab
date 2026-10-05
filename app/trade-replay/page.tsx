"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import MarketReplay from "@/components/tradingview/MarketReplay";
import type { AISignal } from "@/lib/ai-signals/types";
import { cn } from "@/lib/utils";
import {
    Award,
    BarChart3,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    CircleSlash,
    Clock,
    ExternalLink,
    Filter,
    Gauge,
    Keyboard,
    Loader2,
    Percent,
    RefreshCw,
    Search,
    Sparkles,
    Target,
    TrendingDown,
    TrendingUp,
    XCircle,
} from "lucide-react";

type Outcome = "WIN" | "LOSS" | "BREAKEVEN" | "OTHER";
type ResultFilter = "ALL" | Outcome;
type SortOrder = "oldest" | "newest";

const OUTCOME_STYLES: Record<Outcome, { bar: string; badge: string; label: string; text: string }> = {
    WIN: { bar: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "WIN", text: "text-emerald-400" },
    LOSS: { bar: "bg-rose-500", badge: "bg-rose-500/15 text-rose-400 border-rose-500/30", label: "LOSS", text: "text-rose-400" },
    BREAKEVEN: { bar: "bg-slate-400", badge: "bg-slate-400/15 text-slate-300 border-slate-400/30", label: "BE", text: "text-slate-300" },
    OTHER: { bar: "bg-amber-500/70", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: "VOID", text: "text-amber-400" },
};

function outcomeOf(signal: AISignal): Outcome {
    if (signal.result === "WIN" || signal.result === "LOSS" || signal.result === "BREAKEVEN") return signal.result;
    return "OTHER"; // EXPIRED / CANCELLED
}

function formatSignedR(value: number | undefined | null): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function formatPrice(value: number | undefined | null): string {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    const n = Number(value);
    if (Math.abs(n) >= 1000) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(4);
    return n.toFixed(5);
}

function formatDateTime(ts?: number): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function TradeReplayPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<"terminal" | "signals">("terminal");

    const [signals, setSignals] = useState<AISignal[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);

    // Signal filters
    const [searchQuery, setSearchQuery] = useState("");
    const [resultFilter, setResultFilter] = useState<ResultFilter>("ALL");
    const [timeframeFilter, setTimeframeFilter] = useState("ALL");
    const [sortOrder, setSortOrder] = useState<SortOrder>("oldest");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
        });
        return () => unsub();
    }, []);

    const loadSignals = useCallback(async (u: User) => {
        setLoading(true);
        setError(null);
        try {
            const token = await u.getIdToken();
            const res = await fetch("/api/ai-signals?limit=200", { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const d = await res.json();
            const completed = ((d.signals ?? []) as AISignal[])
                .filter((s) => s.result && s.result !== "PENDING")
                .sort((a, b) => a.createdAt - b.createdAt);
            setSignals(completed);
            setCurrentIndex(0);
        } catch {
            setError("Could not load signal history. Check your connection and try again.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && user) void loadSignals(user);
    }, [authLoading, user, loadSignals]);

    // ─── Stats over the whole replay library ────────────────────────────────
    const stats = useMemo(() => {
        const resolved = signals.filter((s) => outcomeOf(s) !== "OTHER");
        const wins = resolved.filter((s) => s.result === "WIN").length;
        const losses = resolved.filter((s) => s.result === "LOSS").length;
        const netR = resolved.reduce((acc, s) => acc + (Number(s.resultR) || 0), 0);
        return {
            total: signals.length,
            resolved: resolved.length,
            wins,
            losses,
            winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
            avgR: resolved.length > 0 ? netR / resolved.length : 0,
            netR,
        };
    }, [signals]);

    const timeframes = useMemo(
        () => Array.from(new Set(signals.map((s) => s.timeframe).filter(Boolean))).sort(),
        [signals]
    );

    const filteredSignals = useMemo(() => {
        let list = signals;
        if (resultFilter !== "ALL") list = list.filter((s) => outcomeOf(s) === resultFilter);
        if (timeframeFilter !== "ALL") list = list.filter((s) => s.timeframe === timeframeFilter);
        if (searchQuery.trim() !== "") {
            const q = searchQuery.trim().toLowerCase();
            list = list.filter(
                (s) => s.symbol.toLowerCase().includes(q) || (s.reasoning ?? "").toLowerCase().includes(q)
            );
        }
        return sortOrder === "oldest" ? list : [...list].reverse();
    }, [signals, resultFilter, timeframeFilter, searchQuery, sortOrder]);

    const currentSignal = filteredSignals.length > 0 ? filteredSignals[Math.min(currentIndex, filteredSignals.length - 1)] : null;
    const currentOutcome = currentSignal ? outcomeOf(currentSignal) : null;

    // Keyboard navigation: ← / → steps through the replay timeline
    useEffect(() => {
        if (activeTab !== "signals") return;
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
            if (filteredSignals.length === 0) return;
            if (e.key === "ArrowRight") {
                e.preventDefault();
                setCurrentIndex((i) => Math.min(filteredSignals.length - 1, i + 1));
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                setCurrentIndex((i) => Math.max(0, i - 1));
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [activeTab, filteredSignals]);

    // ─── Loading / auth gates ────────────────────────────────────────────────
    if (authLoading) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <AccountShell title="Trade Replay Studio">
                    <div className="flex min-h-[420px] flex-col items-center justify-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                        <span className="font-mono text-xs text-muted-foreground">Booting replay engine…</span>
                    </div>
                </AccountShell>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <AccountShell title="Trade Replay Studio">
                    <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
                            <Clock size={26} className="text-muted-foreground" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-foreground">Sign in to access Replay Studio</h1>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Bar-by-bar market replay and historical signal walkthroughs require an account.
                            </p>
                        </div>
                        <Link
                            href="/login"
                            className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-violet-500"
                        >
                            Sign in
                        </Link>
                    </div>
                </AccountShell>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell
                title="Market Replay & Simulation Studio"
                subtitle="Bar-by-bar market replay, cut-point selection, paper execution & AI signal validation"
            >
                <div className="space-y-6">
                    {/* Tabs */}
                    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-4">
                        <button
                            type="button"
                            onClick={() => setActiveTab("terminal")}
                            className={cn(
                                "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold shadow-sm transition",
                                activeTab === "terminal"
                                    ? "bg-violet-600 text-white shadow-violet-600/25"
                                    : "bg-muted/50 text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Gauge size={15} /> Replay Terminal
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("signals")}
                            className={cn(
                                "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold shadow-sm transition",
                                activeTab === "signals"
                                    ? "bg-violet-600 text-white shadow-violet-600/25"
                                    : "bg-muted/50 text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Sparkles size={15} /> AI Signal Replay
                            <span
                                className={cn(
                                    "rounded-md px-1.5 py-0.5 font-mono text-[10px]",
                                    activeTab === "signals" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                                )}
                            >
                                {signals.length}
                            </span>
                        </button>
                    </div>

                    {/* Tab 1: Pro Terminal chart replay — same engine, toolbars,
                        drawing tools, layer picker and fullscreen as every
                        other page; the historical replay cursor is wired
                        inside the chart engine. */}
                    {activeTab === "terminal" && (
                        <MarketReplay
                            studies={["MASimple@tv-basicstudies", "MAExp@tv-basicstudies", "BB@tv-basicstudies", "RSI@tv-basicstudies"]}
                            strategyType="strategy"
                        />
                    )}

                    {/* Tab 2: Historical AI Signal Replay Timeline */}
                    {activeTab === "signals" && (
                        <div className="space-y-5">
                            {/* Replay Library Stats */}
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                {[
                                    {
                                        label: "Replay Library",
                                        value: `${stats.total}`,
                                        sub: `${stats.resolved} resolved`,
                                        icon: BarChart3,
                                        tone: "text-violet-400",
                                    },
                                    {
                                        label: "Win Rate",
                                        value: stats.resolved > 0 ? `${stats.winRate.toFixed(1)}%` : "—",
                                        sub: `${stats.wins}W / ${stats.losses}L`,
                                        icon: Percent,
                                        tone: stats.resolved > 0 ? "text-emerald-400" : "text-muted-foreground",
                                    },
                                    {
                                        label: "Avg R",
                                        value: stats.resolved > 0 ? formatSignedR(stats.avgR) : "—",
                                        sub: "per resolved signal",
                                        icon: Target,
                                        tone: stats.resolved === 0 ? "text-muted-foreground" : stats.avgR >= 0 ? "text-emerald-400" : "text-rose-400",
                                    },
                                    {
                                        label: "Net R",
                                        value: stats.resolved > 0 ? formatSignedR(stats.netR) : "—",
                                        sub: "cumulative return",
                                        icon: Award,
                                        tone: stats.resolved === 0 ? "text-muted-foreground" : stats.netR >= 0 ? "text-emerald-400" : "text-rose-400",
                                    },
                                ].map((card) => (
                                    <div
                                        key={card.label}
                                        className="rounded-2xl border border-border/80 bg-card/80 p-4 shadow-xs backdrop-blur-sm"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                {card.label}
                                            </span>
                                            <card.icon size={14} className={card.tone} />
                                        </div>
                                        <div className={cn("mt-2 font-mono text-xl font-extrabold", card.tone)}>{card.value}</div>
                                        <div className="mt-0.5 text-[10px] text-muted-foreground">{card.sub}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Filters Bar */}
                            <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/80 p-3.5 backdrop-blur-xl lg:flex-row lg:items-center">
                                <div className="relative flex flex-1 items-center">
                                    <Search size={15} className="absolute left-3 text-muted-foreground" />
                                    <input
                                        type="text"
                                        placeholder="Search symbol or reasoning (e.g. XAUUSD)…"
                                        value={searchQuery}
                                        onChange={(e) => {
                                            setSearchQuery(e.target.value);
                                            setCurrentIndex(0);
                                        }}
                                        className="w-full rounded-xl border border-border bg-background py-1.5 pl-9 pr-3 font-mono text-xs outline-none transition focus:border-violet-500"
                                    />
                                </div>

                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                        <Filter size={13} /> Outcome:
                                    </span>
                                    {(["ALL", "WIN", "LOSS", "BREAKEVEN", "OTHER"] as const).map((res) => {
                                        const active = resultFilter === res;
                                        const style = res === "ALL" ? null : OUTCOME_STYLES[res];
                                        return (
                                            <button
                                                key={res}
                                                type="button"
                                                title={res === "OTHER" ? "Expired or cancelled signals" : undefined}
                                                onClick={() => {
                                                    setResultFilter(res);
                                                    setCurrentIndex(0);
                                                }}
                                                className={cn(
                                                    "rounded-xl px-3 py-1.5 text-xs font-bold transition",
                                                    active
                                                        ? "border border-violet-500/30 bg-violet-500/20 text-violet-300"
                                                        : "bg-muted/40 text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                {res === "ALL" ? "ALL" : style?.label}
                                            </button>
                                        );
                                    })}

                                    <select
                                        value={timeframeFilter}
                                        onChange={(e) => {
                                            setTimeframeFilter(e.target.value);
                                            setCurrentIndex(0);
                                        }}
                                        className="h-8 rounded-xl border border-border bg-background px-2.5 font-mono text-xs text-muted-foreground outline-none transition"
                                    >
                                        <option value="ALL">All TFs</option>
                                        {timeframes.map((tf) => (
                                            <option key={tf} value={tf}>{tf}</option>
                                        ))}
                                    </select>

                                    <select
                                        value={sortOrder}
                                        onChange={(e) => {
                                            setSortOrder(e.target.value as SortOrder);
                                            setCurrentIndex(0);
                                        }}
                                        className="h-8 rounded-xl border border-border bg-background px-2.5 font-mono text-xs text-muted-foreground outline-none transition"
                                    >
                                        <option value="oldest">Oldest first</option>
                                        <option value="newest">Newest first</option>
                                    </select>

                                    <button
                                        type="button"
                                        onClick={() => user && void loadSignals(user)}
                                        disabled={loading}
                                        className="flex h-8 items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                                        title="Reload signal history"
                                    >
                                        <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                                    <span>{error}</span>
                                    <button
                                        type="button"
                                        onClick={() => user && void loadSignals(user)}
                                        className="flex items-center gap-1.5 rounded-lg bg-rose-500/20 px-3 py-1.5 font-bold text-rose-200 transition hover:bg-rose-500/30"
                                    >
                                        <RefreshCw size={12} /> Retry
                                    </button>
                                </div>
                            )}

                            {loading && signals.length === 0 ? (
                                <div className="space-y-3 rounded-2xl border border-border/60 bg-card/40 p-6">
                                    <div className="h-8 w-1/3 animate-pulse rounded-lg bg-muted/60" />
                                    <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
                                    <div className="h-5 animate-pulse rounded-lg bg-muted/60" />
                                    <div className="h-[420px] animate-pulse rounded-2xl bg-muted/30" />
                                </div>
                            ) : currentSignal && currentOutcome ? (
                                <>
                                    {/* Signal Detail Panel */}
                                    <div className="space-y-5 rounded-2xl border border-border/80 bg-card/90 p-5 shadow-xl sm:p-6">
                                        {/* Header strip */}
                                        <div className="flex flex-col justify-between gap-4 border-b border-border/40 pb-5 md:flex-row md:items-center">
                                            <div className="flex items-center gap-4">
                                                <div
                                                    className={cn(
                                                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-xl font-bold shadow-sm",
                                                        currentSignal.direction === "BUY"
                                                            ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                                                            : "border-rose-500/30 bg-rose-500/15 text-rose-400"
                                                    )}
                                                >
                                                    {currentSignal.direction === "BUY" ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
                                                </div>
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-mono text-2xl font-extrabold text-foreground">
                                                            {currentSignal.symbol}
                                                        </span>
                                                        <span
                                                            className={cn(
                                                                "rounded-lg border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider",
                                                                currentSignal.direction === "BUY"
                                                                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                                                    : "border-rose-500/20 bg-rose-500/10 text-rose-400"
                                                            )}
                                                        >
                                                            {currentSignal.direction}
                                                        </span>
                                                        <span className="rounded-lg bg-muted px-2.5 py-0.5 font-mono text-xs text-muted-foreground">
                                                            {currentSignal.timeframe}
                                                        </span>
                                                        <span
                                                            className={cn(
                                                                "rounded-lg border px-2.5 py-0.5 text-xs font-bold",
                                                                OUTCOME_STYLES[currentOutcome].badge
                                                            )}
                                                        >
                                                            {OUTCOME_STYLES[currentOutcome].label} {formatSignedR(currentSignal.resultR)}
                                                        </span>
                                                    </div>
                                                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                                                        <span>Entry <strong className="text-foreground">{formatPrice(currentSignal.entry)}</strong></span>
                                                        <span>SL <strong className="text-rose-400">{formatPrice(currentSignal.stopLoss)}</strong></span>
                                                        <span>TP1 <strong className="text-emerald-400">{formatPrice(currentSignal.tp1)}</strong></span>
                                                        <span>Confidence <strong className="text-violet-400">{Math.round(currentSignal.confidence)}%</strong></span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="text-left font-mono text-xs text-muted-foreground md:text-right">
                                                <span>
                                                    Signal #{Math.min(currentIndex, filteredSignals.length - 1) + 1} of {filteredSignals.length}
                                                </span>
                                                <div className="mt-1 text-[11px] text-muted-foreground/70">
                                                    Triggered {formatDateTime(currentSignal.createdAt)}
                                                </div>
                                                <Link
                                                    href={`/signals/${currentSignal.id}`}
                                                    className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:border-violet-500/40 hover:text-violet-300"
                                                >
                                                    <ExternalLink size={11} /> Open full dossier
                                                </Link>
                                            </div>
                                        </div>

                                        {/* Levels + reasoning grid */}
                                        <div className="grid gap-5 lg:grid-cols-5">
                                            {/* Price ladder */}
                                            <div className="space-y-2 lg:col-span-2">
                                                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                    Execution ladder
                                                </div>
                                                {[
                                                    {
                                                        key: "entry",
                                                        label: "Entry",
                                                        value: currentSignal.entry,
                                                        tone: "border-violet-500/20 bg-violet-500/5",
                                                        hit: null as boolean | null,
                                                    },
                                                    {
                                                        key: "sl",
                                                        label: "Stop Loss",
                                                        value: currentSignal.stopLoss,
                                                        tone: "border-rose-500/20 bg-rose-500/5",
                                                        hit: currentOutcome === "LOSS" ? true : null,
                                                    },
                                                    {
                                                        key: "tp1",
                                                        label: "TP1",
                                                        value: currentSignal.tp1,
                                                        tone: "border-emerald-500/20 bg-emerald-500/5",
                                                        hit: currentSignal.tp1Hit ? true : null,
                                                    },
                                                    {
                                                        key: "tp2",
                                                        label: "TP2",
                                                        value: currentSignal.tp2,
                                                        tone: "border-emerald-500/20 bg-emerald-500/5",
                                                        hit: currentSignal.tp2Hit ? true : null,
                                                    },
                                                    {
                                                        key: "tp3",
                                                        label: "TP3",
                                                        value: currentSignal.tp3,
                                                        tone: "border-emerald-500/20 bg-emerald-500/5",
                                                        hit: currentSignal.tp3Hit ? true : null,
                                                    },
                                                ]
                                                    .filter((level) => level.value != null && Number(level.value) !== 0)
                                                    .map((level) => (
                                                        <div
                                                            key={level.key}
                                                            className={cn(
                                                                "flex items-center justify-between rounded-xl border px-3 py-2 font-mono text-xs",
                                                                level.tone
                                                            )}
                                                        >
                                                            <span className="flex items-center gap-2 text-muted-foreground">
                                                                {level.hit === true ? (
                                                                    <CheckCircle2 size={13} className="text-emerald-400" />
                                                                ) : level.hit === false ? (
                                                                    <XCircle size={13} className="text-muted-foreground/40" />
                                                                ) : (
                                                                    <span className="inline-block h-3 w-[1px] bg-current opacity-40" />
                                                                )}
                                                                {level.label}
                                                            </span>
                                                            <span className="font-semibold text-foreground">{formatPrice(level.value)}</span>
                                                        </div>
                                                    ))}
                                                <div className="flex flex-wrap gap-2 pt-1 text-[10px] font-bold uppercase tracking-wider">
                                                    <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                                                        R:R 1:{(Number(currentSignal.riskReward) || 0).toFixed(1)}
                                                    </span>
                                                    {currentSignal.strength && (
                                                        <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                                                            {currentSignal.strength.replace("_", " ")}
                                                        </span>
                                                    )}
                                                    {currentSignal.marketRegime && (
                                                        <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                                                            {currentSignal.marketRegime}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Confidence + reasoning */}
                                            <div className="space-y-3 lg:col-span-3">
                                                <div className="rounded-xl border border-border/60 bg-background/50 p-4">
                                                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                                        <span className="flex items-center gap-1.5">
                                                            <Sparkles size={12} className="text-violet-400" /> Engine confidence
                                                        </span>
                                                        <span className="font-mono text-violet-300">{Math.round(currentSignal.confidence)}%</span>
                                                    </div>
                                                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                                                        <div
                                                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all"
                                                            style={{ width: `${Math.min(100, Math.max(0, currentSignal.confidence))}%` }}
                                                        />
                                                    </div>
                                                    <p className="mt-3 line-clamp-4 text-xs leading-relaxed text-muted-foreground">
                                                        {currentSignal.reasoning || "No engine reasoning recorded for this signal."}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                                                    <Keyboard size={13} />
                                                    Use ← / → to step through the replay timeline
                                                </div>
                                            </div>
                                        </div>

                                        {/* Timeline scrubber */}
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
                                                <span className="flex items-center gap-3">
                                                    Signal timeline
                                                    <span className="flex items-center gap-2 text-[10px]">
                                                        {(["WIN", "LOSS", "BREAKEVEN", "OTHER"] as Outcome[]).map((o) => (
                                                            <span key={o} className="flex items-center gap-1">
                                                                <span className={cn("inline-block h-2 w-2 rounded-full", OUTCOME_STYLES[o].bar)} />
                                                                {OUTCOME_STYLES[o].label}
                                                            </span>
                                                        ))}
                                                    </span>
                                                </span>
                                                <span>Select a bar to load its replay context</span>
                                            </div>
                                            <div className="flex h-5 items-center gap-[3px] overflow-x-auto rounded-xl bg-muted/60 p-1">
                                                {filteredSignals.map((s, i) => {
                                                    const outcome = outcomeOf(s);
                                                    const active = i === Math.min(currentIndex, filteredSignals.length - 1);
                                                    return (
                                                        <button
                                                            key={s.id ?? i}
                                                            type="button"
                                                            className={cn(
                                                                "h-full min-w-[5px] flex-1 cursor-pointer rounded-md transition-all",
                                                                OUTCOME_STYLES[outcome].bar,
                                                                active ? "z-10 scale-110 ring-2 ring-violet-500" : "opacity-80 hover:opacity-100"
                                                            )}
                                                            style={{ flex: 1 }}
                                                            onClick={() => setCurrentIndex(i)}
                                                            title={`${s.symbol} ${s.direction} · ${s.timeframe} · ${OUTCOME_STYLES[outcome].label} ${formatSignedR(s.resultR)} · ${formatDateTime(s.createdAt)}`}
                                                        />
                                                    );
                                                })}
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <button
                                                    type="button"
                                                    disabled={currentIndex <= 0}
                                                    onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                                                    className="flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                                                >
                                                    <ChevronLeft size={13} /> Prev
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={currentIndex >= filteredSignals.length - 1}
                                                    onClick={() => setCurrentIndex((i) => Math.min(filteredSignals.length - 1, i + 1))}
                                                    className="flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                                                >
                                                    Next <ChevronRight size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Chart replaying the selected signal's market */}
                                    <MarketReplay
                                        key={currentSignal.id}
                                        symbol={currentSignal.symbol}
                                        interval={currentSignal.timeframe}
                                        studies={["MASimple@tv-basicstudies", "BB@tv-basicstudies"]}
                                        strategyType="indicator"
                                    />
                                </>
                            ) : (
                                <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-10 text-center">
                                    <CircleSlash size={28} className="text-muted-foreground/60" />
                                    <p className="font-mono text-xs text-muted-foreground">
                                        {signals.length === 0
                                            ? "No completed historical signals yet — resolved signals will appear here once the engine closes them out."
                                            : "No signals match the current filters. Try clearing the search or switching outcome."}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </AccountShell>
        </div>
    );
}
