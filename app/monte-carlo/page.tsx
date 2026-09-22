"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import {
    Dices, RefreshCw, Loader2, BarChart3, TrendingUp,
    AlertTriangle, Shield, Activity, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function MonteCarloPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [mcData, setMcData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [numSims, setNumSims] = useState(10000);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const runSimulation = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/monte-carlo", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ numSimulations: numSims }),
            });
            const data = await res.json();
            if (data.success) setMcData(data.monteCarlo);
        } catch {}
        finally { setLoading(false); }
    };

    useEffect(() => { if (!authLoading && user) void Promise.resolve().then(() => runSimulation()); }, [authLoading, user]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Monte Carlo Simulation"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    }
    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Monte Carlo Simulation"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Dices size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1></div></AccountShell></div>);
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="Monte Carlo Analysis" subtitle="Statistical simulation of your trading outcomes">
                <div className="space-y-6" data-guide="page-header">
                    <div className="flex items-center gap-4">
                        <button type="button" onClick={runSimulation} disabled={loading} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                            {loading ? <Loader2 size={14} className="animate-spin" /> : <Dices size={14} />} Run Simulation ({numSims.toLocaleString()} iterations)
                        </button>
                        <select value={numSims} onChange={(e) => setNumSims(Number(e.target.value))} className="rounded-lg border border-border/40 bg-muted px-3 py-2 text-xs text-foreground focus:border-violet-500 focus:outline-none">
                            <option value={1000}>1,000</option>
                            <option value={5000}>5,000</option>
                            <option value={10000}>10,000</option>
                            <option value={50000}>50,000</option>
                        </select>
                    </div>

                    {mcData && (
                        <>
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6" data-guide="stats">
                                {[
                                    { label: "Prob. of Ruin", value: `${mcData.probabilityOfRuin?.toFixed(1) || 0}%`, color: "text-rose-400" },
                                    { label: "Expected Max DD", value: `${mcData.expectedMaxDD?.toFixed(1) || 0}%`, color: "text-amber-400" },
                                    { label: "Worst Sim DD", value: `${mcData.worstSimulatedDD?.toFixed(1) || 0}%`, color: "text-rose-400" },
                                    { label: "Median Return", value: `${mcData.medianFinalR?.toFixed(2) || 0}R`, color: "text-emerald-400" },
                                    { label: "Best Case", value: `+${mcData.bestCaseR?.toFixed(2) || 0}R`, color: "text-emerald-400" },
                                    { label: "Losing Streak", value: `${mcData.losingStreakProbability?.toFixed(1) || 0}%`, color: "text-amber-400" },
                                ].map((m) => (
                                    <div key={m.label} className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">{m.label}</span>
                                        <p className={cn("mt-1 font-mono text-lg font-bold", m.color)}>{m.value}</p>
                                    </div>
                                ))}
                            </div>

                            {mcData.confidenceIntervals && (
                                <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                    <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><BarChart3 size={16} className="text-violet-400" />Confidence Intervals</h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b border-border/20 text-[10px] uppercase text-muted-foreground">
                                                    <th className="px-4 py-2.5 text-left">Confidence</th>
                                                    <th className="px-4 py-2.5 text-right">Max Drawdown</th>
                                                    <th className="px-4 py-2.5 text-right">Final Return</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {Object.entries(mcData.confidenceIntervals).map(([cl, data]: [string, any]) => (
                                                    <tr key={cl} className="border-b border-border/10">
                                                        <td className="px-4 py-2.5 font-mono font-medium text-foreground">{cl}</td>
                                                        <td className={cn("px-4 py-2.5 text-right font-mono", data.maxDD < -10 ? "text-rose-400" : "text-emerald-400")}>{data.maxDD?.toFixed(1)}%</td>
                                                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{data.finalReturn?.toFixed(2)}R</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-4 text-[11px] text-amber-400/60">
                                <AlertTriangle size={12} className="mr-1 inline" />
                                Monte Carlo simulations are statistical estimates based on your historical trade distribution. They are NOT guarantees of future performance. Past results do not guarantee future outcomes.
                            </div>
                        </>
                    )}
                </div>
            </AccountShell>
        </div>
    );
}
