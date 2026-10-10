"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
    Loader2, Shield, ArrowLeft, Plus, X, ChevronDown, ChevronUp,
    TrendingUp, TrendingDown, Target, Lock, AlertTriangle, CheckCircle,
    Zap, Activity, Bell, RefreshCw, Clock, Trash2, History,
    Ban, CircleDollarSign, Gauge, ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

// ============================================
// TYPES (mirroring lib/trade-management/types)
// ============================================

type TargetConfig = {
    price: number;
    closePercent: number;
    hit: boolean;
    hitAt?: number;
    hitPrice?: number;
    eventIds?: string[];
    lastApproachAt?: number;
};

type TradeConfig = {
    tp1: TargetConfig;
    tp2: TargetConfig;
    tp3: TargetConfig;
    runnerPercent: number;
    breakEvenEnabled: boolean;
    breakEvenTrigger: string;
    breakEvenOffset: number;
    profitLockEnabled: boolean;
    profitLockTrigger: string;
    profitLockAmount: number;
    trailingEnabled: boolean;
    trailingType: string;
    trailingDistance: number;
    trailingAtrMultiplier: number;
    autoManagement: boolean;
    [key: string]: unknown;
};

type TradeState = {
    tradeId: string;
    accountId: string;
    ticket: string;
    symbol: string;
    direction: "BUY" | "SELL";
    entry: number;
    currentSl: number;
    currentTp: number;
    volume: number;
    currentPrice: number;
    state: string;
    config: TradeConfig;
    riskAmount: number;
    riskPoints: number;
    currentPnl: number;
    currentR: number;
    lockedProfit: number;
    remainingVolume: number;
    closeHistory: { target: string; volume: number; price: number; timestamp: number }[];
    openedAt: number;
    lastUpdated: number;
    manualOverride?: boolean;
};

type TradeEvent = {
    eventId: string;
    type: string;
    title: string;
    message: string;
    severity: "info" | "success" | "warning" | "error";
    timestamp: number;
    price: number;
};

type Position = {
    ticket: string;
    symbol: string;
    type: string;
    volume: number;
    openPrice: number;
    currentPrice: number;
    sl: number;
    tp: number;
    profit: number;
};

type Step = 1 | 2 | 3;

// ============================================
// CONSTANTS
// ============================================

const STATE_META: Record<string, { label: string; tone: string; icon: React.ElementType }> = {
    OPEN: { label: "Open", tone: "text-blue-400 bg-blue-500/10 border-blue-500/20", icon: Activity },
    TP1_APPROACHING: { label: "Approaching TP1", tone: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: Target },
    TP1_HIT: { label: "TP1 Hit", tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle },
    BE_PENDING: { label: "BE Pending", tone: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: Lock },
    BE_APPLIED: { label: "Break Even", tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: Lock },
    TP2_APPROACHING: { label: "Approaching TP2", tone: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: Target },
    TP2_HIT: { label: "TP2 Hit", tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle },
    PROFIT_LOCKED: { label: "Profit Locked", tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: Lock },
    TP3_APPROACHING: { label: "Approaching TP3", tone: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: Target },
    TP3_HIT: { label: "TP3 Hit", tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle },
    RUNNER_ACTIVE: { label: "Runner Active", tone: "text-violet-400 bg-violet-500/10 border-violet-500/20", icon: Zap },
    TRAILING: { label: "Trailing", tone: "text-violet-400 bg-violet-500/10 border-violet-500/20", icon: Gauge },
    CLOSED: { label: "Closed", tone: "text-muted-foreground bg-muted/30 border-border/30", icon: CheckCircle },
    STOPPED: { label: "Stopped", tone: "text-rose-400 bg-rose-500/10 border-rose-500/20", icon: AlertTriangle },
    CANCELLED: { label: "Cancelled", tone: "text-muted-foreground bg-muted/30 border-border/30", icon: Ban },
};

const SEVERITY_STYLES: Record<string, string> = {
    success: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    info: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    warning: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    error: "text-rose-400 bg-rose-500/10 border-rose-500/20",
};

function digitsFor(symbol: string): number {
    const s = symbol.toUpperCase();
    if (s.includes("JPY")) return 3;
    if (s.includes("XAU") || s.includes("BTC") || s.includes("ETH") || s.includes("US30") || s.includes("NAS")) return 2;
    return 5;
}

function fmtP(p: number, symbol: string): string {
    if (!Number.isFinite(p)) return "—";
    return p.toFixed(digitsFor(symbol));
}

