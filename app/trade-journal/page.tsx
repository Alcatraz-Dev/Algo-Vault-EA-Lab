"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import {
    BookOpen, RefreshCw, Loader2, TrendingUp, TrendingDown,
    Target, Clock, Activity, BarChart3, Shield,
    ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { AuthRequired } from "@/components/ui/auth-required";

export default function TradeJournalPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [journal, setJournal] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchJournal = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/ai-signals", { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();
            if (data.signals) {
                const signals = data.signals.filter((s: any) => s.result && s.result !== "PENDING");
                setJournal(signals.slice(-50));
            }
        } catch {}
        finally { setLoading(false); }
    };

    useEffect(() => { if (!authLoading && user) void Promise.resolve().then(() => fetchJournal()); }, [authLoading, user]);

    const formatR = (r: number) => {
        if (!r || r === 0) return "0.00R";
        return `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Trade Journal"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></AccountShell></div>);
    }
    if (!user) {
        return (<AccountShell title="Trade Journal"><AuthRequired /></AccountShell>);
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="Trade Journal" subtitle="Track and analyze your trading performance">
                <div className="space-y-4">
                    <div className="flex items-center justify-between" data-guide="page-header">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Activity size={16} />
                            {journal.length} trades recorded
                        </div>
                        <button type="button" onClick={fetchJournal} disabled={loading} className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition disabled:opacity-50">
                            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                        </button>
                    </div>

                    {loading ? (
                        <div className="flex h-32 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                    ) : journal.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border/30 p-16 text-center">
                            <BookOpen size={32} className="mx-auto text-muted-foreground" />
                            <p className="mt-3 text-sm text-muted-foreground">No trade data yet</p>
                            <p className="mt-1 text-xs text-muted-foreground">Trade signals will appear here as you execute trades</p>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto rounded-lg border border-border/30 bg-muted/50">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-border/20 text-micro uppercase text-muted-foreground">
                                            <th className="px-4 py-2.5 text-left">Symbol</th>
                                            <th className="px-4 py-2.5 text-left">Direction</th>
                                            <th className="px-4 py-2.5 text-right">Entry</th>
                                            <th className="px-4 py-2.5 text-right">SL</th>
                                            <th className="px-4 py-2.5 text-right">Result</th>
                                            <th className="px-4 py-2.5 text-right">R</th>
                                            <th className="px-4 py-2.5 text-left">Regime</th>
                                            <th className="px-4 py-2.5 text-left">Timeframe</th>
                                            <th className="px-4 py-2.5 text-right">Confidence</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {journal.map((s, i) => (
                                            <tr key={s.id || i} className="border-b border-border/10 hover:bg-muted/50">
                                                <td className="px-4 py-2.5 font-numeric font-medium text-foreground">{s.symbol}</td>
                                                <td className={cn("px-4 py-2.5 font-medium", s.direction === "BUY" ? "text-positive" : "text-negative")}>{s.direction}</td>
                                                <td className="px-4 py-2.5 text-right font-numeric text-muted-foreground">{s.entry?.toFixed(s.symbol?.includes("JPY") ? 3 : s.symbol?.includes("XAU") || s.symbol?.includes("BTC") ? 2 : 2)}</td>
                                                <td className="px-4 py-2.5 text-right font-numeric text-muted-foreground">{s.stopLoss?.toFixed(2)}</td>
                                                <td className={cn("px-4 py-2.5 font-medium", s.result === "WIN" ? "text-positive" : s.result === "LOSS" ? "text-negative" : "text-muted-foreground")}>
                                                    {s.result === "WIN" ? <TrendingUp size={12} className="inline mr-1" /> : s.result === "LOSS" ? <TrendingDown size={12} className="inline mr-1" /> : <Target size={12} className="inline mr-1" />}
                                                    {s.result}
                                                </td>
                                                <td className={cn("px-4 py-2.5 text-right font-numeric font-bold", (s.resultR || 0) >= 0 ? "text-positive" : "text-negative")}>{formatR(s.resultR)}</td>
                                                <td className="px-4 py-2.5 text-left text-muted-foreground">{s.marketRegime?.replace(/_/g, " ") || "—"}</td>
                                                <td className="px-4 py-2.5 text-left text-muted-foreground">{s.timeframe}</td>
                                                <td className="px-4 py-2.5 text-right font-numeric text-muted-foreground">{s.confidence}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-guide="stats">
                                {[
                                    { label: "Win Rate", value: `${journal.filter((s: any) => s.result === "WIN").length / Math.max(journal.length, 1) * 100}%`, color: "text-positive" },
                                    { label: "Avg R", value: `${(journal.reduce((s: number, j: any) => s + (j.resultR || 0), 0) / Math.max(journal.length, 1)).toFixed(2)}R`, color: "text-primary" },
                                    { label: "Total Trades", value: String(journal.length), color: "text-foreground" },
                                    { label: "Winners", value: String(journal.filter((s: any) => s.result === "WIN").length), color: "text-positive" },
                                ].map((m) => (
                                    <div key={m.label} className="rounded-lg border border-border/30 bg-muted/50 p-4">
                                        <span className="text-micro font-semibold uppercase text-muted-foreground">{m.label}</span>
                                        <p className={cn("mt-1 font-numeric text-lg font-bold", m.color)}>{m.value}</p>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </AccountShell>
        </div>
    );
}
