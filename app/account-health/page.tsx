"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { pluginFetch } from "@/lib/plugins/ui";
import AccountShell from "@/components/account/AccountShell";
import {
    Shield, Activity, Wallet, TrendingDown, AlertTriangle,
    Loader2, RefreshCw, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

type RiskLevel = "LOW" | "MODERATE" | "HIGH";
type HealthStatus = "SAFE" | "WARNING" | "DANGER";
type ExposureStatus = "LOW" | "MODERATE" | "HIGH";

interface AccountHealth {
    score: number;
    riskLevel: RiskLevel;
    drawdownStatus: HealthStatus;
    marginStatus: HealthStatus;
    exposureStatus: ExposureStatus;
    metrics: {
        balance: number;
        equity: number;
        floatingPnl: number;
        floatingPnlPct: number;
        drawdown: number;
        maxDrawdown: number;
        marginLevel: number;
        marginUtilization: number;
        totalPositions: number;
        positionsAtRisk: number;
        openRisk: number;
    };
    trading: {
        totalSignals: number;
        winRate: string;
        averageR: string;
    };
    breakdown: {
        drawdown: number;
        margin: number;
        exposure: number;
        pnl: number;
        signalQuality: number;
    };
}

export default function AccountHealthPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [health, setHealth] = useState<AccountHealth | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchHealth = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const res = await pluginFetch("/api/account-health", { method: "GET" });
            const data = (await res.json()) as { success: boolean; health: AccountHealth };
            if (data.success) setHealth(data.health);
        } catch {}
        finally { setLoading(false); }
    }, [user]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!authLoading && user) fetchHealth();
    }, [authLoading, user, fetchHealth]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Account Health"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    }
    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Account Health"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1></div></AccountShell></div>);
    }

    const score = health?.score || 0;
    const scoreColor = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-rose-400";
    const scoreBg = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-rose-500";

    return (
        <div className="min-h-screen bg-background text-foreground" data-guide="account-health">
            <AccountShell title="Account Health" subtitle="Real-time risk assessment and account monitoring">
                <div className="space-y-6" data-guide="content">
                    {/* Score Ring */}
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-8" data-guide="score-ring">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-foreground">Health Score</h2>
                                <button type="button" onClick={fetchHealth} disabled={loading} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="relative h-32 w-32">
                                    <div className="h-full w-full rounded-full border-4 border-border/60" />
                                    <div className={cn("absolute inset-0 rounded-full border-4 border-t-transparent", scoreBg)} style={{ transform: `rotate(${score * 3.6}deg)`, transition: "transform 1s ease" }} />
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className={cn("text-4xl font-bold font-mono", scoreColor)}>{score}</span>
                                        <span className="text-[10px] text-muted-foreground">/ 100</span>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <div className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium", health?.riskLevel === "LOW" ? "bg-emerald-500/10 text-emerald-400" : health?.riskLevel === "MODERATE" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400")}>
                                        <Shield size={14} /> Risk: {health?.riskLevel}
                                    </div>
                                    <div className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", health?.drawdownStatus === "SAFE" ? "bg-emerald-500/10 text-emerald-400" : health?.drawdownStatus === "WARNING" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400")}>
                                        <TrendingDown size={14} /> DD: {health?.drawdownStatus}
                                    </div>
                                    <div className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", health?.marginStatus === "SAFE" ? "bg-emerald-500/10 text-emerald-400" : health?.marginStatus === "WARNING" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400")}>
                                        <Wallet size={14} /> Margin: {health?.marginStatus}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Breakdown */}
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                            <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><BarChart3 size={16} className="text-violet-400" />Score Breakdown</h3>
                            <div className="space-y-3">
                                {[
                                    { label: "Drawdown", value: health?.breakdown?.drawdown || 0, max: 30, color: "bg-rose-500" },
                                    { label: "Margin Usage", value: health?.breakdown?.margin || 0, max: 20, color: "bg-amber-500" },
                                    { label: "Exposure", value: health?.breakdown?.exposure || 0, max: 25, color: "bg-blue-500" },
                                    { label: "P/L", value: health?.breakdown?.pnl || 0, max: 10, color: "bg-emerald-500" },
                                    { label: "Signal Quality", value: health?.breakdown?.signalQuality || 0, max: 15, color: "bg-violet-500" },
                                ].map((item) => (
                                    <div key={item.label}>
                                        <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{item.label}</span><span className="font-mono text-foreground">{item.value}/{item.max}</span></div>
                                        <div className="mt-1 h-2 rounded-full bg-muted/20"><div className={cn("h-full rounded-full transition-all", item.color)} style={{ width: `${Math.min(100, (item.value / item.max) * 100)}%` }} /></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                        {[
                            { label: "Balance", value: `$${(health?.metrics?.balance || 0).toLocaleString()}`, icon: Wallet },
                            { label: "Equity", value: `$${(health?.metrics?.equity || 0).toLocaleString()}`, icon: Activity },
                            { label: "P/L", value: `${(health?.metrics?.floatingPnl || 0) >= 0 ? "+" : ""}${(health?.metrics?.floatingPnl || 0).toFixed(2)}`, icon: TrendingDown },
                            { label: "Positions", value: String(health?.metrics?.totalPositions || 0), icon: Activity },
                            { label: "Risk", value: `$${(health?.metrics?.openRisk || 0).toFixed(0)}`, icon: AlertTriangle },
                            { label: "Margin Level", value: `${health?.metrics?.marginLevel?.toFixed(0) || 0}%`, icon: Shield },
                        ].map((m) => (
                            <div key={m.label} className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                <div className="flex items-center gap-2"><m.icon size={14} className="text-violet-400" /><span className="text-[10px] font-semibold uppercase text-muted-foreground">{m.label}</span></div>
                                <p className="mt-2 font-mono text-sm font-bold text-foreground">{m.value}</p>
                            </div>
                        ))}
                    </div>

                    {health?.trading && (
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                <span className="text-[10px] font-semibold uppercase text-muted-foreground">Recent Win Rate</span>
                                <p className="mt-1 font-mono text-xl font-bold text-foreground">{health.trading.winRate}%</p>
                            </div>
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                <span className="text-[10px] font-semibold uppercase text-muted-foreground">Average R</span>
                                <p className="mt-1 font-mono text-xl font-bold text-foreground">{health.trading.averageR}R</p>
                            </div>
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                <span className="text-[10px] font-semibold uppercase text-muted-foreground">Total Signals</span>
                                <p className="mt-1 font-mono text-xl font-bold text-foreground">{health.trading.totalSignals}</p>
                            </div>
                        </div>
                    )}
                </div>
            </AccountShell>
        </div>
    );
}
