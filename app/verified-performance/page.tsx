"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import AccountShell from "@/components/account/AccountShell";
import {
    Shield, TrendingUp, Activity, Target, BarChart3,
    Loader2, RefreshCw, Award, Crown, TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface VerifiedData {
    totalTrades: number;
    wins: number;
    losses: number;
    tradingDays: number;
    avgReturn: number;
    maxDrawdownPct: number;
    profitFactor: number;
    expectancy: number;
    sharpeLike: number;
    consistency: { weeklyTrades: number; avgTradesPerWeek: number };
    riskMetrics: { maxDrawdown: number; maxDrawdownPct: number; profitFactor: number; expectancy: number; sharpeRatio: number };
    signalCorrelation: { totalSignals: number; signalsWithTrades: number; correlation: string };
    verifiedAt: string;
}

export default function VerifiedPerformancePage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [data, setData] = useState<VerifiedData | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchPerformance = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/verified-performance", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setData(json.verifiedPerformance);
            else setError(json.error || "Failed to load performance data");
        } catch {} finally { setLoading(false); }
    };

    useEffect(() => { if (!authLoading && user) void Promise.resolve().then(() => fetchPerformance()); }, [authLoading, user]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Verified Performance"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    }

    return (
        <AccountShell title="Verified Performance" subtitle="Audited trading performance metrics" onBack={() => router.push("/account")}>
            <div className="space-y-6" data-guide="page-header">
                {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}
                {data && (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-guide="stats">
                            <StatCard icon={<Activity className="h-5 w-5 text-emerald-400" />} label="Total Trades" value={data.totalTrades.toString()} />
                            <StatCard icon={<Target className="h-5 w-5 text-violet-400" />} label="Trading Days" value={data.tradingDays.toString()} />
                            <StatCard icon={<TrendingUp className="h-5 w-5 text-amber-400" />} label="Avg Return" value={data.avgReturn.toFixed(2)} />
                            <StatCard icon={<Shield className="h-5 w-5 text-rose-400" />} label="Max Drawdown" value={`${data.maxDrawdownPct.toFixed(1)}%`} />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <StatCard icon={<TrendingUp className="h-5 w-5 text-emerald-400" />} label="Wins" value={data.wins.toString()} />
                            <StatCard icon={<TrendingDown className="h-5 w-5 text-rose-400" />} label="Losses" value={data.losses.toString()} />
                            <StatCard icon={<BarChart3 className="h-5 w-5 text-violet-400" />} label="Profit Factor" value={data.profitFactor.toFixed(2)} />
                            <StatCard icon={<Award className="h-5 w-5 text-amber-400" />} label="Expectancy" value={`${data.expectancy.toFixed(2)}R`} />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-4 w-4" />Sharpe Ratio</div>
                                <p className="mt-2 text-2xl font-bold text-foreground">{data.sharpeLike.toFixed(2)}</p>
                            </div>
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5">
                                <div className="flex items-center gap-2 text-emerald-400"><Shield className="h-5 w-5" /><span className="text-sm font-semibold">Risk Assessment</span></div>
                                <div className="mt-3 space-y-2 text-sm">
                                    <div className="flex justify-between"><span className="text-muted-foreground">Max Drawdown</span><span className="text-foreground">{data.maxDrawdownPct.toFixed(1)}%</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Profit Factor</span><span className="text-foreground">{data.profitFactor.toFixed(2)}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Expectancy</span><span className="text-foreground">{data.expectancy.toFixed(2)}R</span></div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-5">
                                <div className="flex items-center gap-2 text-violet-400"><Target className="h-5 w-5" /><span className="text-sm font-semibold">Consistency</span></div>
                                <div className="mt-3 space-y-2 text-sm">
                                    <div className="flex justify-between"><span className="text-muted-foreground">Weekly Trades</span><span className="text-foreground">{data.consistency.weeklyTrades}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Avg/Week</span><span className="text-foreground">{data.consistency.avgTradesPerWeek.toFixed(1)}</span></div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
                                <div className="flex items-center gap-2 text-amber-400"><Crown className="h-5 w-5" /><span className="text-sm font-semibold">Signal Stats</span></div>
                                <div className="mt-3 space-y-2 text-sm">
                                    <div className="flex justify-between"><span className="text-muted-foreground">Total Signals</span><span className="text-foreground">{data.signalCorrelation.totalSignals}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">With Trades</span><span className="text-foreground">{data.signalCorrelation.signalsWithTrades}</span></div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </AccountShell>
    );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
            <p className="mt-2 text-lg font-bold text-foreground">{value}</p>
        </div>
    );
}
