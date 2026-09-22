"use client";

import { useState, useCallback, useEffect } from "react";
import {
    Loader2, Shield, ArrowLeft, Plus, X, ChevronDown, ChevronUp,
    TrendingUp, TrendingDown, Target, Lock, AlertTriangle, CheckCircle,
    Zap, Activity, Bell,
} from "lucide-react";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

type TradeState = {
    tradeId: string; accountId: string; ticket: string; symbol: string;
    direction: "BUY" | "SELL"; entry: number; currentSl: number; currentTp: number;
    volume: number; currentPrice: number; state: string;
    config: { tp1: { price: number; hit: boolean; closePercent: number }; tp2: { price: number; hit: boolean; closePercent: number }; tp3: { price: number; hit: boolean; closePercent: number }; runnerPercent: number; breakEvenEnabled: boolean; breakEvenTrigger: string; profitLockEnabled: boolean; profitLockTrigger: string; trailingEnabled: boolean; autoManagement: boolean; trailingType: string };
    riskAmount: number; riskPoints: number; currentPnl: number; currentR: number;
    lockedProfit: number; remainingVolume: number;
    closeHistory: { target: string; volume: number; price: number; timestamp: number }[];
    openedAt: number; lastUpdated: number;
};

const STATE_LABELS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    OPEN: { label: "Open", color: "text-blue-400 bg-blue-500/10", icon: Activity },
    TP1_APPROACHING: { label: "Approaching TP1", color: "text-amber-400 bg-amber-500/10", icon: Target },
    TP1_HIT: { label: "TP1 Hit", color: "text-emerald-400 bg-emerald-500/10", icon: CheckCircle },
    BE_PENDING: { label: "BE Pending", color: "text-amber-400 bg-amber-500/10", icon: Lock },
    BE_APPLIED: { label: "Break Even", color: "text-emerald-400 bg-emerald-500/10", icon: Lock },
    TP2_APPROACHING: { label: "Approaching TP2", color: "text-amber-400 bg-amber-500/10", icon: Target },
    TP2_HIT: { label: "TP2 Hit", color: "text-emerald-400 bg-emerald-500/10", icon: CheckCircle },
    PROFIT_LOCKED: { label: "Profit Locked", color: "text-emerald-400 bg-emerald-500/10", icon: Lock },
    TP3_APPROACHING: { label: "Approaching TP3", color: "text-amber-400 bg-amber-500/10", icon: Target },
    TP3_HIT: { label: "TP3 Hit", color: "text-emerald-400 bg-emerald-500/10", icon: CheckCircle },
    RUNNER_ACTIVE: { label: "Runner Active", color: "text-violet-400 bg-violet-500/10", icon: Zap },
    TRAILING: { label: "Trailing", color: "text-violet-400 bg-violet-500/10", icon: Activity },
    CLOSED: { label: "Closed", color: "text-muted-foreground bg-muted/10", icon: CheckCircle },
    STOPPED: { label: "Stopped", color: "text-rose-400 bg-rose-500/10", icon: AlertTriangle },
};

