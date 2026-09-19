"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import { RefreshCw, Loader2, BarChart3, TrendingUp, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

export default function WalkForwardPage() {
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
            const res = await fetch("/api/strategy-lab/strategies", { headers: { Authorization: `Bearer ${token}` } });
            const d = await res.json();
            if (d.strategies) {
                const strategies = d.strategies.slice(0, 5);
                const results = [];
                for (const s of strategies) {
                    try {
                        const btRes = await fetch(`/api/strategy-lab/backtest`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ strategyId: s.id, from: Date.now() - 365 * 86400000, to: Date.now() }) });
                        const bt = await btRes.json();
                        if (bt.backtest) results.push({ strategy: s.name, strategyId: s.id, inSample: bt.backtest.metrics, inSampleTrades: bt.backtest.trades.length });
                    } catch {}
                }
                setData({ strategies: results });
            }
        } catch {}
        finally { setLoading(false); }
    };

    useEffect(() => { if (!authLoading && user) fetchData(); }, [authLoading, user]);

    if (authLoading) return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Walk-Forward Validation"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    if (!user) return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Walk-Forward Validation"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1></div></AccountShell></div>);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="Walk-Forward Validation" subtitle="In-sample vs out-of-sample performance testing">
                <div className="space-y-6" data-guide="page-header">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">Split historical data into training (in-sample) and validation (out-of-sample) periods to test strategy robustness.</p>
                        <button type="button" onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Run Walk-Forward
                        </button>
                    </div>
                    {data && data.strategies ? (
                        <div className="overflow-x-auto rounded-xl border border-border/30 bg-muted/50">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-border/20 text-[10px] uppercase text-muted-foreground">
                                        <th className="px-4 py-3 text-left">Strategy</th>
                                        <th className="px-4 py-3 text-right">In-Sample Trades</th>
                                        <th className="px-4 py-3 text-right">Net Profit</th>
                                        <th className="px-4 py-3 text-right">Win Rate</th>
                                        <th className="px-4 py-3 text-right">Max DD</th>
                                        <th className="px-4 py-3 text-right">Profit Factor</th>
                                        <th className="px-4 py-3 text-left">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.strategies.map((s: any, i: number) => (
                                        <tr key={i} className="border-b border-border/10">
                                            <td className="px-4 py-3 font-mono text-foreground">{s.strategy}</td>
                                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{s.inSampleTrades || 0}</td>
                                            <td className={cn("px-4 py-3 text-right font-mono", (s.inSampleMetrics?.netProfit || 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>${(s.inSampleMetrics?.netProfit || 0).toFixed(2)}</td>
                                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{s.inSampleMetrics?.winRate?.toFixed(1) || 0}%</td>
                                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{s.inSampleMetrics?.maxDrawdownPct?.toFixed(1) || 0}%</td>
                                            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{s.inSampleMetrics?.profitFactor?.toFixed(2) || 0}</td>
                                            <td className="px-4 py-3 text-left"><span className={cn("rounded px-2 py-0.5 text-[10px]", s.inSampleMetrics ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>{(s.inSampleMetrics?.totalTrades || 0) > 0 ? "Validated" : "No Data"}</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-border/30 p-16 text-center">
                            <BarChart3 size={32} className="mx-auto text-muted-foreground" />
                            <p className="mt-3 text-sm text-muted-foreground">No strategies found. Create a strategy in the Strategy Lab first.</p>
                        </div>
                    )}
                </div>
            </AccountShell>
        </div>
    );
}
