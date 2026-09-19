"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import { RefreshCw, Loader2, BarChart3, TrendingUp, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export default function StrategyComparePage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    useEffect(() => { const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); }); return () => unsub(); }, []);

    const fetchData = async () => {
        if (!user || selectedIds.length < 2) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/strategy-compare", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ strategyIds: selectedIds }),
            });
            const d = await res.json();
            if (d.success) setData(d);
        } catch {}
        finally { setLoading(false); }
    };

    useEffect(() => {
        if (!authLoading && user) {
            const load = async () => {
                const token = await user.getIdToken();
                const res = await fetch("/api/strategy-lab/strategies", { headers: { Authorization: `Bearer ${token}` } });
                const d = await res.json();
                if (d.strategies) setSelectedIds([d.strategies[0]?.id, d.strategies[1]?.id].filter(Boolean));
            };
            load();
        }
    }, [authLoading, user]);

    const toggleStrategy = (id: string) => {
        setSelectedIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id].slice(-5));
    };

    if (authLoading) return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Strategy Comparison"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    if (!user) return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Strategy Comparison"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Target size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1></div></AccountShell></div>);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="Strategy Comparison" subtitle="Compare strategies side by side with consistent metrics">
                <div className="space-y-6" data-guide="page-header">
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                        <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><Target size={16} className="text-violet-400" />Select Strategies</h3>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { id: "strat_1", name: "Trend M5" },
                                { id: "strat_2", name: "Breakout H1" },
                                { id: "strat_3", name: "Mean Rev M15" },
                                { id: "strat_4", name: "Scalping M1" },
                                { id: "strat_5", name: "Swing D1" },
                            ].map((s) => (
                                <button key={s.id} type="button" onClick={() => toggleStrategy(s.id)} className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium transition", selectedIds.includes(s.id) ? "border-violet-500/40 bg-violet-500/10 text-violet-400" : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted/30")}>{s.name}</button>
                            ))}
                        </div>
                    </div>

                    <button type="button" onClick={fetchData} disabled={loading || selectedIds.length < 2} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Compare
                    </button>

                    {data && data.comparisons && data.comparisons.length >= 2 && (
                        <div className="overflow-x-auto rounded-xl border border-border/30 bg-muted/50">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-border/20 text-[10px] uppercase text-muted-foreground">
                                        <th className="px-4 py-3 text-left">Metric</th>
                                        {data.comparisons.map((c: any, i: number) => (
                                            <th key={i} className="px-4 py-3 text-right font-mono text-foreground">{c.strategyName}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        { label: "Total Trades", key: "totalTrades" },
                                        { label: "Win Rate", key: "winRate", suffix: "%" },
                                        { label: "Net Profit", key: "netProfit", prefix: "$" },
                                        { label: "Profit Factor", key: "profitFactor" },
                                        { label: "Expectancy R", key: "expectancyR" },
                                        { label: "Max Drawdown", key: "maxDrawdownPct", suffix: "%" },
                                        { label: "Sharpe-like", key: "sharpeLike" },
                                        { label: "Recovery Factor", key: "recoveryFactor" },
                                        { label: "Max Cons Wins", key: "maxConsecutiveWins" },
                                        { label: "Max Cons Losses", key: "maxConsecutiveLosses" },
                                    ].map((metric) => (
                                        <tr key={metric.label} className="border-b border-border/10">
                                            <td className="px-4 py-2.5 text-left text-muted-foreground">{metric.label}</td>
                                            {data.comparisons.map((c: any, i: number) => (
                                                <td key={i} className={cn("px-4 py-2.5 text-right font-mono", metric.key === "netProfit" && c[metric.key] < 0 ? "text-rose-400" : metric.key === "maxDrawdownPct" && c[metric.key] > 15 ? "text-rose-400" : "text-muted-foreground")}>
                                                    {metric.prefix || ""}{typeof c[metric.key] === "number" ? c[metric.key].toFixed(metric.key === "expectancyR" || metric.key === "sharpeLike" || metric.key === "recoveryFactor" ? 2 : 1) : c[metric.key] || "—"}{metric.suffix || ""}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </AccountShell>
        </div>
    );
}
