"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import AccountShell from "@/components/account/AccountShell";
import {
    Activity, Brain, BarChart3, TrendingUp, Shield,
    Loader2, Target, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface HistoryEntry {
    period: string;
    avgReturn: number;
    high: number;
    low: number;
    regime: string;
}

export default function AIHistoricalPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const [symbol, setSymbol] = useState("XAUUSD");
    const [timeframe, setTimeframe] = useState("H1");
    const [data, setData] = useState<{
        regime: any; volatility: any; volume: any; vwap: any;
        liquidity: any; structure: any; score: any;
        aiSummary: string; history: HistoryEntry[];
    } | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchAnalysis = async () => {
        if (!user) return;
        setLoading(true);
        setError("");
        try {
            const token = await user.getIdToken();
            const res = await fetch(`/api/ai-historical?symbol=${symbol}&timeframe=${timeframe}`, { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setData(json);
            else setError(json.error || "Analysis failed");
        } catch { setError("Failed to fetch analysis"); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (!authLoading && user) void Promise.resolve().then(() => fetchAnalysis()); }, [authLoading, user]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="AI Historical Analysis"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    }

    return (
        <AccountShell title="AI Historical Analysis" subtitle="Deep historical market data analysis powered by AI" onBack={() => router.push("/account")}>
            <div className="space-y-6" data-guide="page-header">
                <div className="flex flex-wrap gap-3">
                    <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="rounded-lg border border-border/30 bg-muted px-3 py-2 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                        <option value="XAUUSD">XAUUSD</option>
                        <option value="EURUSD">EURUSD</option>
                        <option value="GBPUSD">GBPUSD</option>
                        <option value="USDJPY">USDJPY</option>
                        <option value="BTCUSD">BTCUSD</option>
                    </select>
                    <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="rounded-lg border border-border/30 bg-muted px-3 py-2 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                        <option value="M15">M15</option>
                        <option value="H1">H1</option>
                        <option value="H4">H4</option>
                        <option value="D1">D1</option>
                    </select>
                    <button type="button" onClick={fetchAnalysis} disabled={loading} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                        {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Analyze"}
                    </button>
                </div>

                {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}

                {data && (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <StatCard icon={<Activity className="h-5 w-5 text-violet-400" />} label="Regime" value={data.regime.regime} />
                            <StatCard icon={<Shield className="h-5 w-5 text-emerald-400" />} label="Confidence" value={`${data.regime.confidence}%`} />
                            <StatCard icon={<Zap className="h-5 w-5 text-amber-400" />} label="Volatility" value={data.volatility.state} />
                            <StatCard icon={<Target className="h-5 w-5 text-sky-400" />} label="Market Score" value={`${data.score.total}/100`} />
                        </div>

                        <div className="grid gap-6 lg:grid-cols-2">
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-6">
                                <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><Brain className="h-4 w-4 text-violet-400" />AI Summary</h3>
                                <p className="text-sm text-muted-foreground whitespace-pre-line">{data.aiSummary}</p>
                            </div>
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-6">
                                <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><BarChart3 className="h-4 w-4 text-emerald-400" />Structure Analysis</h3>
                                <p className="text-sm text-muted-foreground">Bias: <span className="text-foreground font-medium">{data.structure.bias}</span></p>
                                <p className="mt-2 text-sm text-muted-foreground">Swing Levels: {data.structure.levels}</p>
                                <p className="mt-1 text-sm text-muted-foreground">BOS/CHoCH Events: {data.structure.blocks}</p>
                            </div>
                        </div>

                        <div className="rounded-xl border border-border/30 bg-muted/50 p-6">
                            <h3 className="mb-4 text-sm font-semibold text-foreground flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-400" />Historical Performance</h3>
                            <div className="space-y-2">
                                {data.history?.slice(-15).map((entry, i) => (
                                    <div key={i} className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2">
                                        <span className="text-xs text-muted-foreground">{entry.period}</span>
                                        <span className={cn("text-xs font-medium", entry.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{((entry.avgReturn || 0) * 100).toFixed(2)}%</span>
                                        <span className="text-xs text-muted-foreground">{entry.regime}</span>
                                    </div>
                                ))}
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
        <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
            <p className="mt-2 text-lg font-bold text-foreground">{value}</p>
        </div>
    );
}