export default function TradeManagementPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [trades, setTrades] = useState<TradeState[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
    const [positions, setPositions] = useState<Record<string, { ticket: string; symbol: string; type: string; volume: number; openPrice: number; currentPrice: number; sl: number; tp: number; profit: number }[]>>({});

    // Create form
    const [selAccount, setSelAccount] = useState("");
    const [selTicket, setSelTicket] = useState("");
    const [tp1Pct, setTp1Pct] = useState("30");
    const [tp2Pct, setTp2Pct] = useState("30");
    const [tp3Pct, setTp3Pct] = useState("30");
    const [runnerPct, setRunnerPct] = useState("10");
    const [beEnabled, setBeEnabled] = useState(true);
    const [plEnabled, setPlEnabled] = useState(true);
    const [autoMgmt, setAutoMgmt] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const headers = { Authorization: `Bearer ${token}` };

            const [tradesRes, accountsRes] = await Promise.all([
                fetch("/api/trade-management", { headers }),
                fetch("/api/analytics/accounts", { headers }),
            ]);

            const tradesData = await tradesRes.json();
            if (tradesData.success) setTrades(tradesData.trades || []);

            const accountsData = await accountsRes.json();
            if (accountsData.accounts) {
                setAccounts(accountsData.accounts.map((a: { accountId: string; accountName?: string }) => ({
                    id: a.accountId,
                    name: a.accountName || a.accountId,
                })));
            }
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchData()); }, [user, fetchData]);

    const fetchPositions = useCallback(async (accountId: string) => {
        if (!user) return;
        const token = await user.getIdToken();
        const res = await fetch(`/api/trading/positions?accountId=${accountId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.positions) {
            setPositions((prev) => ({ ...prev, [accountId]: data.positions }));
        }
    }, [user]);

    const createTradeManagement = async () => {
        if (!user || !selAccount || !selTicket) return;
        const posList = positions[selAccount] || [];
        const pos = posList.find((p) => String(p.ticket) === selTicket);
        if (!pos) return;

        const entry = pos.openPrice;
        const sl = pos.sl || entry;

        const totalPct = Number(tp1Pct) + Number(tp2Pct) + Number(tp3Pct) + Number(runnerPct);
        if (totalPct > 100) { alert(`Total ${totalPct}% exceeds 100%`); return; }

        const token = await user.getIdToken();
        const res = await fetch("/api/trade-management", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                accountId: selAccount,
                ticket: selTicket,
                symbol: pos.symbol,
                direction: pos.type === "BUY" ? "BUY" : "SELL",
                entry,
                sl,
                volume: pos.volume,
                config: {
                    tp1: { price: pos.tp || entry * 1.005, closePercent: Number(tp1Pct), hit: false, eventIds: [] },
                    tp2: { price: (pos.tp || entry * 1.005) + Math.abs((pos.tp || entry * 1.005) - entry), closePercent: Number(tp2Pct), hit: false, eventIds: [] },
                    tp3: { price: (pos.tp || entry * 1.005) + Math.abs((pos.tp || entry * 1.005) - entry) * 2, closePercent: Number(tp3Pct), hit: false, eventIds: [] },
                    runnerPercent: Number(runnerPct),
                    breakEvenEnabled: beEnabled,
                    breakEvenTrigger: "TP1",
                    breakEvenOffset: 0,
                    profitLockEnabled: plEnabled,
                    profitLockTrigger: "TP2",
                    profitLockAmount: 0,
                    trailingEnabled: false,
                    trailingType: "fixed",
                    trailingDistance: 50,
                    trailingAtrMultiplier: 1.5,
                    autoManagement: autoMgmt,
                },
            }),
        });

        if (res.ok) { setShowCreate(false); fetchData(); }
    };

    const formatP = (p: number, s: string) => {
        const d = s.includes("JPY") ? 3 : s.includes("XAU") || s.includes("BTC") ? 2 : 5;
        return p.toFixed(d);
    };

    if (authLoading) return <div className="flex min-h-screen bg-background items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>;
    if (!user) return <div className="flex min-h-screen bg-background items-center justify-center gap-4 flex-col"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground">Sign In</Link></div>;

    const activeTrades = trades.filter((t) => !["CLOSED", "STOPPED"].includes(t.state));
    const closedTrades = trades.filter((t) => ["CLOSED", "STOPPED"].includes(t.state));

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition"><ArrowLeft size={12} /> Back to Account</Link>

                <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Smart Trade Management</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Multi-target trade management with auto break-even, profit lock, and trailing</p>
                    </div>
                    <button type="button" onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-violet-500 transition">
                        <Plus size={13} /> Manage Trade
                    </button>
                </div>

                {/* Stats */}
                <div className="mb-6 grid grid-cols-4 gap-4" data-guide="stats">
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Active</p>
                        <p className="text-xl font-bold font-mono text-blue-400">{activeTrades.length}</p>
                    </div>
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Total P/L</p>
                        <p className={cn("text-xl font-bold font-mono", activeTrades.reduce((s, t) => s + t.currentPnl, 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>${activeTrades.reduce((s, t) => s + t.currentPnl, 0).toFixed(2)}</p>
                    </div>
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Avg R</p>
                        <p className="text-xl font-bold font-mono text-violet-400">{activeTrades.length ? (activeTrades.reduce((s, t) => s + t.currentR, 0) / activeTrades.length).toFixed(1) : "0"}R</p>
                    </div>
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-4">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Closed</p>
                        <p className="text-xl font-bold font-mono text-muted-foreground">{closedTrades.length}</p>
                    </div>
                </div>

                {/* Create Modal */}
                {showCreate && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
                        <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-background p-6 shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold text-foreground">Add Trade to Management</h2>
                                <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Account</label>
                                    <select value={selAccount} onChange={(e) => { setSelAccount(e.target.value); fetchPositions(e.target.value); }} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                        <option value="">Select account</option>
                                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                    </select>
                                </div>
                                {selAccount && positions[selAccount] && (
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Position (Ticket)</label>
                                        <select value={selTicket} onChange={(e) => setSelTicket(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                            <option value="">Select position</option>
                                            {positions[selAccount]?.filter((p) => !trades.find((t) => t.ticket === String(p.ticket))).map((p) => (
                                                <option key={p.ticket} value={p.ticket}>{p.symbol} {p.type} {p.volume} lots — #{p.ticket}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                <div className="grid grid-cols-4 gap-3">
                                    <div><label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">TP1 %</label><input type="number" value={tp1Pct} onChange={(e) => setTp1Pct(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2 text-sm text-foreground focus:border-violet-500 focus:outline-none" /></div>
                                    <div><label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">TP2 %</label><input type="number" value={tp2Pct} onChange={(e) => setTp2Pct(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2 text-sm text-foreground focus:border-violet-500 focus:outline-none" /></div>
                                    <div><label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">TP3 %</label><input type="number" value={tp3Pct} onChange={(e) => setTp3Pct(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2 text-sm text-foreground focus:border-violet-500 focus:outline-none" /></div>
                                    <div><label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Runner %</label><input type="number" value={runnerPct} onChange={(e) => setRunnerPct(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2 text-sm text-foreground focus:border-violet-500 focus:outline-none" /></div>
                                </div>
                                <div className="rounded-lg bg-muted p-2 text-center text-[10px] text-muted-foreground">Total: {Number(tp1Pct) + Number(tp2Pct) + Number(tp3Pct) + Number(runnerPct)}%</div>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={beEnabled} onChange={(e) => setBeEnabled(e.target.checked)} className="rounded border-border/50 bg-muted/10 text-violet-500" /> Break Even after TP1</label>
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={plEnabled} onChange={(e) => setPlEnabled(e.target.checked)} className="rounded border-border/50 bg-muted/10 text-violet-500" /> Lock Profit at TP2</label>
                                </div>
                                <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={autoMgmt} onChange={(e) => setAutoMgmt(e.target.checked)} className="rounded border-border/50 bg-muted/10 text-violet-500" /> Enable Auto Management</label>
                                {!autoMgmt && <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2 text-[10px] text-amber-400"><AlertTriangle size={10} className="mr-1 inline" /> Manual mode: recommendations only, no auto-execution</div>}
                                <button type="button" onClick={createTradeManagement} disabled={!selTicket} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">Add Trade</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Trade Cards */}
                {loading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : activeTrades.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <Target size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No managed trades</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">Click "Manage Trade" to add a position</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {activeTrades.map((trade) => {
                            const st = STATE_LABELS[trade.state] || STATE_LABELS.OPEN;
                            const StIcon = st.icon;
                            const isExpanded = expanded === trade.tradeId;
                            const progress = trade.config.tp3.hit ? 100 : trade.config.tp2.hit ? 75 : trade.config.tp1.hit ? 50 : trade.state.includes("APPROACHING") ? 25 : 5;
                            const tpDigits = trade.symbol.includes("JPY") ? 3 : trade.symbol.includes("XAU") || trade.symbol.includes("BTC") ? 2 : 5;

                            return (
                                <div key={trade.tradeId} className="rounded-2xl border border-border/30 bg-muted/50 overflow-hidden">
                                    {/* Header */}
                                    <div className="flex items-center gap-4 p-5">
                                        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold", trade.direction === "BUY" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>
                                            {trade.direction === "BUY" ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm font-bold text-foreground">{trade.symbol}</span>
                                                <span className={cn("rounded-md px-2 py-0.5 text-[9px] font-medium", st.color)}>{st.label}</span>
                                                <span className="rounded-md bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">#{trade.ticket}</span>
                                                {trade.config.autoManagement && <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-[9px] text-violet-400">AUTO</span>}
                                            </div>
                                            <div className="mt-1 flex items-center gap-4 text-[10px] text-muted-foreground">
                                                <span>Entry: <span className="font-mono text-muted-foreground">{formatP(trade.entry, trade.symbol)}</span></span>
                                                <span>Current: <span className={cn("font-mono", trade.currentPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatP(trade.currentPrice, trade.symbol)}</span></span>
                                                <span className={cn("font-mono font-bold", trade.currentPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{trade.currentPnl >= 0 ? "+" : ""}{trade.currentPnl.toFixed(2)}</span>
                                                <span className="text-violet-400 font-mono">{trade.currentR >= 0 ? "+" : ""}{trade.currentR.toFixed(1)}R</span>
                                            </div>
                                        </div>

                                        {/* Targets */}
                                        <div className="flex items-center gap-2">
                                            {(["tp1", "tp2", "tp3"] as const).map((tp) => (
                                                <div key={tp} className={cn("flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-medium", trade.config[tp].hit ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground")}>
                                                    {trade.config[tp].hit ? <CheckCircle size={10} /> : <Target size={10} />}
                                                    {tp.toUpperCase()} {formatP(trade.config[tp].price, trade.symbol)}
                                                </div>
                                            ))}
                                            <div className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[9px] text-muted-foreground">
                                                <Zap size={10} /> {trade.remainingVolume.toFixed(2)}
                                            </div>
                                        </div>

                                        <button type="button" onClick={() => setExpanded(isExpanded ? null : trade.tradeId)} className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition">
                                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                        </button>
                                    </div>

                                    {/* Progress bar */}
                                    <div className="px-5 pb-2">
                                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                                        </div>
                                    </div>

                                    {/* Expanded details */}
                                    {isExpanded && (
                                        <div className="border-t border-border/20 p-5 space-y-4">
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="rounded-xl bg-muted p-3">
                                                    <p className="text-[9px] uppercase text-muted-foreground">Risk</p>
                                                    <p className="font-mono text-sm font-bold text-rose-400">${trade.riskAmount.toFixed(2)}</p>
                                                    <p className="text-[9px] text-muted-foreground">{trade.riskPoints.toFixed(1)} pts</p>
                                                </div>
                                                <div className="rounded-xl bg-muted p-3">
                                                    <p className="text-[9px] uppercase text-muted-foreground">Locked Profit</p>
                                                    <p className="font-mono text-sm font-bold text-emerald-400">${trade.lockedProfit.toFixed(2)}</p>
                                                </div>
                                                <div className="rounded-xl bg-muted p-3">
                                                    <p className="text-[9px] uppercase text-muted-foreground">Remaining Vol</p>
                                                    <p className="font-mono text-sm font-bold text-foreground">{trade.remainingVolume.toFixed(2)} lots</p>
                                                </div>
                                            </div>

                                            {/* Close history */}
                                            {trade.closeHistory.length > 0 && (
                                                <div>
                                                    <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Close History</p>
                                                    {trade.closeHistory.map((ch, i) => (
                                                        <div key={i} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 text-[10px]">
                                                            <CheckCircle size={12} className="text-emerald-400" />
                                                            <span className="font-mono text-muted-foreground">{ch.target}</span>
                                                            <span className="text-muted-foreground">{ch.volume} lots @ {formatP(ch.price, trade.symbol)}</span>
                                                            <span className="text-muted-foreground">{new Date(ch.timestamp).toLocaleTimeString()}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Config summary */}
                                            <div className="rounded-xl bg-muted/50 p-3">
                                                <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Configuration</p>
                                                <div className="flex flex-wrap gap-2 text-[9px]">
                                                    {trade.config.breakEvenEnabled && <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-400">BE after {trade.config.breakEvenTrigger}</span>}
                                                    {trade.config.profitLockEnabled && <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-400">Lock at {trade.config.profitLockTrigger}</span>}
                                                    {trade.config.trailingEnabled && <span className="rounded-md bg-violet-500/10 px-2 py-1 text-violet-400">Trailing: {trade.config.trailingType}</span>}
                                                    <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">Runner: {trade.config.runnerPercent}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Closed trades */}
                {closedTrades.length > 0 && (
                    <div className="mt-8">
                        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Closed Trades</h2>
                        <div className="space-y-2">
                            {closedTrades.slice(0, 10).map((trade) => (
                                <div key={trade.tradeId} className="flex items-center gap-4 rounded-xl border border-border/20 bg-muted/10 px-4 py-3 opacity-60">
                                    <span className="font-mono text-sm text-foreground">{trade.symbol}</span>
                                    <span className={cn("rounded-md px-2 py-0.5 text-[9px] font-medium", STATE_LABELS[trade.state]?.color)}>{STATE_LABELS[trade.state]?.label}</span>
                                    <span className={cn("font-mono text-xs font-bold", trade.currentPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{trade.currentPnl >= 0 ? "+" : ""}{trade.currentPnl.toFixed(2)}</span>
                                    <span className="text-[9px] text-muted-foreground">{new Date(trade.openedAt).toLocaleDateString()}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
