"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import {
    Sparkles, Brain, Activity, TrendingUp, Shield,
    Loader2, BarChart3, Clock, Target, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
    { id: "market", label: "Market Insight", icon: Activity, description: "Current market regime, volatility, and trend analysis" },
    { id: "account", label: "Account Insight", icon: Shield, description: "Your account health, risk exposure, and drawdown analysis" },
    { id: "strategy", label: "Strategy Insight", icon: TrendingUp, description: "Which strategies are performing best in current conditions" },
    { id: "signal", label: "Signal Insight", icon: Target, description: "Signal performance, win rates, and quality trends" },
    { id: "trade", label: "Trade Insight", icon: Clock, description: "Your trading patterns, behavioral analysis, and timing" },
    { id: "risk", label: "Risk Insight", icon: Shield, description: "Position sizing recommendations and correlation warnings" },
];

export default function AIInsightsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [insights, setInsights] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [activeSection, setActiveSection] = useState("market");
    const [generatedAt, setGeneratedAt] = useState<number>(0);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const generateInsight = async (section: string) => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/ai-copilot", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ question: `Generate ${section} insight` }),
            });
            const data = await res.json();
            if (data.responses[section + "_insight"]) {
                setInsights((prev) => ({ ...prev, [section]: data.responses[section + "_insight"] }));
            }
        } catch {}
        finally { setLoading(false); }
    };

    const generateAll = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/ai-copilot", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ question: "Give me a comprehensive overview of my trading situation" }),
            });
            const data = await res.json();
            setInsights((prev) => ({ ...prev, overview: data.responses?.overview || "" }));
            setGeneratedAt(Date.now());
        } catch {}
        finally { setLoading(false); }
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><AccountShell title="AI Insights Center"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    }
    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><AccountShell title="AI Insights Center"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Brain size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1></div></AccountShell></div>);
    }

    return (
        <div className="min-h-screen bg-background">
            <AccountShell title="AI Insights Center" subtitle="Unified intelligence across market, account, and strategy">
                <div className="grid gap-6 lg:grid-cols-3" data-guide="page-header">
                    <div className="lg:col-span-2 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Brain size={20} className="text-violet-400" />
                                <h2 className="text-lg font-bold text-foreground">Insights</h2>
                                {generatedAt > 0 && <span className="text-[10px] text-muted-foreground">Last: {new Date(generatedAt).toLocaleTimeString()}</span>}
                            </div>
                            <button type="button" onClick={generateAll} disabled={loading} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                                {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate All Insights
                            </button>
                        </div>

                        {insights.overview && (
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5">
                                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-400"><Sparkles size={14} />Comprehensive Overview</div>
                                <p className="text-sm text-muted-foreground whitespace-pre-line">{insights.overview}</p>
                            </div>
                        )}

                        <div className="space-y-2">
                            {SECTIONS.map((section) => (
                                <button key={section.id} type="button" onClick={() => { setActiveSection(section.id); generateInsight(section.id); }} className={cn("flex w-full items-center gap-4 rounded-xl border p-4 text-left transition", activeSection === section.id ? "border-violet-500/30 bg-violet-500/[0.03]" : "border-border/30 bg-muted/50 hover:bg-muted")}>
                                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", activeSection === section.id ? "bg-violet-500/10" : "bg-muted")}>
                                        <section.icon size={18} className={activeSection === section.id ? "text-violet-400" : "text-muted-foreground"} />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-foreground">{section.label}</p>
                                        <p className="text-[10px] text-muted-foreground">{section.description}</p>
                                    </div>
                                    {loading && activeSection === section.id && <Loader2 size={14} className="animate-spin text-violet-400" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                            <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><Layers size={16} className="text-violet-400" />Active Sections</h3>
                            <div className="space-y-2">
                                {SECTIONS.map((s) => (
                                    <div key={s.id} className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs", activeSection === s.id ? "bg-violet-500/10 text-violet-400" : "text-muted-foreground")}>
                                        {activeSection === s.id ? <div className="h-1.5 w-1.5 rounded-full bg-violet-400" /> : <div className="h-1.5 w-1.5 rounded-full bg-muted" />}
                                        {s.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-4 text-[11px] text-amber-400/60">
                            <Brain size={12} className="mr-1 inline" />
                            All insights are generated from your real platform data. AI outputs are analytical estimates, not financial advice.
                        </div>
                    </div>
                </div>
            </AccountShell>
        </div>
    );
}
