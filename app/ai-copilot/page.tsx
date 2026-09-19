"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import {
    Brain, MessageSquare, Sparkles, Activity,
    TrendingUp, Shield, Wallet, Clock,
    Loader2, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function AICopilotPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [question, setQuestion] = useState("");
    const [responses, setResponses] = useState<Record<string, string>>({});
    const [marketData, setMarketData] = useState<any>({});
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState("overview");
    const [copilotData, setCopilotData] = useState<any>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!authLoading && user) {
            let token = "";
            user.getIdToken().then((t) => { token = t; fetch("/api/ai-copilot", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).then((d) => { if (d.success) setCopilotData(d); }).catch(() => {}); });
        }
    }, [authLoading, user]);

    const handleAsk = async () => {
        if (!question.trim() || !user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/ai-copilot", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ question: question.trim() }),
            });
            const data = await res.json() as any;
            if (data.success) {
                setResponses(data.responses);
                setMarketData(data.marketData || {});
            }
        } catch {}
        finally { setLoading(false); }
    };

    const quickQuestions = [
        "What's the current market regime?",
        "Is my account risk too high?",
        "Analyze my last 30 trades",
        "What strategy works best right now?",
        "Why is this signal strong?",
    ];

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="AI Trading Copilot" subtitle="Ask about your market, account, and strategies"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    }
    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="AI Trading Copilot"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><a href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground">Sign In</a></div></AccountShell></div>);
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="AI Trading Copilot" subtitle="Real-time analysis powered by your platform data">
                <div className="grid gap-6 lg:grid-cols-3" data-guide="page-header">
                    <div className="lg:col-span-2 space-y-6">
                        {/* Quick Questions */}
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                            <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><Sparkles size={16} className="text-violet-400" />Quick Questions</h3>
                            <div className="flex flex-wrap gap-2">
                                {quickQuestions.map((q) => (
                                    <button key={q} type="button" onClick={() => { setQuestion(q); }} className="rounded-lg border border-border/40 bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-violet-500/10 hover:text-violet-400 transition">{q}</button>
                                ))}
                            </div>
                        </div>

                        {/* Chat Input */}
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                            <div className="flex gap-3">
                                <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about market regime, account risk, trade performance, strategy recommendations..." className="flex-1 rounded-lg border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" onKeyDown={(e) => e.key === "Enter" && handleAsk()} />
                                <button type="button" onClick={handleAsk} disabled={loading || !question.trim()} className="rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                                    {loading ? <Loader2 size={16} className="animate-spin" /> : <MessageSquare size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Responses */}
                        {Object.keys(responses).length > 0 && (
                            <div className="space-y-4">
                                {Object.entries(responses).map(([key, text]) => (
                                    <div key={key} className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5">
                                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-400"><Activity size={14} />{key.replace(/_/g, " ").toUpperCase()}</div>
                                        <p className="text-sm text-muted-foreground whitespace-pre-line">{text}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Market Data Summary */}
                        {Object.keys(marketData).length > 0 && (
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><TrendingUp size={16} className="text-violet-400" />Market Snapshot</h3>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {Object.entries(marketData).map(([sym, data]: [string, any]) => (
                                        <div key={sym} className="rounded-lg bg-muted/50 p-3">
                                            <div className="flex items-center justify-between">
                                                <span className="font-mono text-sm font-bold text-foreground">{sym}</span>
                                                <span className={cn("rounded px-2 py-0.5 text-[10px] font-medium", data.error ? "bg-rose-500/10 text-rose-400" : data.bias === "bullish" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>{data.error ? "N/A" : data.bias}</span>
                                            </div>
                                            {data.error ? (
                                                <p className="mt-1 text-xs text-muted-foreground">Data unavailable</p>
                                            ) : (
                                                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                                                    <div><span className="text-muted-foreground">Regime:</span> <span className="text-muted-foreground">{data.regime?.regime?.replace(/_/g, " ")}</span></div>
                                                    <div><span className="text-muted-foreground">Volatility:</span> <span className="text-muted-foreground">{data.volatility?.state}</span></div>
                                                    <div><span className="text-muted-foreground">Score:</span> <span className="text-muted-foreground">{data.score?.total}</span></div>
                                                    <div><span className="text-muted-foreground">VWAP:</span> <span className="text-muted-foreground">{data.vwapPos}</span></div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-4">
                        {copilotData && (
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><Activity size={16} className="text-violet-400" />Account Status</h3>
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-muted-foreground">MT5 Accounts</span><span className="text-foreground font-mono">{copilotData.accounts}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Open Positions</span><span className="text-foreground font-mono">{copilotData.positions}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Recent Signals</span><span className="text-foreground font-mono">{copilotData.recentSignals}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Subscription</span><span className={cn("font-mono", copilotData.isPro ? "text-emerald-400" : "text-muted-foreground")}>{copilotData.isPro ? "PRO" : "FREE"}</span></div>
                                </div>
                            </div>
                        )}

                        <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-4 text-[11px] text-amber-400/60">
                            <Shield size={12} className="mr-1 inline" />
                            AI Copilot uses real platform data. All analysis is based on your actual signals, positions, and market conditions. Not financial advice.
                        </div>
                    </div>
                </div>
            </AccountShell>
        </div>
    );
}
