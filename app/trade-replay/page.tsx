"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import MarketReplay from "@/components/tradingview/MarketReplay";
import { Loader2, Clock, Gauge, Sparkles, Filter, Search, CheckCircle2, XCircle, TrendingUp, TrendingDown, RefreshCw, BarChart2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

export default function TradeReplayPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<"terminal" | "signals">("terminal");
    const [signals, setSignals] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);

    // Signal Filters
    const [searchQuery, setSearchQuery] = useState("");
    const [resultFilter, setResultFilter] = useState<"ALL" | "WIN" | "LOSS">("ALL");

    useEffect(() => { 
        const unsub = onAuthStateChanged(auth, (u) => { 
            setUser(u); 
            setAuthLoading(false); 
        }); 
        return () => unsub(); 
    }, []);

    useEffect(() => {
        if (!authLoading && user) {
            const fetchData = async () => {
                setLoading(true);
                try {
                    const token = await user.getIdToken();
                    const res = await fetch("/api/ai-signals", { headers: { Authorization: `Bearer ${token}` } });
                    const d = await res.json();
                    if (d.signals) {
                        const completed = d.signals
                            .filter((s: any) => s.result && s.result !== "PENDING")
                            .sort((a: any, b: any) => a.createdAt - b.createdAt);
                        setSignals(completed.slice(-100));
                        setCurrentIndex(completed.length > 0 ? 0 : -1);
                    }
                } catch {}
                finally { setLoading(false); }
            };
            fetchData();
        }
    }, [authLoading, user]);

    if (authLoading) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <AccountShell title="Trade Replay Studio">
                    <div className="flex flex-1 items-center justify-center min-h-[400px]">
                        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                    </div>
                </AccountShell>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <AccountShell title="Trade Replay Studio">
                    <div className="flex flex-1 flex-col items-center justify-center gap-4 min-h-[400px]">
                        <Clock size={40} className="text-muted-foreground" />
                        <h1 className="text-xl font-semibold text-foreground">Sign in required to access Replay Studio</h1>
                    </div>
                </AccountShell>
            </div>
        );
    }

    // Filtered signals logic
    const filteredSignals = signals.filter((s) => {
        const matchesQuery = searchQuery === "" || s.symbol.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesResult = resultFilter === "ALL" || s.result === resultFilter;
        return matchesQuery && matchesResult;
    });

    const currentSignal = filteredSignals[currentIndex] || filteredSignals[0] || null;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <AccountShell title="Market Replay & Simulation Studio" subtitle="TradingView-grade bar-by-bar market replay, cut-point selection, paper execution & signal validation">
                <div className="space-y-6">
                    
                    {/* Header Studio Controls */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/40 pb-4">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveTab("terminal")}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-sm",
                                    activeTab === "terminal"
                                        ? "bg-violet-600 text-white shadow-violet-600/25"
                                        : "bg-muted/50 text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Gauge size={15} /> TradingView Replay Terminal
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("signals")}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-sm",
                                    activeTab === "signals"
                                        ? "bg-violet-600 text-white shadow-violet-600/25"
                                        : "bg-muted/50 text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Sparkles size={15} /> AI Signal Historical Replay ({signals.length})
                            </button>
                        </div>
                    </div>

                    {/* Tab 1: Full TradingView Market Replay Terminal */}
                    {activeTab === "terminal" && (
                        <div className="space-y-4">
                            <MarketReplay 
                                studies={["MASimple@tv-basicstudies", "MAExp@tv-basicstudies", "BB@tv-basicstudies", "RSI@tv-basicstudies"]}
                                strategyType="strategy"
                            />
                        </div>
                    )}

                    {/* Tab 2: Historical AI Signal Replay Timeline */}
                    {activeTab === "signals" && (
                        <div className="space-y-6">
                            
                            {/* Filters Bar */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card/80 p-3.5 backdrop-blur-xl">
                                <div className="flex items-center gap-2 relative flex-1">
                                    <Search size={15} className="absolute left-3 text-muted-foreground" />
                                    <input
                                        type="text"
                                        placeholder="Search by symbol (e.g. XAUUSD, EURUSD)..."
                                        value={searchQuery}
                                        onChange={(e) => { setSearchQuery(e.target.value); setCurrentIndex(0); }}
                                        className="w-full rounded-xl border border-border bg-background pl-9 pr-3 py-1.5 text-xs outline-none focus:border-violet-500 font-mono"
                                    />
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-muted-foreground flex items-center gap-1"><Filter size={13} /> Filter:</span>
                                    {(["ALL", "WIN", "LOSS"] as const).map((res) => (
                                        <button
                                            key={res}
                                            type="button"
                                            onClick={() => { setResultFilter(res); setCurrentIndex(0); }}
                                            className={cn(
                                                "px-3 py-1.5 rounded-xl text-xs font-bold transition",
                                                resultFilter === res 
                                                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" 
                                                    : "bg-muted/40 text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            {res}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Active Selected Signal Replay Panel */}
                            {currentSignal ? (
                                <div className="rounded-2xl border border-border/80 bg-card/90 p-6 shadow-xl space-y-5">
                                    
                                    {/* Signal Details Strip */}
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-5">
                                        <div className="flex items-center gap-4">
                                            <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-bold shadow-sm shrink-0", currentSignal.direction === "BUY" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/15 text-rose-400 border border-rose-500/30")}>
                                                {currentSignal.direction === "BUY" ? "▲" : "▼"}
                                            </div>
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-mono text-2xl font-extrabold text-foreground">{currentSignal.symbol}</span>
                                                    <span className={cn("rounded-lg px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider", currentSignal.direction === "BUY" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20")}>{currentSignal.direction}</span>
                                                    <span className="rounded-lg bg-muted px-2.5 py-0.5 text-xs text-muted-foreground font-mono">{currentSignal.timeframe}</span>
                                                    <span className={cn("rounded-lg px-2.5 py-0.5 text-xs font-bold", currentSignal.result === "WIN" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/20 text-rose-300 border border-rose-500/30")}>{currentSignal.result}</span>
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-mono text-muted-foreground">
                                                    <span>Entry: <strong className="text-foreground">${currentSignal.entry?.toFixed(2)}</strong></span>
                                                    <span>Stop Loss: <strong className="text-rose-400">${currentSignal.stopLoss?.toFixed(2)}</strong></span>
                                                    <span>Take Profit: <strong className="text-emerald-400">${currentSignal.tp1?.toFixed(2)}</strong></span>
                                                    <span>Return: <strong className="text-violet-400">+{currentSignal.resultR?.toFixed(2)}R</strong></span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="text-right font-mono text-xs text-muted-foreground">
                                            <span>Signal #{currentIndex + 1} of {filteredSignals.length}</span>
                                            <div className="text-[11px] text-muted-foreground/70 mt-1">
                                                Triggered: {currentSignal.createdAt ? new Date(currentSignal.createdAt).toLocaleDateString() : "Historical"}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Timeline Slider with Color-coded Wins / Losses */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                                            <span>Signal Timeline Scrubber</span>
                                            <span>Select bar to load replay context</span>
                                        </div>
                                        <div className="flex h-5 items-center gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1">
                                            {filteredSignals.map((s, i) => (
                                                <div 
                                                    key={i} 
                                                    className={cn(
                                                        "h-full rounded-md transition-all cursor-pointer min-w-[6px]", 
                                                        i === currentIndex ? "ring-2 ring-violet-500 scale-110 z-10" : "opacity-80 hover:opacity-100",
                                                        s.result === "WIN" ? "bg-emerald-500" : "bg-rose-500"
                                                    )} 
                                                    style={{ flex: 1 }} 
                                                    onClick={() => setCurrentIndex(i)} 
                                                    title={`${s.symbol} ${s.direction} (${s.result})`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center text-muted-foreground font-mono text-xs">
                                    No completed historical signals match the filter criteria.
                                </div>
                            )}

                            {/* Embedded TradingView Chart for Replaying Selected Signal Market Action */}
                            <MarketReplay 
                                studies={["MASimple@tv-basicstudies", "BB@tv-basicstudies"]}
                                strategyType="indicator"
                            />
                        </div>
                    )}
                </div>
            </AccountShell>
        </div>
    );
}
