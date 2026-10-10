"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import {
    Brain, MessageSquare, Sparkles, Activity,
    TrendingUp, Shield, Wallet, Clock, Globe,
    Loader2, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { AuthRequired } from "@/components/ui/auth-required";

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
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="AI Trading Copilot" subtitle="Ask about your market, account, and strategies"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></AccountShell></div>);
    }
    if (!user) {
        return (<AccountShell title="AI Trading Copilot"><AuthRequired /></AccountShell>);
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="AI Trading Copilot" subtitle="Real-time analysis powered by your platform data">
                <div className="grid gap-6 lg:grid-cols-3" data-guide="page-header">
                    <div className="lg:col-span-2 space-y-6">
                        {/* Quick Questions */}
                        <div className="rounded-lg border border-border bg-card p-5">
                            <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><Sparkles size={16} className="text-primary" />Quick Questions</h3>
                            <div className="flex flex-wrap gap-2">
                                {quickQuestions.map((q) => (
                                    <button key={q} type="button" onClick={() => { setQuestion(q); }} className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary transition">{q}</button>
                                ))}
                            </div>
                        </div>

                        {/* Chat Input */}
                        <div className="rounded-lg border border-border bg-card p-5">
                            <div className="flex gap-3">
                                <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about market regime, account risk, trade performance, strategy recommendations..." className="flex-1 rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:outline-none" onKeyDown={(e) => e.key === "Enter" && handleAsk()} />
                                <button type="button" onClick={handleAsk} disabled={loading || !question.trim()} className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50">
                                    {loading ? <Loader2 size={16} className="animate-spin" /> : <MessageSquare size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Responses */}
                        {Object.keys(responses).length > 0 && (
                            <div className="space-y-4">
                                {Object.entries(responses).map(([key, text]) => (
                                    <div key={key} className="rounded-lg border border-positive/30 bg-positive/10 p-5">
                                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-positive"><Activity size={14} />{key.replace(/_/g, " ").toUpperCase()}</div>
                                        <p className="text-sm text-muted-foreground whitespace-pre-line">{text}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* TradingView external evidence (separate, provenance-preserved) */}
                        {copilotData?.tradingview && (
                            <div className="rounded-lg border border-info/30 bg-info/10 p-5">
                                <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-info"><Globe size={14} />TRADINGVIEW EVIDENCE <span className="rounded-full bg-info/10 px-1.5 py-0.5 text-micro font-medium">BETA · MAY BE DELAYED</span></div>
                                <p className="mb-3 text-micro text-muted-foreground">External context from the TradingView MCP provider — kept separate from AlgoVault evidence.</p>
                                <div className="grid gap-2">
                                    {[copilotData.tradingview.technicals, copilotData.tradingview.news, copilotData.tradingview.economicCalendar].map((section: any, i: number) => (
                                        <div key={i} className="rounded-lg bg-muted/50 p-3">
                                            <div className="flex items-center justify-between">
                                                <span className="text-micro font-semibold text-foreground">{{ 0: "Technical snapshot", 1: "News", 2: "Economic calendar" }[i]}</span>
                                                <span className={cn("rounded-full px-1.5 py-0.5 text-micro", section?.state === "CONNECTED" ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground")}>{section?.state ?? "UNAVAILABLE"}</span>
                                            </div>
                                            {section?.available ? (
                                                <p className="mt-1 whitespace-pre-line text-micro text-muted-foreground">{section.items?.[0]?.value}</p>
                                            ) : (
                                                <p className="mt-1 text-micro text-muted-foreground">{section?.message || "Not available."}</p>
                                            )}
                                            {section?.available && section.items?.[0]?.freshnessLabel ? (
                                                <p className="mt-1 text-micro text-muted-foreground">Freshness: {section.items[0].freshnessLabel}</p>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                                {copilotData.tradingview.limitations?.length > 0 && (
                                    <div className="mt-3 border-t border-border pt-2">
                                        <p className="text-micro font-semibold uppercase tracking-wide text-warning/70">Limitations</p>
                                        <ul className="mt-1 list-inside list-disc text-micro text-muted-foreground">
                                            {copilotData.tradingview.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Market Data Summary */}
                        {Object.keys(marketData).length > 0 && (
                            <div className="rounded-lg border border-border bg-card p-5">
                                <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><TrendingUp size={16} className="text-primary" />Market Snapshot</h3>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {Object.entries(marketData).map(([sym, data]: [string, any]) => (
                                        <div key={sym} className="rounded-lg bg-muted/50 p-3">
                                            <div className="flex items-center justify-between">
                                                <span className="font-numeric text-sm font-bold text-foreground">{sym}</span>
                                                <span className={cn("rounded-full px-2 py-0.5 text-micro font-medium", data.error ? "bg-negative/10 text-negative" : data.bias === "bullish" ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative")}>{data.error ? "N/A" : data.bias}</span>
                                            </div>
                                            {data.error ? (
                                                <p className="mt-1 text-xs text-muted-foreground">Data unavailable</p>
                                            ) : (
                                                <div className="mt-2 grid grid-cols-2 gap-2 text-micro">
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
                            <div className="rounded-lg border border-border bg-card p-5">
                                <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2"><Activity size={16} className="text-primary" />Account Status</h3>
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-muted-foreground">MT5 Accounts</span><span className="text-foreground font-numeric">{copilotData.accounts}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Open Positions</span><span className="text-foreground font-numeric">{copilotData.positions}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Recent Signals</span><span className="text-foreground font-numeric">{copilotData.recentSignals}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Subscription</span><span className={cn("font-medium", copilotData.isPro ? "text-positive" : "text-muted-foreground")}>{copilotData.isPro ? "PRO" : "FREE"}</span></div>
                                </div>
                            </div>
                        )}

                        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-micro text-warning-foreground">
                            <Shield size={12} className="mr-1 inline" />
                            AI Copilot uses real platform data. All analysis is based on your actual signals, positions, and market conditions. Not financial advice.
                        </div>
                    </div>
                </div>
            </AccountShell>
        </div>
    );
}
