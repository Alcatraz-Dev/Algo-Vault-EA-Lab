"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import { RefreshCw, Loader2, AlertTriangle, Shield, Activity, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export default function CorrelationPage() {
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
            const res = await fetch("/api/correlation", { headers: { Authorization: `Bearer ${token}` } });
            const d = await res.json();
            if (d.success) setData(d);
        } catch {}
        finally { setLoading(false); }
    };

    useEffect(() => { if (!authLoading && user) fetchData(); }, [authLoading, user]);

    if (authLoading) return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Correlation & Exposure"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    if (!user) return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Correlation & Exposure"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1></div></AccountShell></div>);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="Correlation & Exposure" subtitle="Detect correlated positions and manage portfolio risk">
                <div className="space-y-6" data-guide="page-header">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Activity size={16} />
                            {data?.positions?.length || 0} open positions
                        </div>
                        <button type="button" onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition disabled:opacity-50">
                            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                        </button>
                    </div>

                    {data?.warning && (
                        <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.03] p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-rose-400"><AlertTriangle size={16} /> High Correlation Warning</div>
                            <p className="mt-1 text-xs text-muted-foreground">Your portfolio has concentrated exposure. Consider diversifying across uncorrelated assets.</p>
                        </div>
                    )}

                    {data?.correlations && data.correlations.length > 0 && (
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                            <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><TrendingUp size={16} className="text-violet-400" />Correlated Groups</h3>
                            <div className="space-y-3">
                                {data.correlations.map((c: any, i: number) => (
                                    <div key={i} className={cn("rounded-lg border p-3", c.concentration > 70 ? "border-rose-500/20 bg-rose-500/[0.03]" : c.concentration > 40 ? "border-amber-500/20 bg-amber-500/[0.03]" : "border-emerald-500/20 bg-emerald-500/[0.03]")}>
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono text-sm font-bold text-foreground">{c.group.replace(/_/g, " ").toUpperCase()}</span>
                                            <span className={cn("rounded px-2 py-0.5 text-[10px] font-medium", c.concentration > 70 ? "bg-rose-500/10 text-rose-400" : c.concentration > 40 ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400")}>
                                                {c.concentration}% concentration
                                            </span>
                                        </div>
                                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                            <span>Symbols: {c.symbols.join(", ")}</span>
                                            <span>•</span>
                                            <span>Volume: {c.totalVolume?.toFixed(2)} lots</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {data?.positions && data.positions.length > 0 && (
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                            <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><Activity size={16} className="text-violet-400" />Open Positions</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-border/20 text-[10px] uppercase text-muted-foreground">
                                            <th className="px-4 py-2.5 text-left">Symbol</th>
                                            <th className="px-4 py-2.5 text-left">Type</th>
                                            <th className="px-4 py-2.5 text-right">Volume</th>
                                            <th className="px-4 py-2.5 text-right">P/L</th>
                                            <th className="px-4 py-2.5 text-right">Risk</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.positions.map((p: any, i: number) => (
                                            <tr key={i} className="border-b border-border/10">
                                                <td className="px-4 py-2.5 font-mono font-medium text-foreground">{p.symbol}</td>
                                                <td className={cn("px-4 py-2.5 font-medium", p.type === "BUY" ? "text-emerald-400" : "text-rose-400")}>{p.type}</td>
                                                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{p.volume?.toFixed(2)}</td>
                                                <td className={cn("px-4 py-2.5 text-right font-mono", p.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>${p.profit?.toFixed(2)}</td>
                                                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">${p.risk?.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </AccountShell>
        </div>
    );
}
