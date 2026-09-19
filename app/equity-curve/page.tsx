"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader2, Shield, ArrowLeft, TrendingUp, TrendingDown, DollarSign, Activity, RefreshCw } from "lucide-react";
import Link from "next/link";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type CurvePoint = { time: number; equity: number; balance: number };
type Curve = { accountId: string; accountName: string; data: CurvePoint[] };

export default function EquityCurvePage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [curves, setCurves] = useState<Curve[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<string>("");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/analytics/equity-curve", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) {
                setCurves(json.curves || []);
                if (json.curves?.length > 0 && !selected) setSelected(json.curves[0].accountId);
            }
        } catch {} finally { setLoading(false); }
    }, [user, selected]);

    useEffect(() => { if (user) fetchData(); }, [user, fetchData]);

    const activeCurve = curves.find((c) => c.accountId === selected);

    const stats = activeCurve?.data.length ? (() => {
        const first = activeCurve.data[0];
        const last = activeCurve.data[activeCurve.data.length - 1];
        const pnl = last.equity - first.equity;
        const pnlPct = first.equity > 0 ? (pnl / first.equity) * 100 : 0;
        const peak = Math.max(...activeCurve.data.map((d) => d.equity));
        const trough = Math.min(...activeCurve.data.map((d) => d.equity));
        const drawdown = peak > 0 ? ((peak - trough) / peak) * 100 : 0;
        return { pnl, pnlPct, peak, trough, drawdown, points: activeCurve.data.length };
    })() : null;

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</Link></div></div>);
    }

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6 flex items-center justify-between" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Equity Curve</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Track your account equity and balance over time</p>
                    </div>
                    {curves.length > 0 && (
                        <button onClick={() => void fetchData()} disabled={loading} className="flex items-center gap-1.5 rounded-xl border border-border/40 bg-muted px-3 py-2 text-xs text-muted-foreground hover:bg-background/15 hover:text-foreground transition disabled:opacity-50">
                            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
                        </button>
                    )}
                </div>

                {curves.length > 1 && (
                    <div className="mb-4 flex gap-2" data-guide="curves">
                        {curves.map((c) => (
                            <button
                                key={c.accountId}
                                type="button"
                                onClick={() => setSelected(c.accountId)}
                                className={`rounded-xl px-4 py-2 text-xs font-medium transition-all ${
                                    selected === c.accountId
                                        ? "bg-violet-600 text-foreground"
                                        : "text-muted-foreground hover:text-muted-foreground bg-muted"
                                }`}
                            >
                                {c.accountName}
                            </button>
                        ))}
                    </div>
                )}

                {stats && (
                    <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4" data-guide="stats">
                        <div className="rounded-2xl border border-border/30 bg-card p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-1"><DollarSign size={13} className="text-violet-400" /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Net P/L</span></div>
                            <p className={`text-xl font-bold font-mono ${stats.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{stats.pnl >= 0 ? "+" : ""}{stats.pnl.toFixed(2)}</p>
                        </div>
                        <div className="rounded-2xl border border-border/30 bg-card p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-1"><TrendingUp size={13} className="text-emerald-400" /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Return %</span></div>
                            <p className={`text-xl font-bold font-mono ${stats.pnlPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{stats.pnlPct >= 0 ? "+" : ""}{stats.pnlPct.toFixed(2)}%</p>
                        </div>
                        <div className="rounded-2xl border border-border/30 bg-card p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-1"><Activity size={13} className="text-amber-400" /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Max Drawdown</span></div>
                            <p className="text-xl font-bold font-mono text-rose-400">-{stats.drawdown.toFixed(2)}%</p>
                        </div>
                        <div className="rounded-2xl border border-border/30 bg-card p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-1"><TrendingDown size={13} className="text-blue-400" /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Data Points</span></div>
                            <p className="text-xl font-bold font-mono text-foreground">{stats.points}</p>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : !activeCurve || activeCurve.data.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <Activity size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No equity data yet</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">Equity curve will appear once your AlgoVault Gateway EA starts reporting account balance updates</p>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-border/30 bg-card p-5 shadow-xl" data-guide="chart">
                        <h2 className="mb-4 text-sm font-semibold text-foreground">Equity & Balance Over Time</h2>
                        <div className="h-96">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={activeCurve.data.map((d) => ({ ...d, date: new Date(d.time).toLocaleDateString(undefined, { month: "short", day: "numeric" }) }))}>
                                    <defs>
                                        <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--tw-colors-muted-foreground)" }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: "var(--tw-colors-muted-foreground)" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", fontSize: "11px" }}
                                        labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                                        formatter={(value, name) => [`$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, name === "equity" ? "Equity" : "Balance"]}
                                    />
                                    <Area type="monotone" dataKey="equity" stroke="#8b5cf6" strokeWidth={3} fill="url(#equityGrad)" />
                                    <Area type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} fill="url(#balanceGrad)" strokeDasharray="5 5" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-violet-500" /> Equity</span>
                            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-blue-500 border-dashed" /> Balance</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
