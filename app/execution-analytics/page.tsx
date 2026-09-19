"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import { RefreshCw, Loader2, Activity, Clock, TrendingUp, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ExecutionAnalyticsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => { const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); }); return () => unsub(); }, []);

    const fetchData = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/execution-analytics", { headers: { Authorization: `Bearer ${token}` } });
            const d = await res.json();
            if (d.success) setData(d.execution);
        } catch {}
        finally { setLoading(false); }
    };

    useEffect(() => { if (!authLoading && user) fetchData(); }, [authLoading, user]);

    if (authLoading) return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Broker & Execution Analytics"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    if (!user) return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Broker & Execution Analytics"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1></div></AccountShell></div>);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="Broker & Execution Analytics" subtitle="Track spread, slippage, and execution quality">
                <div className="space-y-6" data-guide="page-header">
                    {data && (
                        <>
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6" data-guide="stats">
                                {[
                                    { label: "Execution Score", value: `${data.executionScore}`, color: "text-violet-400" },
                                    { label: "Fill Rate", value: `${data.fillRate}%`, color: "text-emerald-400" },
                                    { label: "Rejection Rate", value: `${data.rejectionRate}%`, color: data.rejectionRate > 3 ? "text-rose-400" : "text-emerald-400" },
                                    { label: "Avg Slippage", value: `${data.avgSlippage} pips`, color: "text-amber-400" },
                                    { label: "Total Costs", value: `$${data.totalCosts.toFixed(2)}`, color: "text-muted-foreground" },
                                    { label: "Total Orders", value: String(data.totalOrders), color: "text-foreground" },
                                ].map((m) => (
                                    <div key={m.label} className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">{m.label}</span>
                                        <p className={cn("mt-1 font-mono text-lg font-bold", m.color)}>{m.value}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                                <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity size={14} /> Execution Quality</div>
                                    <p className={cn("mt-2 text-3xl font-bold font-mono", data.executionQuality === "EXCELLENT" ? "text-emerald-400" : data.executionQuality === "GOOD" ? "text-violet-400" : data.executionQuality === "FAIR" ? "text-amber-400" : "text-rose-400")}>{data.executionQuality}</p>
                                </div>
                                <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock size={14} /> Avg Slippage</div>
                                    <p className="mt-2 text-3xl font-bold font-mono text-amber-400">{data.avgSlippage}</p>
                                    <p className="mt-1 text-[10px] text-muted-foreground">pips per order</p>
                                </div>
                                <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp size={14} /> Cost Impact</div>
                                    <p className="mt-2 text-3xl font-bold font-mono text-muted-foreground">{data.costImpactPct}%</p>
                                    <p className="mt-1 text-[10px] text-muted-foreground">of trade value</p>
                                </div>
                            </div>
                        </>
                    )}

                    <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-4 text-[11px] text-amber-400/60">
                        <Shield size={12} className="mr-1 inline" />
                        Execution analytics use real MT5 order data. Metrics are computed from actual fills, slippage, and costs recorded by your broker.
                    </div>
                </div>
            </AccountShell>
        </div>
    );
}
