"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Layers, Target, TrendingUp, Sliders, ChevronRight } from "lucide-react";

export default function StrategyIntelligenceSection() {
    const [activePattern, setActivePattern] = useState<"sweep" | "fvg" | "ob">("sweep");

    return (
        <section className="py-20 border-b border-border/40 bg-card/20 relative">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Title */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Strategy Lab</p>
                        <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                            Pattern Recognition & Structural Edges
                        </h2>
                        <p className="mt-3 text-base text-muted-foreground max-w-2xl">
                            Automatically detect institutional liquidity sweeps, Fair Value Gaps, and order block reactions across multiple timeframes.
                        </p>
                    </div>
                    <Link
                        href="/strategy-lab"
                        className="mt-4 md:mt-0 inline-flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300 transition"
                    >
                        Launch Strategy Discovery <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Main Visual Node Diagram */}
                <div className="mt-12 rounded-3xl border border-border/80 bg-card/80 p-6 md:p-8 shadow-2xl backdrop-blur-xl">
                    
                    {/* Top Flow Pipeline Diagram */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 pb-8 border-b border-border/40 font-mono text-center text-xs">
                        {[
                            { name: "Market Data", label: "Twelve Data / Biquote" },
                            { name: "Pattern Scan", label: "2,000+ Bars" },
                            { name: "Liquidity", label: "SSL / BSL Sweeps" },
                            { name: "FVG Check", label: "Imbalance Gaps" },
                            { name: "Order Block", label: "Institutional Zone" },
                            { name: "Trend Filter", label: "H4/D1 Alignment" },
                            { name: "Rule Set", label: "Strategy Output" },
                        ].map((step, idx) => (
                            <div key={step.name} className="flex flex-col items-center rounded-xl bg-background/60 p-3 border border-border/40">
                                <span className="text-[10px] text-violet-400 font-bold">0{idx + 1}</span>
                                <span className="font-bold text-foreground mt-1">{step.name}</span>
                                <span className="text-[10px] text-muted-foreground mt-0.5">{step.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Interactive Pattern Selector */}
                    <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                        <div className="lg:col-span-5 space-y-3">
                            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Select Pattern Edge:</h3>
                            
                            <button
                                type="button"
                                onClick={() => setActivePattern("sweep")}
                                className={`w-full text-left rounded-xl p-4 border transition ${
                                    activePattern === "sweep"
                                        ? "border-violet-500 bg-violet-500/10 shadow-md"
                                        : "border-border/40 bg-background/40 hover:bg-muted"
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-sm text-foreground">Liquidity Sweep Reversal</span>
                                    <span className="text-xs font-mono text-emerald-400 font-bold">68.4% Win Rate</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                                    Triggers when sell-side or buy-side liquidity is swept beyond key swing highs/lows prior to a structural CHOCH shift.
                                </p>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActivePattern("fvg")}
                                className={`w-full text-left rounded-xl p-4 border transition ${
                                    activePattern === "fvg"
                                        ? "border-violet-500 bg-violet-500/10 shadow-md"
                                        : "border-border/40 bg-background/40 hover:bg-muted"
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-sm text-foreground">Fair Value Gap (FVG) Reaction</span>
                                    <span className="text-xs font-mono text-sky-400 font-bold">71.2% Win Rate</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                                    Detects 3-bar displacement imbalances where price returns to rebalance liquidity prior to continuation.
                                </p>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActivePattern("ob")}
                                className={`w-full text-left rounded-xl p-4 border transition ${
                                    activePattern === "ob"
                                        ? "border-violet-500 bg-violet-500/10 shadow-md"
                                        : "border-border/40 bg-background/40 hover:bg-muted"
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-sm text-foreground">Institutional Order Block</span>
                                    <span className="text-xs font-mono text-amber-400 font-bold">64.8% Win Rate</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                                    Identifies the last opposing candle prior to a high-volume displacement push.
                                </p>
                            </button>
                        </div>

                        {/* Interactive Visual Canvas Output */}
                        <div className="lg:col-span-7 rounded-2xl border border-border/60 bg-background/80 p-6 space-y-4 font-mono text-xs">
                            <div className="flex items-center justify-between border-b border-border/40 pb-3">
                                <span className="font-bold text-foreground">Rule Engine Strategy Preview</span>
                                <span className="text-violet-400">Timeframe: M15 Setup / H4 Macro</span>
                            </div>

                            {activePattern === "sweep" && (
                                <div className="space-y-3 animate-in fade-in-0 duration-200">
                                    <div className="rounded-lg bg-emerald-500/10 p-3 border border-emerald-500/20 text-emerald-400">
                                        ✓ Entry Rule: Sweep of Sell-Side Liquidity within last 3 bars
                                    </div>
                                    <div className="rounded-lg bg-sky-500/10 p-3 border border-sky-500/20 text-sky-400">
                                        ✓ Trend Filter: H4 EMA 20 &gt; EMA 50 (Bullish Macro)
                                    </div>
                                    <div className="rounded-lg bg-violet-500/10 p-3 border border-violet-500/20 text-violet-300">
                                        ✓ Risk Rule: SL 1.5x ATR below sweep low, TP 1:2.5 R/R
                                    </div>
                                </div>
                            )}

                            {activePattern === "fvg" && (
                                <div className="space-y-3 animate-in fade-in-0 duration-200">
                                    <div className="rounded-lg bg-sky-500/10 p-3 border border-sky-500/20 text-sky-400">
                                        ✓ Entry Rule: Price enters M15 Bullish FVG zone
                                    </div>
                                    <div className="rounded-lg bg-emerald-500/10 p-3 border border-emerald-500/20 text-emerald-400">
                                        ✓ Confirmation: Positive momentum on M5 timeframe
                                    </div>
                                    <div className="rounded-lg bg-violet-500/10 p-3 border border-violet-500/20 text-violet-300">
                                        ✓ Risk Rule: SL at bottom of FVG gap + 2 pips
                                    </div>
                                </div>
                            )}

                            {activePattern === "ob" && (
                                <div className="space-y-3 animate-in fade-in-0 duration-200">
                                    <div className="rounded-lg bg-amber-500/10 p-3 border border-amber-500/20 text-amber-400">
                                        ✓ Entry Rule: Re-test of H1 Order Block Demand Zone
                                    </div>
                                    <div className="rounded-lg bg-emerald-500/10 p-3 border border-emerald-500/20 text-emerald-400">
                                        ✓ Session Filter: London & New York liquid windows
                                    </div>
                                    <div className="rounded-lg bg-violet-500/10 p-3 border border-violet-500/20 text-violet-300">
                                        ✓ Risk Rule: Max Drawdown Protection 20% cap
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                </div>

            </div>
        </section>
    );
}
