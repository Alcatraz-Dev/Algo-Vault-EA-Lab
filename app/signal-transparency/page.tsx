"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import AccountShell from "@/components/account/AccountShell";
import {
    Eye, Shield, Activity, TrendingUp, Target,
    Loader2, RefreshCw, CheckCircle2,
} from "lucide-react";

interface SignalData {
    id: string;
    symbol: string;
    direction: string;
    confidence: number;
    winRate: number;
    result: string;
    resultR: number;
    marketRegime: string;
    aiModel: string;
    provider: string;
    providerAvailable: boolean;
    realTimeAnalysis: any;
    timestamp: number;
}

export default function SignalTransparencyPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const [signals, setSignals] = useState<SignalData[]>([]);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchSignals = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/signal-transparency", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setSignals(json.signals);
        } catch {} finally { setLoading(false); }
    };

    useEffect(() => { if (!authLoading && user) fetchSignals(); }, [authLoading, user]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Signal Transparency"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    }

    return (
        <AccountShell title="Signal Transparency" subtitle="Verify signal integrity and AI model accountability" onBack={() => router.push("/account")}>
            <div className="space-y-6" data-guide="page-header">
                <div className="flex items-center justify-between">
                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4">
                            <div className="flex items-center gap-2 text-emerald-400"><CheckCircle2 className="h-5 w-5" /><span className="text-xs font-semibold">Provider</span></div>
                            <p className="mt-1 text-sm font-bold text-foreground">{signals[0]?.provider || "Local"}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{signals[0]?.providerAvailable ? "Available" : "Unavailable"}</p>
                        </div>
                        <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-4">
                            <div className="flex items-center gap-2 text-violet-400"><Activity className="h-5 w-5" /><span className="text-xs font-semibold">Total Signals</span></div>
                            <p className="mt-1 text-sm font-bold text-foreground">{signals.length}</p>
                            <p className="mt-1 text-xs text-muted-foreground">Last 30 signals</p>
                        </div>
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-4">
                            <div className="flex items-center gap-2 text-amber-400"><Target className="h-5 w-5" /><span className="text-xs font-semibold">Avg Confidence</span></div>
                            <p className="mt-1 text-sm font-bold text-foreground">
                                {signals.length ? `${(signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length).toFixed(0)}%` : "N/A"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">Average confidence</p>
                        </div>
                    </div>
                    <button type="button" onClick={fetchSignals} disabled={loading} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                        {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : <RefreshCw size={16} />}
                    </button>
                </div>

                <div className="space-y-3">
                    {signals.map((signal) => (
                        <div key={signal.id} className="rounded-xl border border-border/30 bg-muted/50 p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${signal.direction === "BUY" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{signal.direction}</span>
                                    <span className="font-mono text-sm font-bold text-foreground">{signal.symbol}</span>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="text-xs text-muted-foreground">Confidence: {signal.confidence}%</span>
                                    <span className={`text-xs font-medium ${signal.result === "WIN" ? "text-emerald-400" : signal.result === "LOSS" ? "text-rose-400" : "text-muted-foreground"}`}>{signal.result} ({signal.resultR}R)</span>
                                </div>
                            </div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                <span className="text-xs text-muted-foreground">Model: <span className="text-foreground">{signal.aiModel}</span></span>
                                <span className="text-xs text-muted-foreground">Regime: <span className="text-foreground">{signal.marketRegime}</span></span>
                                <span className="text-xs text-muted-foreground">Provider: <span className="text-foreground">{signal.provider}</span></span>
                            </div>
                            {signal.realTimeAnalysis && (
                                <div className="mt-2 flex gap-4">
                                    <span className="text-xs text-muted-foreground">Real-time Score: <span className="text-foreground">{signal.realTimeAnalysis.score?.total}/100</span></span>
                                    <span className="text-xs text-muted-foreground">Volatility: <span className="text-foreground">{signal.realTimeAnalysis.volatility?.state}</span></span>
                                </div>
                            )}
                        </div>
                    ))}
                    {!signals.length && !loading && <div className="rounded-xl border border-dashed border-border/30 p-8 text-center"><Eye className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">No signals to display</p></div>}
                </div>
            </div>
        </AccountShell>
    );
}