function fmtMoney(n: number): string {
    const sign = n >= 0 ? "+" : "−";
    return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtTimeAgo(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
}

// Progress derived from which targets are actually hit (not state heuristics).
function targetProgress(t: TradeState): number {
    const hits = [t.config.tp1.hit, t.config.tp2.hit, t.config.tp3.hit].filter(Boolean).length;
    if (hits >= 3) return 100;
    // Fractional progress toward the next target, based on price distance.
    const next = !t.config.tp1.hit ? t.config.tp1 : !t.config.tp2.hit ? t.config.tp2 : t.config.tp3;
    const isBuy = t.direction === "BUY";
    const from = t.entry;
    const to = next.price;
    const span = Math.abs(to - from);
    const done = isBuy ? t.currentPrice - from : from - t.currentPrice;
    const frac = span > 0 ? Math.min(1, Math.max(0, done / span)) : 0;
    return Math.min(99, Math.round(((hits / 3) + frac / 3) * 100));
}

const PRESETS = [
    { name: "Scalp", tp1: 50, tp2: 30, tp3: 10, runner: 10, desc: "Fast exits, small runner" },
    { name: "Balanced", tp1: 30, tp2: 30, tp3: 20, runner: 20, desc: "Even scale-out" },
    { name: "Trend", tp1: 25, tp2: 25, tp3: 20, runner: 30, desc: "Hold a bigger runner" },
    { name: "Quick Exit", tp1: 60, tp2: 40, tp3: 0, runner: 0, desc: "Out mostly by TP2" },
] as const;

// ============================================
// PAGE
// ============================================

export default function TradeManagementPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [trades, setTrades] = useState<TradeState[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [lastSync, setLastSync] = useState<number>(0);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [eventsFor, setEventsFor] = useState<TradeState | null>(null);
    const [events, setEvents] = useState<TradeEvent[]>([]);
    const [eventsLoading, setEventsLoading] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
    const [positions, setPositions] = useState<Record<string, Position[]>>({});
    const [busyTrade, setBusyTrade] = useState<string | null>(null);
    const [banner, setBanner] = useState<{ kind: "error" | "success"; text: string } | null>(null);
    const [confirmClose, setConfirmClose] = useState<TradeState | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Create wizard state
    const [step, setStep] = useState<Step>(1);
    const [selAccount, setSelAccount] = useState("");
    const [selTicket, setSelTicket] = useState("");
    const [tp1Pct, setTp1Pct] = useState("30");
    const [tp2Pct, setTp2Pct] = useState("30");
    const [tp3Pct, setTp3Pct] = useState("20");
    const [runnerPct, setRunnerPct] = useState("20");
    const [beEnabled, setBeEnabled] = useState(true);
    const [plEnabled, setPlEnabled] = useState(true);
    const [trailingEnabled, setTrailingEnabled] = useState(false);
    const [trailingType, setTrailingType] = useState<"fixed" | "atr" | "percent">("fixed");
    const [trailingDistance, setTrailingDistance] = useState("50");
    const [autoMgmt, setAutoMgmt] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const authHeaders = useCallback(async (): Promise<Record<string, string> | null> => {
        if (!user) return null;
        const token = await user.getIdToken();
        return { Authorization: `Bearer ${token}` };
    }, [user]);

    const fetchData = useCallback(async (silent = false) => {
        const headers = await authHeaders();
        if (!headers) return;
        if (!silent) setLoading(true);
        setRefreshing(true);
        try {
            const [tradesRes, accountsRes] = await Promise.all([
                fetch("/api/trade-management", { headers }),
                fetch("/api/analytics/accounts", { headers }),
            ]);
            const tradesData = await tradesRes.json().catch(() => null);
            if (tradesData?.success) setTrades(tradesData.trades || []);

            const accountsData = await accountsRes.json().catch(() => null);
            if (accountsData?.accounts) {
                setAccounts(accountsData.accounts.map((a: { id?: string; accountId?: string; accountName?: string; mt5Account?: string }) => ({
                    id: a.id || a.accountId,
                    name: a.accountName || a.mt5Account || a.accountId || a.id || "Account",
                })));
            }
            setLastSync(Date.now());
        } catch {} finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [authHeaders]);

    useEffect(() => {
        if (!user) return;
        // Deferred so the initial fetch doesn't setState synchronously inside
        // the effect body (avoids cascading-render lint error).
        const initial = setTimeout(() => { void fetchData(); }, 0);
        // Lightweight auto-refresh keeps PnL/current price fresh.
        pollRef.current = setInterval(() => { void fetchData(true); }, 20_000);
        return () => {
            clearTimeout(initial);
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [user, fetchData]);

    const fetchPositions = useCallback(async (accountId: string) => {
        const headers = await authHeaders();
        if (!headers) return;
        try {
            const res = await fetch(`/api/trading/positions?accountId=${accountId}`, { headers });
            const data = await res.json();
            setPositions((prev) => ({ ...prev, [accountId]: Array.isArray(data.positions) ? data.positions : [] }));
        } catch {
            setPositions((prev) => ({ ...prev, [accountId]: [] }));
        }
    }, [authHeaders]);

    const openEvents = useCallback(async (trade: TradeState) => {
        setEventsFor(trade);
        setEvents([]);
        setEventsLoading(true);
        const headers = await authHeaders();
        if (!headers) return;
        try {
            const res = await fetch(`/api/trade-management?accountId=${trade.accountId}&ticket=${trade.ticket}`, { headers });
            const data = await res.json();
            setEvents(Array.isArray(data.events) ? data.events : []);
        } catch {
            setEvents([]);
        } finally {
            setEventsLoading(false);
        }
    }, [authHeaders]);

    const showBanner = (kind: "error" | "success", text: string) => {
        setBanner({ kind, text });
        setTimeout(() => setBanner(null), 5000);
    };

    const tradeAction = async (trade: TradeState, action: string, extra: Record<string, unknown> = {}) => {
        setBusyTrade(trade.tradeId);
        try {
            const headers = await authHeaders();
            if (!headers) return false;
            const res = await fetch("/api/trade-management", {
                method: "PUT",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ accountId: trade.accountId, ticket: trade.ticket, action, reason: "Manual action from UI", ...extra }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                showBanner("error", data?.error || "Action failed");
                return false;
            }
            showBanner("success", "Action queued");
            await fetchData(true);
            return true;
        } catch {
            showBanner("error", "Network error");
            return false;
        } finally {
            setBusyTrade(null);
        }
    };

    const handleCloseAtMarket = async () => {
        if (!confirmClose) return;
        const ok = await tradeAction(confirmClose, "closeAtMarket");
        if (ok) setConfirmClose(null);
    };

    const applyPreset = (p: (typeof PRESETS)[number]) => {
        setTp1Pct(String(p.tp1));
        setTp2Pct(String(p.tp2));
        setTp3Pct(String(p.tp3));
        setRunnerPct(String(p.runner));
    };

    const createTradeManagement = async () => {
        const posList = positions[selAccount] || [];
        const pos = posList.find((p) => String(p.ticket) === selTicket);
        if (!user || !pos) return;

        const totalPct = Number(tp1Pct) + Number(tp2Pct) + Number(tp3Pct) + Number(runnerPct);
        if (totalPct > 100) { showBanner("error", `Total ${totalPct}% exceeds 100%`); return; }

        const isBuy = pos.type.toUpperCase().includes("BUY");
        const entry = pos.openPrice;
        const sl = pos.sl || (isBuy ? entry * 0.997 : entry * 1.003);
        const risk = Math.abs(entry - sl);
        const tp = pos.tp || (isBuy ? entry + risk * 2 : entry - risk * 2);
        const tp1 = tp;
        const span = Math.abs(tp - entry);
        const tp2 = isBuy ? tp1 + span : tp1 - span;
        const tp3 = isBuy ? tp1 + span * 2 : tp1 - span * 2;

        const headers = await authHeaders();
        if (!headers) return;
        try {
            const res = await fetch("/api/trade-management", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    accountId: selAccount,
                    ticket: selTicket,
                    symbol: pos.symbol,
                    direction: isBuy ? "BUY" : "SELL",
                    entry,
                    sl,
                    volume: pos.volume,
                    config: {
                        tp1: { price: tp1, closePercent: Number(tp1Pct), hit: false, eventIds: [] },
                        tp2: { price: tp2, closePercent: Number(tp2Pct), hit: false, eventIds: [] },
                        tp3: { price: tp3, closePercent: Number(tp3Pct), hit: false, eventIds: [] },
                        runnerPercent: Number(runnerPct),
                        breakEvenEnabled: beEnabled,
                        breakEvenTrigger: "TP1",
                        breakEvenOffset: 0,
                        profitLockEnabled: plEnabled,
                        profitLockTrigger: "TP2",
                        profitLockAmount: 0,
                        trailingEnabled,
                        trailingType,
                        trailingDistance: Number(trailingDistance) || 50,
                        trailingAtrMultiplier: 1.5,
                        autoManagement: autoMgmt,
                    },
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                showBanner("error", data?.error || "Failed to add trade");
                return;
            }
            setShowCreate(false);
            setStep(1);
            setSelAccount("");
            setSelTicket("");
            showBanner("success", "Trade added to management");
            await fetchData(true);
        } catch {
            showBanner("error", "Network error");
        }
    };

    const deleteTrade = async (trade: TradeState) => {
        const headers = await authHeaders();
        if (!headers) return;
        setBusyTrade(trade.tradeId);
        try {
            const res = await fetch(`/api/trade-management?accountId=${trade.accountId}&ticket=${trade.ticket}`, {
                method: "DELETE",
                headers,
            });
            if (res.ok) {
                showBanner("success", "Trade removed from management");
                await fetchData(true);
            } else {
                showBanner("error", "Failed to remove trade");
            }
        } finally {
            setBusyTrade(null);
        }
    };

    // ---- Derived ----
    const activeTrades = useMemo(() => trades.filter((t) => !["CLOSED", "STOPPED", "CANCELLED"].includes(t.state)), [trades]);
    const closedTrades = useMemo(() => trades.filter((t) => ["CLOSED", "STOPPED", "CANCELLED"].includes(t.state)), [trades]);
    const totalPnl = useMemo(() => activeTrades.reduce((s, t) => s + (t.currentPnl || 0), 0), [activeTrades]);
    const avgR = useMemo(() => activeTrades.length ? activeTrades.reduce((s, t) => s + (t.currentR || 0), 0) / activeTrades.length : 0, [activeTrades]);
    const totalRisk = useMemo(() => activeTrades.reduce((s, t) => s + (t.riskAmount || 0), 0), [activeTrades]);
    const totalLocked = useMemo(() => activeTrades.reduce((s, t) => s + (t.lockedProfit || 0), 0), [activeTrades]);
    const selectedPos = positions[selAccount]?.find((p) => String(p.ticket) === selTicket);
    const pctSum = Number(tp1Pct) + Number(tp2Pct) + Number(tp3Pct) + Number(runnerPct);

    // ---- Guards ----
    if (authLoading) {
        return (
            <div className="flex min-h-screen bg-background items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            </div>
        );
    }
    if (!user) {
        return (
            <div className="flex min-h-screen bg-background items-center justify-center gap-4 flex-col">
                <Shield size={40} className="text-muted-foreground" />
                <h1 className="text-xl font-semibold text-foreground">Sign in required</h1>
                <p className="text-sm text-muted-foreground">Sign in to manage your open trades.</p>
                <Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-violet-500/30">
            {/* Ambient background */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-violet-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>

            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"><ArrowLeft size={12} /> Back to Account</Link>

                {/* Header */}
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Smart Trade Management</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Scale out at multiple targets with auto break-even, profit lock, and trailing</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="hidden sm:inline-flex items-center gap-1.5 text-micro text-muted-foreground">
                            <span className={cn("h-1.5 w-1.5 rounded-full", refreshing ? "bg-amber-400 animate-pulse" : "bg-emerald-400")} />
                            {refreshing ? "Syncing…" : lastSync ? `Synced ${fmtTimeAgo(lastSync)}` : ""}
                        </span>
                        <button type="button" onClick={() => void fetchData()} className="flex items-center gap-1.5 rounded-xl border border-border/40 bg-muted/30 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition">
                            <RefreshCw size={13} className={cn(refreshing && "animate-spin")} /> Refresh
                        </button>
                        <button type="button" onClick={() => { setShowCreate(true); setStep(1); }} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-violet-500 transition shadow-lg shadow-violet-950/40">
                            <Plus size={13} /> Manage Trade
                        </button>
                    </div>
                </div>

                {/* Banner */}
                {banner && (
                    <div className={cn("mb-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium",
                        banner.kind === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400")}>
                        {banner.kind === "error" ? <AlertTriangle size={13} /> : <CheckCircle size={13} />}
                        {banner.text}
                        <button type="button" onClick={() => setBanner(null)} className="ml-auto opacity-60 hover:opacity-100"><X size={12} /></button>
                    </div>
                )}

                {/* Stats */}
                <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-guide="stats">
                    <StatCard label="Active Trades" value={String(activeTrades.length)} icon={Activity} accent="text-blue-400" />
                    <StatCard label="Floating P/L" value={fmtMoney(totalPnl)} icon={CircleDollarSign} accent={totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
                    <StatCard label="Avg R" value={`${avgR >= 0 ? "+" : ""}${avgR.toFixed(1)}R`} icon={Gauge} accent="text-violet-400" />
                    <StatCard label="Open Risk" value={`$${totalRisk.toFixed(0)}`} icon={AlertTriangle} accent="text-amber-400" footnote={totalLocked > 0 ? `$${totalLocked.toFixed(0)} locked` : undefined} />
                    <StatCard label="Managed Total" value={String(trades.length)} icon={History} accent="text-muted-foreground" className="hidden sm:block" />
                </div>

                {/* Active trades */}
                {loading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : activeTrades.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/40 p-16 text-center">
                        <Target size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm font-medium text-foreground">No managed trades</p>
                        <p className="mt-1 text-xs text-muted-foreground">Add an open position to start scaling out with automatic targets.</p>
                        <button type="button" onClick={() => { setShowCreate(true); setStep(1); }} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-foreground hover:bg-violet-500 transition">
                            <Plus size={13} /> Manage your first trade
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {activeTrades.map((trade) => (
                            <TradeCard
                                key={trade.tradeId}
                                trade={trade}
                                expanded={expanded === trade.tradeId}
                                onToggle={() => setExpanded(expanded === trade.tradeId ? null : trade.tradeId)}
                                onEvents={() => void openEvents(trade)}
                                onClose={() => setConfirmClose(trade)}
                                onAction={tradeAction}
                                onDelete={() => void deleteTrade(trade)}
                                busy={busyTrade === trade.tradeId}
                            />
                        ))}
                    </div>
                )}

                {/* Closed trades */}
                {closedTrades.length > 0 && (
                    <div className="mt-8">
                        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Closed & Stopped</h2>
                        <div className="space-y-2">
                            {closedTrades.slice(0, 12).map((trade) => {
                                const meta = STATE_META[trade.state] || STATE_META.CLOSED;
                                return (
                                    <div key={trade.tradeId} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/20 bg-muted/10 px-4 py-3 opacity-70">
                                        <span className="font-mono text-sm font-medium text-foreground">{trade.symbol}</span>
                                        <span className={cn("rounded-md border px-2 py-0.5 text-micro font-medium", meta.tone)}>{meta.label}</span>
                                        <span className="text-micro text-muted-foreground">#{trade.ticket}</span>
                                        <span className="ml-auto flex items-center gap-4">
                                            <span className={cn("font-mono text-xs font-bold", trade.currentPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtMoney(trade.currentPnl)}</span>
                                            <span className="text-micro text-muted-foreground">{new Date(trade.openedAt).toLocaleDateString()}</span>
                                            <button type="button" onClick={() => void deleteTrade(trade)} className="rounded p-1 text-muted-foreground opacity-60 hover:text-rose-400 hover:opacity-100 transition" title="Remove from list">
                                                <Trash2 size={12} />
                                            </button>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* ======== Create Wizard ======== */}
            {showCreate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
                    <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border/40 bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        {/* Wizard header */}
                        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/30 bg-background/95 px-6 py-4 backdrop-blur">
                            <div>
                                <h2 className="text-base font-semibold text-foreground">Manage a Trade</h2>
                                <div className="mt-2 flex items-center gap-1.5">
                                    {([1, 2, 3] as Step[]).map((s) => (
                                        <span key={s} className={cn("h-1.5 rounded-full transition-all", s === step ? "w-6 bg-violet-500" : s < step ? "w-3 bg-violet-500/50" : "w-3 bg-muted")} />
                                    ))}
                                    <span className="ml-2 text-micro font-medium text-muted-foreground">
                                        {step === 1 ? "Position" : step === 2 ? "Targets" : "Automation"}
                                    </span>
                                </div>
                            </div>
                            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition"><X size={16} /></button>
                        </div>

                        <div className="px-6 py-5">
                            {/* STEP 1: position */}
                            {step === 1 && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Trading account</label>
                                        <select
                                            value={selAccount}
                                            onChange={(e) => { setSelAccount(e.target.value); setSelTicket(""); void fetchPositions(e.target.value); }}
                                            className="w-full rounded-xl border border-border/40 bg-muted/30 px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none"
                                        >
                                            <option value="">Select account…</option>
                                            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                        </select>
                                    </div>

                                    {selAccount && (
                                        <div>
                                            <div className="mb-1.5 flex items-center justify-between">
                                                <label className="text-xs font-medium text-muted-foreground">Open position</label>
                                                <button type="button" onClick={() => void fetchPositions(selAccount)} className="text-micro text-violet-400 hover:text-violet-300">Reload</button>
                                            </div>
                                            {!positions[selAccount] ? (
                                                <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted/20 px-3 py-4 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Loading positions…</div>
                                            ) : positions[selAccount].length === 0 ? (
                                                <div className="rounded-xl border border-dashed border-border/30 px-3 py-4 text-xs text-muted-foreground text-center">No open positions on this account.</div>
                                            ) : (
                                                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                                                    {positions[selAccount]
                                                        .filter((p) => !trades.find((t) => t.ticket === String(p.ticket)))
                                                        .map((p) => (
                                                            <button
                                                                key={p.ticket}
                                                                type="button"
                                                                onClick={() => setSelTicket(String(p.ticket))}
                                                                className={cn(
                                                                    "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                                                                    selTicket === String(p.ticket)
                                                                        ? "border-violet-500/50 bg-violet-500/10"
                                                                        : "border-border/30 bg-muted/20 hover:border-border/60 hover:bg-muted/40"
                                                                )}
                                                            >
                                                                <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", p.type.toUpperCase().includes("BUY") ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>
                                                                    {p.type.toUpperCase().includes("BUY") ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                                                                </span>
                                                                <span className="min-w-0 flex-1">
                                                                    <span className="block font-mono text-xs font-semibold text-foreground">{p.symbol} · {p.volume} lots</span>
                                                                    <span className="block font-mono text-micro text-muted-foreground">@ {fmtP(p.openPrice, p.symbol)} · #{p.ticket}</span>
                                                                </span>
                                                                <span className={cn("font-mono text-xs font-semibold", p.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtMoney(p.profit)}</span>
                                                            </button>
                                                        ))}
                                                    {positions[selAccount].filter((p) => !trades.find((t) => t.ticket === String(p.ticket))).length === 0 && (
                                                        <div className="rounded-xl border border-dashed border-border/30 px-3 py-4 text-center text-xs text-muted-foreground">All open positions are already managed.</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <StepFooter nextDisabled={!selTicket} onNext={() => setStep(2)} nextLabel="Configure targets" />
                                </div>
                            )}

                            {/* STEP 2: targets */}
                            {step === 2 && selectedPos && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-3 rounded-xl border border-border/30 bg-muted/20 p-3 text-xs">
                                        <Detail label="Symbol" value={selectedPos.symbol} mono />
                                        <Detail label="Direction" value={selectedPos.type.toUpperCase().includes("BUY") ? "BUY" : "SELL"} mono accent={selectedPos.type.toUpperCase().includes("BUY") ? "text-emerald-400" : "text-rose-400"} />
                                        <Detail label="Entry" value={fmtP(selectedPos.openPrice, selectedPos.symbol)} mono />
                                        <Detail label="Volume" value={`${selectedPos.volume} lots`} mono />
                                    </div>

                                    <div>
                                        <div className="mb-2 flex items-center justify-between">
                                            <label className="text-xs font-medium text-muted-foreground">Scale-out plan</label>
                                            <span className={cn("text-micro font-semibold", pctSum > 100 ? "text-rose-400" : "text-muted-foreground")}>{pctSum}% of 100%</span>
                                        </div>
                                        <div className="mb-3 grid grid-cols-2 gap-2">
                                            {PRESETS.map((p) => (
                                                <button key={p.name} type="button" onClick={() => applyPreset(p)} className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-left transition hover:border-violet-500/40 hover:bg-violet-500/5">
                                                    <span className="block text-micro font-semibold text-foreground">{p.name}</span>
                                                    <span className="block text-micro text-muted-foreground">{p.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                        <div className="grid grid-cols-4 gap-2">
                                            <PctInput label="TP1 %" value={tp1Pct} onChange={setTp1Pct} />
                                            <PctInput label="TP2 %" value={tp2Pct} onChange={setTp2Pct} />
                                            <PctInput label="TP3 %" value={tp3Pct} onChange={setTp3Pct} />
                                            <PctInput label="Runner %" value={runnerPct} onChange={setRunnerPct} />
                                        </div>
                                        {/* Allocation bar */}
                                        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
                                            {Number(tp1Pct) > 0 && <div className="bg-emerald-500/70" style={{ width: `${Math.min(100, Number(tp1Pct))}%` }} />}
                                            {Number(tp2Pct) > 0 && <div className="bg-teal-500/70" style={{ width: `${Math.min(100, Number(tp2Pct))}%` }} />}
                                            {Number(tp3Pct) > 0 && <div className="bg-blue-500/70" style={{ width: `${Math.min(100, Number(tp3Pct))}%` }} />}
                                            {Number(runnerPct) > 0 && <div className="bg-violet-500/70" style={{ width: `${Math.min(100, Number(runnerPct))}%` }} />}
                                        </div>
                                        <p className="mt-1.5 text-micro text-muted-foreground">
                                            TP prices are projected from the position&apos;s existing take-profit (risk × 2). Edit them later from the trade card.
                                        </p>
                                    </div>
                                    <StepFooter
                                        backLabel="Back"
                                        onBack={() => setStep(1)}
                                        nextDisabled={pctSum > 100 || pctSum <= 0}
                                        onNext={() => setStep(3)}
                                        nextLabel="Automation"
                                        hint={pctSum > 100 ? "Total exceeds 100%" : undefined}
                                    />
                                </div>
                            )}

                            {/* STEP 3: automation */}
                            {step === 3 && (
                                <div className="space-y-4">
                                    <ToggleRow
                                        icon={<Zap size={14} className="text-violet-400" />}
                                        title="Auto Management"
                                        desc="Execute partial closes, break-even and profit lock automatically as price reaches targets."
                                        checked={autoMgmt}
                                        onChange={setAutoMgmt}
                                    />
                                    <div className={cn("space-y-2.5 rounded-xl border border-border/30 bg-muted/10 p-3", !autoMgmt && "opacity-50")}>
                                        <ToggleRow
                                            icon={<Lock size={14} className="text-emerald-400" />}
                                            title="Break Even after TP1"
                                            desc="SL moves to entry once TP1 is hit — trade becomes risk-free."
                                            checked={beEnabled}
                                            onChange={setBeEnabled}
                                        />
                                        <ToggleRow
                                            icon={<ShieldCheck size={14} className="text-emerald-400" />}
                                            title="Lock Profit at TP2"
                                            desc="SL trails to TP1 price after TP2 is hit."
                                            checked={plEnabled}
                                            onChange={setPlEnabled}
                                        />
                                        <ToggleRow
                                            icon={<Gauge size={14} className="text-violet-400" />}
                                            title="Trailing stop on runner"
                                            desc="Trail the remaining position after TP3."
                                            checked={trailingEnabled}
                                            onChange={setTrailingEnabled}
                                        />
                                        {trailingEnabled && (
                                            <div className="flex items-end gap-2 pl-6">
                                                <div className="flex-1">
                                                    <label className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">Trailing type</label>
                                                    <select value={trailingType} onChange={(e) => setTrailingType(e.target.value as typeof trailingType)} className="w-full rounded-lg border border-border/40 bg-muted/30 px-2.5 py-2 text-xs text-foreground focus:border-violet-500 focus:outline-none">
                                                        <option value="fixed">Fixed distance (points)</option>
                                                        <option value="atr">ATR-based</option>
                                                        <option value="percent">Percent of price</option>
                                                    </select>
                                                </div>
                                                {trailingType === "fixed" && (
                                                    <div className="w-24">
                                                        <label className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">Points</label>
                                                        <input type="number" value={trailingDistance} onChange={(e) => setTrailingDistance(e.target.value)} className="w-full rounded-lg border border-border/40 bg-muted/30 px-2.5 py-2 text-xs text-foreground focus:border-violet-500 focus:outline-none" />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {!autoMgmt && (
                                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-micro leading-relaxed text-amber-400">
                                            <AlertTriangle size={12} className="mr-1.5 inline" />
                                            Manual mode: you&apos;ll get recommendations only — nothing is executed automatically.
                                        </div>
                                    )}
                                    <StepFooter backLabel="Back" onBack={() => setStep(2)} nextDisabled={!selectedPos || pctSum > 100} onNext={() => void createTradeManagement()} nextLabel="Add trade" busy={busyTrade === "creating"} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ======== Close confirmation ======== */}
            {confirmClose && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setConfirmClose(null)}>
                    <div className="w-full max-w-sm rounded-lg border border-border/40 bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400"><AlertTriangle size={18} /></div>
                        <h3 className="text-base font-semibold text-foreground">Close {confirmClose.symbol} at market?</h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                            This queues a market close for the remaining {confirmClose.remainingVolume.toFixed(2)} lots (#{confirmClose.ticket}).
                            Current floating P/L: <span className={cn("font-mono font-semibold", confirmClose.currentPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtMoney(confirmClose.currentPnl)}</span>
                        </p>
                        <div className="mt-5 flex gap-2">
                            <button type="button" onClick={() => setConfirmClose(null)} className="flex-1 rounded-xl border border-border/40 bg-muted/20 px-4 py-2.5 text-xs font-medium text-foreground hover:bg-muted/40 transition">Cancel</button>
                            <button type="button" onClick={() => void handleCloseAtMarket()} disabled={busyTrade === confirmClose.tradeId} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-rose-500 transition disabled:opacity-50">
                                {busyTrade === confirmClose.tradeId && <Loader2 size={12} className="animate-spin" />} Close position
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ======== Events drawer ======== */}
            {eventsFor && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={() => setEventsFor(null)}>
                    <div className="flex h-full w-full max-w-md flex-col border-l border-border/30 bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-border/30 px-5 py-4">
                            <div>
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                    <Bell size={14} className="text-violet-400" /> Trade Activity
                                </h3>
                                <p className="mt-0.5 text-micro text-muted-foreground">{eventsFor.symbol} {eventsFor.direction} · #{eventsFor.ticket}</p>
                            </div>
                            <button type="button" onClick={() => setEventsFor(null)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition"><X size={16} /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5">
                            {eventsLoading ? (
                                <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
                            ) : events.length === 0 ? (
                                <p className="py-8 text-center text-xs text-muted-foreground">No events recorded yet.</p>
                            ) : (
                                <div className="relative space-y-3 pl-4">
                                    <div className="absolute bottom-2 left-[5px] top-2 w-px bg-border/40" />
                                    {events.map((ev) => (
                                        <div key={ev.eventId} className="relative">
                                            <span className={cn("absolute -left-4 top-2 h-2.5 w-2.5 rounded-full border-2 border-background", ev.severity === "success" ? "bg-emerald-400" : ev.severity === "error" ? "bg-rose-400" : ev.severity === "warning" ? "bg-amber-400" : "bg-blue-400")} />
                                            <div className={cn("rounded-xl border px-3.5 py-2.5", SEVERITY_STYLES[ev.severity] || SEVERITY_STYLES.info)}>
                                                <p className="text-micro font-semibold">{ev.title}</p>
                                                <p className="mt-1 whitespace-pre-line text-micro leading-relaxed opacity-80">{ev.message}</p>
                                                <p className="mt-1.5 flex items-center gap-1 text-micro opacity-60"><Clock size={8} /> {new Date(ev.timestamp).toLocaleString()}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function StatCard({ label, value, icon: Icon, accent, footnote, className }: { label: string; value: string; icon: React.ElementType; accent: string; footnote?: string; className?: string }) {
    return (
        <div className={cn("rounded-lg border border-border/30 bg-muted/40 p-4", className)}>
            <div className="flex items-center justify-between">
                <p className="truncate text-micro font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <Icon size={13} className={cn("shrink-0", accent)} />
            </div>
            <p className={cn("mt-1.5 font-mono text-lg font-bold", accent)}>{value}</p>
            {footnote && <p className="text-micro text-emerald-400/80">{footnote}</p>}
        </div>
    );
}

function Detail({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
    return (
        <div>
            <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={cn("mt-0.5 text-xs font-semibold", mono && "font-mono", accent || "text-foreground")}>{value}</p>
        </div>
    );
}

function PctInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">{label}</label>
            <input
                type="number" min={0} max={100} value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-lg border border-border/40 bg-muted/30 px-2 py-2 font-mono text-xs text-foreground focus:border-violet-500 focus:outline-none"
            />
        </div>
    );
}

function ToggleRow({ icon, title, desc, checked, onChange }: { icon: React.ReactNode; title: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={cn(
                "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                checked ? "border-violet-500/40 bg-violet-500/[0.06]" : "border-border/30 bg-muted/10 hover:border-border/60"
            )}
        >
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-foreground">{title}</span>
                <span className="mt-0.5 block text-micro leading-relaxed text-muted-foreground">{desc}</span>
            </span>
            <span className={cn("mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors", checked ? "justify-end bg-violet-500" : "justify-start bg-muted")}>
                <span className="h-4 w-4 rounded-full bg-foreground shadow transition-transform" />
            </span>
        </button>
    );
}

function StepFooter({ backLabel, onBack, nextLabel, onNext, nextDisabled, hint, busy }: {
    backLabel?: string; onBack?: () => void; nextLabel: string; onNext: () => void;
    nextDisabled?: boolean; hint?: string; busy?: boolean;
}) {
    return (
        <div className="pt-2">
            {hint && <p className="mb-2 text-center text-micro font-medium text-rose-400">{hint}</p>}
            <div className="flex gap-2">
                {onBack && (
                    <button type="button" onClick={onBack} className="rounded-xl border border-border/40 bg-muted/20 px-4 py-2.5 text-xs font-medium text-foreground hover:bg-muted/40 transition">
                        {backLabel}
                    </button>
                )}
                <button
                    type="button"
                    onClick={onNext}
                    disabled={nextDisabled || busy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {busy && <Loader2 size={12} className="animate-spin" />}
                    {nextLabel}
                </button>
            </div>
        </div>
    );
}

function TradeCard({
    trade, expanded, onToggle, onEvents, onClose, onAction, onDelete, busy,
}: {
    trade: TradeState;
    expanded: boolean;
    onToggle: () => void;
    onEvents: () => void;
    onClose: () => void;
    onAction: (trade: TradeState, action: string, extra?: Record<string, unknown>) => Promise<boolean>;
    onDelete: () => void;
    busy: boolean;
}) {
    const meta = STATE_META[trade.state] || STATE_META.OPEN;
    const MetaIcon = meta.icon;
    const isBuy = trade.direction === "BUY";
    const DirIcon = isBuy ? TrendingUp : TrendingDown;
    const progress = targetProgress(trade);
    const editable = !["CLOSED", "STOPPED", "CANCELLED"].includes(trade.state);

    // Move SL to break even (manual action) — validated server-side.
    const canMoveBe = editable && trade.currentSl !== trade.entry;

    return (
        <div className={cn("overflow-hidden rounded-lg border border-border/30 bg-muted/40 transition-colors", expanded && "border-violet-500/30")}>
            {/* Header row */}
            <div className="flex flex-wrap items-center gap-4 p-5">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", isBuy ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>
                    <DirIcon size={18} />
                </div>

                <div className="min-w-[180px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-foreground">{trade.symbol}</span>
                        <span className={cn("rounded-md border px-2 py-0.5 text-micro font-medium", meta.tone)}>
                            <MetaIcon size={9} className="mr-1 inline" />{meta.label}
                        </span>
                        <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-micro text-muted-foreground">#{trade.ticket}</span>
                        {trade.config.autoManagement ? (
                            <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-micro font-semibold text-violet-400">AUTO</span>
                        ) : (
                            <span className="rounded-md bg-muted px-2 py-0.5 text-micro text-muted-foreground">MANUAL</span>
                        )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-micro text-muted-foreground">
                        <span>Entry <span className="font-mono">{fmtP(trade.entry, trade.symbol)}</span></span>
                        <span>Now <span className="font-mono text-foreground">{fmtP(trade.currentPrice, trade.symbol)}</span></span>
                        <span>SL <span className="font-mono">{fmtP(trade.currentSl, trade.symbol)}</span></span>
                        <span className={cn("font-mono font-bold", trade.currentPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtMoney(trade.currentPnl)}</span>
                        <span className={cn("font-mono font-semibold", trade.currentR >= 0 ? "text-emerald-400/80" : "text-rose-400/80")}>{trade.currentR >= 0 ? "+" : ""}{trade.currentR.toFixed(1)}R</span>
                    </div>
                </div>

                {/* Target ladder (visual) */}
                <div className="hidden items-center gap-1.5 lg:flex">
                    {(["tp1", "tp2", "tp3"] as const).map((tp) => {
                        const t = trade.config[tp];
                        return (
                            <div
                                key={tp}
                                title={`${tp.toUpperCase()} ${fmtP(t.price, trade.symbol)} · close ${t.closePercent}%`}
                                className={cn(
                                    "flex items-center gap-1 rounded-lg border px-2 py-1 text-micro font-medium transition-colors",
                                    t.hit
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                        : "border-border/30 bg-muted/30 text-muted-foreground"
                                )}
                            >
                                {t.hit ? <CheckCircle size={10} /> : <Target size={10} />}
                                {tp.toUpperCase()} {fmtP(t.price, trade.symbol)}
                                <span className="opacity-60">·{t.closePercent}%</span>
                            </div>
                        );
                    })}
                    <div className="flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-micro font-medium text-violet-400" title="Remaining volume">
                        <Zap size={10} /> {trade.remainingVolume.toFixed(2)}
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <button type="button" onClick={onEvents} className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" title="Activity">
                        <Bell size={15} />
                    </button>
                    <button type="button" onClick={onToggle} className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" title="Details">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>
            </div>

            {/* Progress bar */}
            <div className="px-5 pb-3">
                <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-blue-500 to-emerald-500 transition-all duration-700" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="w-8 text-right font-mono text-micro text-muted-foreground">{progress}%</span>
                </div>
            </div>

            {/* Expanded details */}
            {expanded && (
                <div className="space-y-4 border-t border-border/20 p-5">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <MiniStat label="Risk" value={`$${(trade.riskAmount || 0).toFixed(2)}`} sub={`${(trade.riskPoints || 0).toFixed(1)} pts`} accent="text-rose-400" />
                        <MiniStat label="Locked Profit" value={`$${(trade.lockedProfit || 0).toFixed(2)}`} sub={trade.lockedProfit > 0 ? "secured" : "—"} accent="text-emerald-400" />
                        <MiniStat label="Remaining" value={`${trade.remainingVolume.toFixed(2)} lots`} sub={`of ${trade.volume.toFixed(2)}`} accent="text-foreground" />
                        <MiniStat label="Opened" value={fmtTimeAgo(trade.openedAt)} sub={new Date(trade.openedAt).toLocaleTimeString()} accent="text-muted-foreground" />
                    </div>

                    {/* Full target table */}
                    <div className="overflow-hidden rounded-xl border border-border/20">
                        <table className="w-full text-micro">
                            <thead>
                                <tr className="border-b border-border/20 bg-muted/30 text-left text-micro uppercase tracking-wide text-muted-foreground">
                                    <th className="px-3 py-2 font-semibold">Target</th>
                                    <th className="px-3 py-2 font-semibold">Price</th>
                                    <th className="px-3 py-2 font-semibold">Close %</th>
                                    <th className="px-3 py-2 font-semibold">Distance</th>
                                    <th className="px-3 py-2 font-semibold">Status</th>
                                </tr>
                            </thead>
                            <tbody className="font-mono">
                                {(["tp1", "tp2", "tp3"] as const).map((tp) => {
                                    const t = trade.config[tp];
                                    const dist = Math.abs(t.price - trade.currentPrice);
                                    const isNext = !trade.config.tp1.hit && tp === "tp1" || trade.config.tp1.hit && !trade.config.tp2.hit && tp === "tp2" || trade.config.tp2.hit && !trade.config.tp3.hit && tp === "tp3";
                                    return (
                                        <tr key={tp} className={cn("border-b border-border/10 last:border-0", isNext && "bg-violet-500/[0.04]")}>
                                            <td className="px-3 py-2 font-sans font-semibold text-foreground">{tp.toUpperCase()}</td>
                                            <td className="px-3 py-2">{fmtP(t.price, trade.symbol)}</td>
                                            <td className="px-3 py-2">{t.closePercent}%</td>
                                            <td className="px-3 py-2 text-muted-foreground">{t.hit ? "—" : `${dist.toFixed(digitsFor(trade.symbol))}`}</td>
                                            <td className="px-3 py-2">
                                                {t.hit ? (
                                                    <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle size={10} /> Hit {t.hitAt ? fmtTimeAgo(t.hitAt) : ""}</span>
                                                ) : isNext ? (
                                                    <span className="text-violet-400">Next</span>
                                                ) : (
                                                    <span className="text-muted-foreground">Pending</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Config chips */}
                    <div className="flex flex-wrap gap-2 text-micro">
                        {trade.config.breakEvenEnabled && <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-400">BE after {trade.config.breakEvenTrigger}</span>}
                        {trade.config.profitLockEnabled && <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-400">Lock at {trade.config.profitLockTrigger}</span>}
                        {trade.config.trailingEnabled && <span className="rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-violet-400">Trailing: {trade.config.trailingType}</span>}
                        <span className="rounded-md border border-border/20 bg-muted/20 px-2 py-1 text-muted-foreground">Runner: {trade.config.runnerPercent}%</span>
                        <span className="rounded-md border border-border/20 bg-muted/20 px-2 py-1 text-muted-foreground">Updated {fmtTimeAgo(trade.lastUpdated)}</span>
                    </div>

                    {/* Close history */}
                    {trade.closeHistory.length > 0 && (
                        <div>
                            <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Partial Close History</p>
                            <div className="space-y-1.5">
                                {trade.closeHistory.map((ch, i) => (
                                    <div key={i} className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2 text-micro">
                                        <CheckCircle size={12} className="shrink-0 text-emerald-400" />
                                        <span className="font-semibold text-foreground">{ch.target}</span>
                                        <span className="font-mono text-muted-foreground">{ch.volume.toFixed(2)} lots @ {fmtP(ch.price, trade.symbol)}</span>
                                        <span className="ml-auto text-muted-foreground">{new Date(ch.timestamp).toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    {editable && (
                        <div className="flex flex-wrap items-center gap-2 border-t border-border/20 pt-4">
                            {canMoveBe && (
                                <button
                                    type="button"
                                    onClick={() => void onAction(trade, "updateSl", { newSl: trade.entry })}
                                    disabled={busy}
                                    className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-micro font-semibold text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                    <Lock size={11} /> Move SL to BE
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => void onAction(trade, "closePartial", { closeVolume: Number((trade.remainingVolume / 2).toFixed(2)) })}
                                disabled={busy || trade.remainingVolume < 0.02}
                                className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-micro font-medium text-foreground transition hover:bg-muted/40 disabled:opacity-50"
                            >
                                <Scissors size={11} /> Close 50%
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={busy}
                                className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-micro font-semibold text-rose-400 transition hover:bg-rose-500/20 disabled:opacity-50"
                            >
                                <X size={11} /> Close at market
                            </button>
                            {busy && <Loader2 size={13} className="animate-spin text-violet-400" />}
                            {!trade.config.autoManagement && (
                                <button
                                    type="button"
                                    onClick={() => void onAction(trade, "updateConfig", { config: { autoManagement: true } })}
                                    className="ml-auto flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-micro font-semibold text-violet-400 transition hover:bg-violet-500/20"
                                >
                                    <Zap size={11} /> Enable auto
                                </button>
                            )}
                            {["CLOSED", "STOPPED", "CANCELLED"].includes(trade.state) && (
                                <button type="button" onClick={onDelete} className="ml-auto rounded-lg p-2 text-muted-foreground hover:text-rose-400 transition" title="Remove">
                                    <Trash2 size={13} />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function Scissors({ size, className }: { size: number; className?: string }) {
    // Small local icon to avoid another import churn — matches lucide style.
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" />
        </svg>
    );
}

function MiniStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
    return (
        <div className="rounded-xl bg-muted/40 p-3">
            <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={cn("mt-0.5 font-mono text-sm font-bold", accent)}>{value}</p>
            {sub && <p className="text-micro text-muted-foreground">{sub}</p>}
        </div>
    );
}
