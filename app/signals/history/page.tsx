"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Calendar,
    ChevronDown,
    Loader2,
    RefreshCw,
    Search,
    Shield,
    Target,
    TrendingDown,
    TrendingUp,
    Radio,
    BarChart3,
    Zap,
    Award,
    AlertTriangle,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { calculateProfitUSD } from "@/lib/ai-signals/calculations";
import type { AISignal, SignalResult, SignalStats } from "@/lib/ai-signals/types";

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

const TIMEFRAMES = ["M1", "M5", "M15", "H1", "H4", "D1"];
const AUTO_REFRESH_MS = 30_000;

/* ─── helpers ─── */

function resultBadge(result: SignalResult, resultR: number) {
    const map: Record<SignalResult, { label: string; color: string; bg: string }> = {
        WIN:       { label: "WIN",       color: "text-positive", bg: "bg-positive/10 border-positive/20" },
        LOSS:      { label: "LOSS",      color: "text-negative",     bg: "bg-negative/10 border-negative/20" },
        BREAKEVEN: { label: "BE",        color: "text-muted-foreground",   bg: "bg-muted/10 border-border/20" },
        EXPIRED:   { label: "EXPIRED",   color: "text-warning",   bg: "bg-warning/10 border-warning/20" },
        CANCELLED: { label: "CANCELLED", color: "text-muted-foreground",   bg: "bg-muted/10 border-border/20" },
        PENDING:   { label: "ACTIVE",    color: "text-info",    bg: "bg-info/10 border-info/20" },
    };
    const badge = map[result] ?? map.PENDING;
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-bold ${badge.bg} ${badge.color}`}>
            {badge.label}
            {resultR !== 0 && result !== "PENDING" && (
                <span className="ml-0.5 opacity-80">{resultR > 0 ? "+" : ""}{resultR.toFixed(2)}R</span>
            )}
        </span>
    );
}

function formatPrice(value: number | undefined | null): string {
    if (value == null || isNaN(Number(value))) return "—";
    const n = Number(value);
    if (n >= 1000) return n.toFixed(2);
    if (n >= 1)    return n.toFixed(4);
    return n.toFixed(5);
}

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000)    return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

/* ─── Equity Curve Canvas ─── */

function EquityCurveChart({ signals }: { signals: AISignal[] }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width  = rect.width  * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;

        const completed = [...signals]
            .filter((s) => s.result === "WIN" || s.result === "LOSS" || s.result === "BREAKEVEN")
            .sort((a, b) => a.createdAt - b.createdAt);

        ctx.fillStyle = "#0b0c0e";
        ctx.fillRect(0, 0, w, h);

        if (completed.length < 2) {
            ctx.fillStyle = "rgba(100,116,139,0.45)";
            ctx.font = "11px system-ui";
            ctx.textAlign = "center";
            ctx.fillText("Not enough completed signals", w / 2, h / 2 + 4);
            return;
        }

        let cumR = 0;
        const points = [0, ...completed.map((s) => { cumR += Number(s.resultR || 0); return cumR; })];

        const maxR  = Math.max(...points,  0.1);
        const minR  = Math.min(...points, -0.1);
        const range = maxR - minR || 1;
        const padX = 10, padY = 12;
        const chartW = w - padX * 2;
        const chartH = h - padY * 2;

        const xOf = (i: number) => padX + (i / (points.length - 1)) * chartW;
        const yOf = (r: number) => padY + ((maxR - r) / range) * chartH;

        // grid lines
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 0.5;
        [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
            const y = padY + t * chartH;
            ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(w - padX, y); ctx.stroke();
        });

        // zero line
        const zeroY = yOf(0);
        if (zeroY >= padY && zeroY <= padY + chartH) {
            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(padX, zeroY); ctx.lineTo(w - padX, zeroY); ctx.stroke();
            ctx.setLineDash([]);
        }

        const finalR    = points[points.length - 1];
        const isPositive = finalR >= 0;
        const lineColor  = isPositive ? "#30d697" : "#ff645f";

        // gradient fill
        const grad = ctx.createLinearGradient(0, padY, 0, h - padY);
        grad.addColorStop(0, isPositive ? "rgba(48,214,151,0.28)" : "rgba(255,100,95,0.28)");
        grad.addColorStop(1, "rgba(11,12,14,0)");

        ctx.beginPath();
        ctx.moveTo(xOf(0), yOf(points[0]));
        for (let i = 1; i < points.length; i++) ctx.lineTo(xOf(i), yOf(points[i]));
        ctx.lineTo(xOf(points.length - 1), h);
        ctx.lineTo(xOf(0), h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // main line
        ctx.beginPath();
        ctx.moveTo(xOf(0), yOf(points[0]));
        for (let i = 1; i < points.length; i++) ctx.lineTo(xOf(i), yOf(points[i]));
        ctx.strokeStyle = lineColor;
        ctx.lineWidth   = 1.8;
        ctx.lineJoin    = "round";
        ctx.stroke();

        // end dot
        const ex = xOf(points.length - 1);
        const ey = yOf(finalR);
        ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = lineColor; ctx.fill();

        // R label at end
        ctx.fillStyle = lineColor;
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "right";
        ctx.fillText(`${finalR >= 0 ? "+" : ""}${finalR.toFixed(2)}R`, w - padX - 5, ey - 6);

    }, [signals]);

    return <canvas ref={canvasRef} className="w-full h-full block" />;
}

/* ─── Stat card components ─── */

function StatCard({ label, value, sub, color = "text-foreground" }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div className="rounded-lg border border-border/30 bg-card p-4 text-center">
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={`mt-1.5 font-numeric text-2xl font-black ${color}`}>{value}</p>
            {sub && <p className="mt-0.5 text-micro text-muted-foreground">{sub}</p>}
        </div>
    );
}

function BySymbolBreakdown({ signals }: { signals: AISignal[] }) {
    const breakdown = useMemo(() => {
        const map: Record<string, { count: number; wins: number; totalR: number; totalUSD: number }> = {};
        for (const s of signals) {
            if (!map[s.symbol]) map[s.symbol] = { count: 0, wins: 0, totalR: 0, totalUSD: 0 };
            map[s.symbol].count++;

            // Use the same resolution logic as the server statistics engine:
            // if the signal has a stored non-PENDING result, use it directly;
            // otherwise derive it deterministically from status + tp hits.
            const rawResult  = s.result && s.result !== "PENDING" ? s.result : null;
            const rawResultR = rawResult ? Number(s.resultR || 0) : null;

            // Derive from status when raw result is still PENDING
            let resolvedResult  = rawResult;
            let resolvedR       = rawResultR ?? 0;

            if (!resolvedResult) {
                const TERMINAL_TRADED = ["STOPPED", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"];
                const TERMINAL_CANCEL = ["CANCELLED", "EXPIRED"];
                if (TERMINAL_CANCEL.includes(s.status)) {
                    resolvedResult = s.status === "CANCELLED" ? "CANCELLED" : "EXPIRED";
                } else if (TERMINAL_TRADED.includes(s.status)) {
                    const riskPts = Math.abs(s.entry - s.stopLoss);
                    if (riskPts > 0) {
                        const rTp1 = s.tp1 ? Math.abs(s.tp1 - s.entry) / riskPts : 0;
                        const rTp2 = s.tp2 ? Math.abs(s.tp2 - s.entry) / riskPts : 0;
                        const rTp3 = s.tp3 ? Math.abs(s.tp3 - s.entry) / riskPts : 0;
                        const tp3Hit = s.tp3Hit || ["TP3_HIT","RUNNER","COMPLETED"].includes(s.status);
                        const tp2Hit = s.tp2Hit || ["TP2_HIT","TP3_HIT","RUNNER","COMPLETED"].includes(s.status);
                        const tp1Hit = s.tp1Hit || ["TP1_HIT","TP2_HIT","TP3_HIT","RUNNER","COMPLETED"].includes(s.status);
                        let r = 0;
                        if (tp3Hit)       r = 0.3*rTp1 + 0.3*rTp2 + 0.4*rTp3;
                        else if (tp2Hit)  r = 0.3*rTp1 + 0.3*rTp2;
                        else if (tp1Hit)  r = 0.3*rTp1;
                        else               r = -1;
                        resolvedR      = Math.round(r * 1000) / 1000;
                        resolvedResult = resolvedR > 0.05 ? "WIN" : resolvedR < -0.05 ? "LOSS" : "BREAKEVEN";
                    }
                }
            }

            if (resolvedResult === "WIN") map[s.symbol].wins++;
            if (resolvedResult === "WIN" || resolvedResult === "LOSS" || resolvedResult === "BREAKEVEN") {
                map[s.symbol].totalR += resolvedR;
                const tp3Hit = s.tp3Hit || ["TP3_HIT","RUNNER","COMPLETED"].includes(s.status);
                const tp2Hit = s.tp2Hit || ["TP2_HIT"].includes(s.status);
                const exit = resolvedResult === "LOSS" || s.status === "STOPPED"
                    ? (s.stopLoss || s.entry)
                    : (tp3Hit && s.tp3 ? s.tp3 : tp2Hit && s.tp2 ? s.tp2 : s.tp1 || s.entry);
                map[s.symbol].totalUSD += calculateProfitUSD(s.symbol, s.direction, s.entry, exit, 0.01);
            }
        }
        return Object.entries(map)
            .map(([sym, d]) => ({
                sym,
                count: d.count,
                winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0,
                totalR: d.totalR,
                totalUSD: d.totalUSD,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);
    }, [signals]);

    if (breakdown.length === 0) return null;

    return (
        <div className="mt-6 rounded-lg border border-border/30 bg-card p-4">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Performance by Symbol</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {breakdown.map(({ sym, count, winRate, totalR, totalUSD }) => (
                    <div key={sym} className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-foreground">{sym}</span>
                            <span className={`text-micro font-semibold ${winRate >= 50 ? "text-positive" : "text-negative"}`}>
                                {winRate.toFixed(0)}% WR
                            </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-micro text-muted-foreground">
                            <span>{count} signals</span>
                            <span className={totalUSD >= 0 ? "text-positive font-bold font-numeric" : "text-negative font-bold font-numeric"}>
                                {totalUSD >= 0 ? "+$" : "-$"}{Math.abs(totalUSD).toFixed(2)} <span className="font-normal opacity-75">({totalR >= 0 ? "+" : ""}{totalR.toFixed(2)}R)</span>
                            </span>
                        </div>
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/30">
                            <div
                                className={`h-full rounded-full transition-all ${winRate >= 50 ? "bg-positive" : "bg-negative"}`}
                                style={{ width: `${Math.min(winRate, 100)}%` }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ─── Page ─── */

export default function SignalHistoryPage() {
    const [user,          setUser]          = useState<User | null>(null);
    const [hasPro,        setHasPro]        = useState(false);
    const [authLoading,   setAuthLoading]   = useState(true);

    // Signals (list)
    const [signals,       setSignals]       = useState<AISignal[]>([]);
    const [signalsLoading, setSignalsLoading] = useState(false);

    // Stats (from /api/signals/stats)
    const [stats,         setStats]         = useState<SignalStats | null>(null);
    const [statsLoading,  setStatsLoading]  = useState(false);

    const [lastRefreshedAt, setLastRefreshedAt] = useState(0);
    const [totalInDb, setTotalInDb] = useState<number | null>(null); // from /api/signals/history `total`

    // Filters
    const [period,          setPeriod]          = useState<PeriodFilter>("all");
    const [tierFilter,      setTierFilter]      = useState<"FREE" | "PRO" | "all">("all");
    const [timeframeFilter, setTimeframeFilter] = useState<string>("all");
    const [directionFilter, setDirectionFilter] = useState<"BUY" | "SELL" | "all">("all");
    const [search,          setSearch]          = useState("");
    const [periodOpen,      setPeriodOpen]      = useState(false);

    /* ── auth ── */
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
            if (!u) { setSignals([]); setStats(null); setTotalInDb(null); }
        });
        return () => unsub();
    }, []);

    /* ── subscription check ── */
    useEffect(() => {
        if (!user) return;
        user.getIdToken().then((token) => {
            fetch("/api/subscription-status", { headers: { Authorization: `Bearer ${token}` } })
                .then((r) => r.json())
                .then((d) => setHasPro(Boolean(d.hasSubscription)))
                .catch(() => setHasPro(false));
        });
    }, [user]);

    /* ── Fetch filtered signals from /api/signals/history ── */
    const fetchSignals = useCallback(async (u: User | null) => {
        if (!u) return;
        setSignalsLoading(true);
        try {
            const token = await u.getIdToken(true);
            const params = new URLSearchParams({ period, limit: "500" });
            if (tierFilter      !== "all") params.set("tier",      tierFilter);
            if (timeframeFilter !== "all") params.set("timeframe", timeframeFilter);
            if (directionFilter !== "all") params.set("direction", directionFilter);

            const res  = await fetch(`/api/signals/history?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.signals) setSignals(data.signals);
            // Unfiltered total (all time) powers the "signals in database" badge.
            if (data.totalAllTime != null) {
                setTotalInDb(data.totalAllTime);
            } else if (period === "all" && data.total != null) {
                setTotalInDb(data.total);
            }
        } catch (err) {
            console.error("History signals fetch error:", err);
        } finally {
            setSignalsLoading(false);
        }
    }, [period, tierFilter, timeframeFilter, directionFilter]);

    /* ── Fetch rich stats from /api/signals/stats ── */
    const fetchStats = useCallback(async (u: User | null) => {
        if (!u) return;
        setStatsLoading(true);
        try {
            const token = await u.getIdToken();
            const params = new URLSearchParams({ period });
            if (tierFilter      !== "all") params.set("tier",      tierFilter);
            if (timeframeFilter !== "all") params.set("timeframe", timeframeFilter);
            if (directionFilter !== "all") params.set("direction", directionFilter);

            const res  = await fetch(`/api/signals/stats?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.stats) setStats(data.stats);
        } catch (err) {
            console.error("Stats fetch error:", err);
        } finally {
            setStatsLoading(false);
            setLastRefreshedAt(Date.now());
        }
    }, [period, tierFilter, timeframeFilter, directionFilter]);

    /* ── Load on mount / filter change ── */
    useEffect(() => {
        if (!user) return;
        void Promise.all([fetchSignals(user), fetchStats(user)]);
    }, [user, fetchSignals, fetchStats]);

    /* ── 30 s auto-refresh ── */
    useEffect(() => {
        if (!user) return;
        const interval = setInterval(() => {
            void Promise.allSettled([fetchSignals(user), fetchStats(user)]);
        }, AUTO_REFRESH_MS);
        return () => clearInterval(interval);
    }, [user, fetchSignals, fetchStats]);

    /* ── Client-side search filter ── */
    const filtered = useMemo(() => {
        if (!search.trim()) return signals;
        const q = search.toLowerCase().trim();
        return signals.filter((s) => s.symbol.toLowerCase().includes(q) || s.direction.toLowerCase().includes(q));
    }, [signals, search]);

    /* ── Loading state ── */
    if (authLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <div className="text-center">
                    <p className="text-sm text-muted-foreground">Sign in to view signal history.</p>
                    <Link href="/login" className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
                        Sign In
                    </Link>
                </div>
            </div>
        );
    }

    const secondsSinceRefresh = lastRefreshedAt > 0 ? Math.round((Date.now() - lastRefreshedAt) / 1000) : null;
    const isRefreshing = signalsLoading || statsLoading;

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

                {/* ── Back link ── */}
                <Link href="/signals" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
                    <ArrowLeft size={16} />
                    Back to Signals
                </Link>

                {/* ── Page header ── */}
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between" data-guide="page-header">
                    <div>
                        <div className="flex items-center gap-2 text-sm text-primary font-semibold">
                            <Calendar className="h-4 w-4" />
                            Signal History
                        </div>
                        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                            History &amp; Results
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                            Every signal generated by the AI engine — winners, losers, expired, and cancelled — tracked with full result calculation based on the trade-management model.
                        </p>

                        {/* live badge */}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-0.5 text-micro font-semibold text-positive">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-positive" />
                                Live
                            </span>
                            {totalInDb !== null && (
                                <span className="text-xs text-muted-foreground">
                                    {totalInDb} signals in database
                                </span>
                            )}
                            {hasPro && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-micro font-semibold text-primary">
                                    <Zap size={9} className="fill-current" />
                                    PRO
                                </span>
                            )}
                        </div>
                    </div>

                    {/* refresh controls */}
                    <div className="flex shrink-0 items-center gap-3">
                        {secondsSinceRefresh !== null && (
                            <span className="text-micro text-muted-foreground">
                                Updated {secondsSinceRefresh}s ago
                            </span>
                        )}
                        <button
                            onClick={() => void Promise.all([fetchSignals(user), fetchStats(user)])}
                            disabled={isRefreshing}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border/30 bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border/50 hover:text-foreground disabled:opacity-40"
                        >
                            <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
                            {isRefreshing ? "Refreshing…" : "Refresh"}
                        </button>
                    </div>
                </div>

                {/* ── Filters ── */}
                <div className="mt-6 flex flex-wrap items-center gap-2" data-guide="filters">
                    {/* Period dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setPeriodOpen(!periodOpen)}
                            className="flex h-8 items-center gap-1.5 rounded-md border border-border/30 bg-card px-3 text-xs text-muted-foreground transition-colors hover:border-border/50 hover:text-foreground"
                        >
                            <Calendar size={12} />
                            {PERIOD_OPTIONS.find((o) => o.value === period)?.label}
                            <ChevronDown size={12} />
                        </button>
                        {periodOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setPeriodOpen(false)} />
                                <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-lg border border-border/30 bg-popover p-1 shadow-lg">
                                    {PERIOD_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            onClick={() => { setPeriod(opt.value); setPeriodOpen(false); }}
                                            className={`flex w-full items-center rounded-md px-3 py-1.5 text-xs transition-colors ${period === opt.value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/5 hover:text-foreground"}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Tier toggle */}
                    <div className="flex items-center gap-0.5 rounded-lg border border-border/30 bg-card/40 p-0.5">
                        {TIER_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => setTierFilter(opt.value)}
                                className={`rounded-md px-2.5 py-1 text-micro font-medium transition-all ${tierFilter === opt.value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {/* Timeframe toggle */}
                    <div className="flex items-center gap-0.5 rounded-lg border border-border/30 bg-card/40 p-0.5">
                        <button
                            onClick={() => setTimeframeFilter("all")}
                            className={`rounded-md px-2.5 py-1 text-micro font-medium transition-all ${timeframeFilter === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                        >
                            All TF
                        </button>
                        {TIMEFRAMES.map((tf) => (
                            <button
                                key={tf}
                                onClick={() => setTimeframeFilter(tf)}
                                className={`rounded-md px-2.5 py-1 text-micro font-medium transition-all ${timeframeFilter === tf ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>

                    {/* Direction toggle */}
                    <div className="flex items-center gap-0.5 rounded-lg border border-border/30 bg-card/40 p-0.5">
                        {(["all", "BUY", "SELL"] as const).map((dir) => (
                            <button
                                key={dir}
                                onClick={() => setDirectionFilter(dir)}
                                className={`rounded-md px-2.5 py-1 text-micro font-medium transition-all ${directionFilter === dir ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
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
                            placeholder="Search symbol…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-8 w-44 rounded-lg border border-border/30 bg-card/40 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-warning/30"
                        />
                    </div>
                </div>

                {/* ── Stats grid — from /api/signals/stats ── */}
                {statsLoading && !stats ? (
                    <div className="mt-6 grid gap-3 sm:grid-cols-6">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-24 animate-pulse rounded-xl border border-border/20 bg-card/40" />
                        ))}
                    </div>
                ) : stats ? (
                    <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-guide="stats">
                        <StatCard
                            label="Total Signals"
                            value={String(stats.totalSignals)}
                            sub={`${stats.winningSignals}W · ${stats.losingSignals}L · ${stats.breakevenSignals}BE`}
                        />
                        <StatCard
                            label="Win Rate"
                            value={`${stats.winRate.toFixed(1)}%`}
                            sub={`${stats.winningSignals} wins`}
                            color={stats.winRate >= 50 ? "text-positive" : "text-negative"}
                        />
                        <StatCard
                            label="Total R"
                            value={`${stats.totalR >= 0 ? "+" : ""}${stats.totalR.toFixed(2)}R`}
                            sub={`Avg ${stats.averageR >= 0 ? "+" : ""}${stats.averageR.toFixed(2)}R/trade`}
                            color={stats.totalR >= 0 ? "text-positive" : "text-negative"}
                        />
                        <StatCard
                            label="Profit Factor"
                            value={
                                stats.profitFactor === null
                                    ? "∞"
                                    : stats.profitFactor > 0
                                    ? stats.profitFactor.toFixed(2)
                                    : "—"
                            }
                            sub={
                                stats.profitFactor === null
                                    ? "Perfect (no losses)"
                                    : stats.profitFactor >= 2
                                    ? "Excellent"
                                    : stats.profitFactor >= 1.5
                                    ? "Good"
                                    : stats.profitFactor >= 1
                                    ? "Break-even"
                                    : "Below 1"
                            }
                            color={
                                stats.profitFactor === null
                                    ? "text-positive"
                                    : stats.profitFactor >= 1.5
                                    ? "text-positive"
                                    : stats.profitFactor >= 1
                                    ? "text-warning"
                                    : "text-negative"
                            }
                        />
                        <StatCard
                            label="Best Streak"
                            value={`${stats.maxWinningStreak}W`}
                            sub={`Worst: ${stats.maxLosingStreak}L`}
                            color="text-info"
                        />
                        <StatCard
                            label="Max Drawdown"
                            value={stats.maxDrawdown > 0 ? `-${stats.maxDrawdown.toFixed(2)}R` : "0R"}
                            sub={`TP1: ${stats.tp1HitRate.toFixed(0)}% hit rate`}
                            color={stats.maxDrawdown > 3 ? "text-negative" : "text-warning"}
                        />
                    </div>
                ) : null}

                {/* ── TP hit rates ── */}
                {stats && (stats.tp1HitRate > 0 || stats.tp2HitRate > 0 || stats.tp3HitRate > 0) && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        {[
                            { label: "TP1 Hit Rate", rate: stats.tp1HitRate, color: "bg-positive" },
                            { label: "TP2 Hit Rate", rate: stats.tp2HitRate, color: "bg-info" },
                            { label: "TP3 Hit Rate", rate: stats.tp3HitRate, color: "bg-chart-3" },
                        ].map(({ label, rate, color }) => (
                            <div key={label} className="rounded-xl border border-border/30 bg-card/60 px-4 py-3 backdrop-blur-xl">
                                <div className="mb-1.5 flex items-center justify-between">
                                    <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
                                    <span className="text-xs font-bold text-foreground">{rate.toFixed(1)}%</span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
                                    <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${Math.min(rate, 100)}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Equity Curve ── */}
                {filtered.filter((s) => s.result === "WIN" || s.result === "LOSS" || s.result === "BREAKEVEN").length >= 2 && (
                    <div className="mt-6 rounded-lg border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
                        <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <BarChart3 size={14} className="text-warning" />
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Equity Curve — Cumulative R
                                </p>
                            </div>
                            {stats && (
                                <p className={`text-xs font-bold ${stats.totalR >= 0 ? "text-positive" : "text-negative"}`}>
                                    {stats.totalR >= 0 ? "+" : ""}{stats.totalR.toFixed(2)}R total
                                </p>
                            )}
                        </div>
                        <div className="h-36 w-full overflow-hidden rounded-xl">
                            <EquityCurveChart signals={filtered} />
                        </div>
                    </div>
                )}

                {/* ── Signal Table ── */}
                <div className="mt-6 overflow-hidden rounded-lg border border-border/30 bg-card/60 backdrop-blur-xl">
                    {/* table header */}
                    <div className="flex items-center justify-between border-b border-border/20 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <Radio size={13} className="text-warning" />
                            <span className="text-xs font-semibold text-foreground">Signal History</span>
                            <span className="rounded-full bg-muted/30 px-2 py-0.5 text-micro text-muted-foreground">
                                {filtered.length} signals
                            </span>
                        </div>
                        {signalsLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                    </div>

                    {signalsLoading && signals.length === 0 ? (
                        <div className="p-16 text-center">
                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-warning/50 mb-3" />
                            <p className="text-sm text-muted-foreground">Loading signal history…</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="p-16 text-center">
                            <Target className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
                            <p className="text-sm font-medium text-muted-foreground">No signals found</p>
                            <p className="mt-1 text-xs text-muted-foreground/60">Try adjusting your filters or period</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-border/20 text-muted-foreground">
                                        <th className="px-4 py-3 text-left font-medium">Symbol</th>
                                        <th className="px-4 py-3 text-left font-medium">Tier</th>
                                        <th className="px-4 py-3 text-left font-medium">TF</th>
                                        <th className="px-4 py-3 text-left font-medium">Direction</th>
                                        <th className="px-4 py-3 text-right font-medium">Entry</th>
                                        <th className="px-4 py-3 text-right font-medium">
                                            <span className="inline-flex items-center gap-1 text-negative/80">
                                                <Shield size={10} />SL
                                            </span>
                                        </th>
                                        <th className="px-4 py-3 text-right font-medium">
                                            <span className="inline-flex items-center gap-1 text-positive/80">
                                                <Target size={10} />TP1
                                            </span>
                                        </th>
                                        <th className="px-4 py-3 text-right font-medium">Confidence</th>
                                        <th className="px-4 py-3 text-center font-medium">Result</th>
                                        <th className="px-4 py-3 text-right font-medium">R</th>
                                        <th className="px-4 py-3 text-left font-medium">Status</th>
                                        <th className="px-4 py-3 text-right font-medium">Age</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                    {filtered.map((signal) => {
                                        const rVal = Number(signal.resultR || 0);
                                        const isWin  = signal.result === "WIN";
                                        const isLoss = signal.result === "LOSS";
                                        return (
                                            <tr
                                                key={signal.id}
                                                className="group transition-colors hover:bg-white/[0.02]"
                                            >
                                                {/* Symbol */}
                                                <td className="px-4 py-3 font-bold text-foreground">
                                                    {signal.symbol}
                                                </td>

                                                {/* Tier */}
                                                <td className="px-4 py-3">
                                                    <span className={`rounded-md px-1.5 py-0.5 text-micro font-semibold border ${
                                                        signal.tier === "PRO"
                                                            ? "bg-warning/10 text-warning border-warning/20"
                                                            : "bg-positive/10 text-positive border-positive/20"
                                                    }`}>
                                                        {signal.tier || "FREE"}
                                                    </span>
                                                </td>

                                                {/* Timeframe */}
                                                <td className="px-4 py-3 font-mono text-muted-foreground">
                                                    {signal.timeframe}
                                                </td>

                                                {/* Direction */}
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex items-center gap-1 font-semibold ${signal.direction === "BUY" ? "text-positive" : "text-negative"}`}>
                                                        {signal.direction === "BUY"
                                                            ? <TrendingUp className="h-3 w-3" />
                                                            : <TrendingDown className="h-3 w-3" />}
                                                        {signal.direction}
                                                    </span>
                                                </td>

                                                {/* Entry */}
                                                <td className="px-4 py-3 text-right font-mono text-foreground">
                                                    {formatPrice(signal.entry)}
                                                </td>

                                                {/* SL pill */}
                                                <td className="px-4 py-3 text-right">
                                                    <span className="inline-flex items-center gap-0.5 rounded-full border border-negative/20 bg-negative/10 px-2 py-0.5 font-mono text-micro font-semibold text-negative">
                                                        <Shield size={8} className="opacity-60" />
                                                        {formatPrice(signal.stopLoss)}
                                                    </span>
                                                </td>

                                                {/* TP1 pill */}
                                                <td className="px-4 py-3 text-right">
                                                    {signal.tp1 ? (
                                                        <span className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 font-mono text-micro font-semibold ${
                                                            signal.tp1Hit
                                                                ? "border-positive/40 bg-positive/15 text-positive"
                                                                : "border-positive/20 bg-positive/10 text-positive"
                                                        }`}>
                                                            <Target size={8} className="opacity-60" />
                                                            {formatPrice(signal.tp1)}
                                                            {signal.tp1Hit && <Award size={8} className="ml-0.5 text-positive" />}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground">—</span>
                                                    )}
                                                </td>

                                                {/* Confidence */}
                                                <td className="px-4 py-3 text-right">
                                                    <span className={`font-bold ${
                                                        signal.confidence >= 85 ? "text-positive"
                                                        : signal.confidence >= 70 ? "text-info"
                                                        : signal.confidence >= 55 ? "text-warning"
                                                        : "text-muted-foreground"
                                                    }`}>
                                                        {signal.confidence}%
                                                    </span>
                                                </td>

                                                {/* Result badge */}
                                                <td className="px-4 py-3 text-center">
                                                    {resultBadge(signal.result || "PENDING", rVal)}
                                                </td>

                                                {/* R value */}
                                                <td className={`px-4 py-3 text-right font-mono font-bold ${
                                                    isWin ? "text-positive" : isLoss ? "text-negative" : "text-muted-foreground"
                                                }`}>
                                                    {signal.result === "PENDING"
                                                        ? <span className="text-info/60">live</span>
                                                        : `${rVal > 0 ? "+" : ""}${rVal.toFixed(2)}R`}
                                                </td>

                                                {/* Status */}
                                                <td className="px-4 py-3">
                                                    <span className={`text-micro font-medium ${
                                                        signal.status === "ACTIVE" || signal.status === "ENTRY_TRIGGERED"
                                                            ? "text-info"
                                                            : signal.status === "COMPLETED" || signal.status === "CLOSED"
                                                            ? "text-muted-foreground/60"
                                                            : signal.status === "STOPPED_OUT" || signal.status === "STOPPED"
                                                            ? "text-negative/70"
                                                            : "text-muted-foreground"
                                                    }`}>
                                                        {signal.status}
                                                    </span>
                                                </td>

                                                {/* Age */}
                                                <td className="px-4 py-3 text-right text-micro text-muted-foreground/60">
                                                    {signal.createdAt ? relativeTime(signal.createdAt) : "—"}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* ── By-symbol breakdown (computed client-side from live signal list) ── */}
                <BySymbolBreakdown signals={filtered} />

                {/* ── Disclaimer ── */}
                <div className="mt-8 flex items-start gap-2 rounded-xl border border-warning/10 bg-warning/[0.03] p-3">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning/50" />
                    <p className="text-micro leading-relaxed text-warning/50">
                        AI trading signals are analytical tools and are not guaranteed to be profitable. Past performance does not guarantee future results. Trading involves substantial risk of loss.
                    </p>
                </div>

            </div>
        </div>
    );
}