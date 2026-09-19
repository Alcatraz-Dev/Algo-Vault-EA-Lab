"use client";

import { Brain, Sliders, CheckCircle2, ShieldAlert, Cpu } from "lucide-react";

export default function AIOptimizationSection() {
    return (
        <section className="py-20 border-b border-border/40 bg-background relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Hybrid Intelligence</p>
                    <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                        AI-Assisted Optimization & Robustness Scoring
                    </h2>
                    <p className="mt-3 text-base text-muted-foreground">
                        AI models provide natural language strategy narratives and pattern hypothesis, while deterministic backtest engines execute out-of-sample and Monte Carlo verification.
                    </p>
                </div>

                {/* Workflow Cards */}
                <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-12 items-center">
                    
                    {/* Left Optimization Pipeline Visual */}
                    <div className="lg:col-span-6 rounded-3xl border border-border/80 bg-card/80 p-6 shadow-2xl backdrop-blur-xl space-y-4">
                        <div className="flex items-center justify-between border-b border-border/40 pb-3 text-xs font-mono">
                            <span className="font-bold text-foreground flex items-center gap-1.5"><Cpu size={14} className="text-violet-400" /> Parameter Grid Search (240 Candidates)</span>
                            <span className="text-emerald-400 font-bold">Grade A (Score: 84)</span>
                        </div>

                        <div className="space-y-2 font-mono text-xs">
                            <div className="flex items-center justify-between rounded-xl bg-background/80 p-3 border border-border/40">
                                <span>1. Parameter Sampling</span>
                                <span className="text-muted-foreground">SL ATR: [1.2 - 2.5] | TP R: [1.5 - 3.5]</span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl bg-background/80 p-3 border border-border/40">
                                <span>2. Deterministic Backtest Pass</span>
                                <span className="text-emerald-400 font-bold">240 Iterations Complete</span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl bg-background/80 p-3 border border-border/40">
                                <span>3. Out-Of-Sample Split</span>
                                <span className="text-sky-400 font-bold">Degradation: &lt; 4.2%</span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl bg-background/80 p-3 border border-border/40">
                                <span>4. Walk-Forward Windows</span>
                                <span className="text-emerald-400 font-bold">Stable Across 6 Months</span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl bg-background/80 p-3 border border-border/40">
                                <span>5. Monte Carlo Shuffling</span>
                                <span className="text-violet-400 font-bold">95% Confidence Pass</span>
                            </div>
                        </div>
                    </div>

                    {/* Right AI Narrative & Separation Callout */}
                    <div className="lg:col-span-6 space-y-6">
                        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-6 backdrop-blur-xl space-y-3 text-xs">
                            <div className="flex items-center gap-2 font-bold text-violet-300">
                                <Brain size={18} className="text-violet-400" />
                                <span>AI Assistant Narrative Layer</span>
                            </div>
                            <p className="text-muted-foreground leading-relaxed">
                                "The grid optimization identified parameter stability around 1.8x ATR SL and 2.5x R TP. Out-of-sample results show minimal degradation, confirming the setup maintains an edge under London session volatility."
                            </p>
                        </div>

                        <div className="rounded-2xl border border-border/60 bg-card/60 p-6 space-y-3 text-xs">
                            <div className="flex items-center gap-2 font-bold text-foreground">
                                <ShieldAlert size={16} className="text-amber-400" />
                                <span>Deterministic Verification Standard</span>
                            </div>
                            <p className="text-muted-foreground leading-relaxed">
                                AlgoVault enforces a clear boundary: LLMs write descriptions and suggest hypotheses, while strict mathematical engines run every backtest. We never present fabricated LLM output as real trading performance.
                            </p>
                        </div>
                    </div>

                </div>

            </div>
        </section>
    );
}
