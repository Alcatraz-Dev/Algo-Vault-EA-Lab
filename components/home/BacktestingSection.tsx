"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, History, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function BacktestingSection() {
    const [simulatedRisk, setSimulatedRisk] = useState<number>(1.0);

    return (
        <section className="py-20 border-b border-border/40 bg-card/20 relative">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Simulation Engine</p>
                        <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                            Deterministic Strategy Backtesting
                        </h2>
                        <p className="mt-3 text-base text-muted-foreground max-w-2xl">
                            Run single-pass historical simulations with real spread, slippage, and commission models before risking live capital.
                        </p>
                    </div>
                    <Link
                        href="/backtests"
                        className="mt-4 md:mt-0 inline-flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300 transition"
                    >
                        Backtest Console <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Backtest Workspace Visual */}
                <div className="mt-12 rounded-3xl border border-border/80 bg-card/80 p-6 md:p-8 shadow-2xl backdrop-blur-xl">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                        
                        {/* Left Settings & Controls */}
                        <div className="lg:col-span-4 space-y-4 text-xs font-mono">
                            <div className="rounded-xl bg-background/80 p-4 border border-border/40 space-y-3">
                                <div className="flex items-center justify-between text-muted-foreground font-bold">
                                    <span>Simulation Config</span>
                                    <span className="text-violet-400">XAUUSD H1</span>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between"><span>Initial Capital</span><span className="font-bold text-foreground">$10,000</span></div>
                                    <div className="flex justify-between"><span>Spread (Pips)</span><span>2.0 pips</span></div>
                                    <div className="flex justify-between"><span>Slippage</span><span>1.0 pip</span></div>
                                    <div className="flex justify-between"><span>Commission</span><span>$7.00 / lot</span></div>
                                    <div className="flex justify-between items-center">
                                        <span>Risk / Trade</span>
                                        <div className="flex gap-1">
                                            {[0.5, 1.0, 2.0].map((r) => (
                                                <button
                                                    key={r}
                                                    type="button"
                                                    onClick={() => setSimulatedRisk(r)}
                                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                        simulatedRisk === r
                                                            ? "bg-violet-600 text-white"
                                                            : "bg-muted text-muted-foreground"
                                                    }`}
                                                >
                                                    {r}%
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Key Simulation Outcome Cards */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl bg-emerald-500/10 p-3.5 border border-emerald-500/20 text-center">
                                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Net Profit</div>
                                    <div className="text-lg font-extrabold text-emerald-400 mt-0.5">
                                        +${(2480 * (simulatedRisk / 1.0)).toFixed(0)}
                                    </div>
                                    <div className="text-[10px] text-emerald-500/80 font-bold">+{ (24.8 * simulatedRisk).toFixed(1) }% Return</div>
                                </div>
                                <div className="rounded-xl bg-rose-500/10 p-3.5 border border-rose-500/20 text-center">
                                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Max Drawdown</div>
                                    <div className="text-lg font-extrabold text-rose-400 mt-0.5">
                                        {(6.4 * simulatedRisk).toFixed(1)}%
                                    </div>
                                    <div className="text-[10px] text-rose-500/80 font-bold">-$${(640 * (simulatedRisk / 1.0)).toFixed(0)}</div>
                                </div>
                            </div>

                            <div className="rounded-xl bg-background/80 p-3 border border-border/40 space-y-1 text-[11px] text-muted-foreground">
                                <div className="flex justify-between"><span>Win Rate:</span><strong className="text-foreground">64.2% (142 / 221 Trades)</strong></div>
                                <div className="flex justify-between"><span>Profit Factor:</span><strong className="text-emerald-400">1.84</strong></div>
                                <div className="flex justify-between"><span>Expectancy:</span><strong className="text-sky-400">0.38 R / Trade</strong></div>
                            </div>
                        </div>

                        {/* Right Simulated SVG Equity Curve Visual */}
                        <div className="lg:col-span-8 space-y-3">
                            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                                <span className="flex items-center gap-1.5 text-foreground font-bold"><TrendingUp size={14} className="text-emerald-400" /> Simulated Equity & Growth Curve</span>
                                <span>2,000 Historical Bars</span>
                            </div>

                            <div className="relative h-64 rounded-2xl border border-border/60 bg-background/90 p-4 flex flex-col justify-between overflow-hidden">
                                <div className="absolute inset-0 bg-grid-pattern opacity-30" />
                                
                                {/* SVG Equity Curve */}
                                <svg className="w-full h-full text-emerald-400" viewBox="0 0 500 150" preserveAspectRatio="none">
                                    <defs>
                                        <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="rgb(16, 185, 129)" stopOpacity="0.3" />
                                            <stop offset="100%" stopColor="rgb(16, 185, 129)" stopOpacity="0.0" />
                                        </linearGradient>
                                    </defs>
                                    <path
                                        d="M 0,130 Q 50,110 100,115 T 200,85 T 300,60 T 400,35 T 500,15 L 500,150 L 0,150 Z"
                                        fill="url(#equityGrad)"
                                    />
                                    <path
                                        d="M 0,130 Q 50,110 100,115 T 200,85 T 300,60 T 400,35 T 500,15"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                    />
                                </svg>

                                <div className="relative z-10 flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-2 border-t border-border/30">
                                    <span>Start: $10,000.00</span>
                                    <span>Peak: $12,680.00</span>
                                    <span className="text-emerald-400 font-bold">End: ${ (10000 + 2480 * (simulatedRisk/1.0)).toLocaleString() }.00</span>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </section>
    );
}
