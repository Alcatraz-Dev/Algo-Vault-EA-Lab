"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Code2, LineChart, Bell, CheckCircle2 } from "lucide-react";

const SAMPLE_PINE_CODE = `//@version=5
indicator("AlgoVault SMC Suite", overlay=true)

// User Inputs
fastLen = input.int(12, "Fast EMA Length")
slowLen = input.int(26, "Slow EMA Length")
src = input.source(close, "Price Source")

// Built-in TA Calculations
fastEma = ta.ema(src, fastLen)
slowEma = ta.ema(src, slowLen)
bullishCross = ta.crossover(fastEma, slowEma)

// Plotting Output
plot(fastEma, "Fast EMA", color=color.rgb(34, 211, 238), linewidth=2)
plot(slowEma, "Slow EMA", color=color.rgb(168, 85, 247), linewidth=2)
plotshape(bullishCross, title="Buy Signal", style=shape.triangleup, location=location.belowbar, color=color.green)

alertcondition(bullishCross, title="EMA Crossover Alert", message="Bullish crossover detected")`;

export default function PineWorkspaceSection() {
    return (
        <section className="py-20 border-b border-border/40 bg-card/20 relative">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Visual Code Studio</p>
                        <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                            TradingView Pine Script v5 Studio
                        </h2>
                        <p className="mt-3 text-base text-muted-foreground max-w-2xl">
                            Write, edit, and execute Pine Script v5 indicators, strategy backtests, and custom alert conditions natively in your browser.
                        </p>
                    </div>
                    <Link
                        href="/account/tradingview"
                        className="mt-4 md:mt-0 inline-flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300 transition"
                    >
                        Launch Pine Studio <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Editor & Chart Split Preview Container */}
                <div className="mt-12 rounded-3xl border border-border/80 bg-card/80 p-6 shadow-2xl backdrop-blur-xl">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                        
                        {/* Left Code Editor Preview */}
                        <div className="lg:col-span-6 rounded-2xl border border-border/60 bg-background/90 p-4 font-mono text-xs flex flex-col justify-between">
                            <div className="flex items-center justify-between border-b border-border/40 pb-2 text-muted-foreground">
                                <span className="flex items-center gap-1.5 font-bold text-foreground"><Code2 size={14} className="text-violet-400" /> Pine v5 Editor</span>
                                <span className="text-[10px] bg-violet-500/10 text-violet-300 px-2 py-0.5 rounded border border-violet-500/20">Pine v5 Interpreter Active</span>
                            </div>
                            <pre className="my-3 text-[11px] text-muted-foreground leading-relaxed overflow-x-auto no-scrollbar font-mono">
                                <code>{SAMPLE_PINE_CODE}</code>
                            </pre>
                            <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[10px] text-muted-foreground">
                                <span>Supported: `indicator()`, `strategy()`, `ta.*`, `plot()`, `alertcondition()`</span>
                                <span className="text-emerald-400 font-bold">0 Errors</span>
                            </div>
                        </div>

                        {/* Right Chart & Alert Output Preview */}
                        <div className="lg:col-span-6 rounded-2xl border border-border/60 bg-background/90 p-4 font-mono text-xs space-y-4 flex flex-col justify-between">
                            <div className="flex items-center justify-between border-b border-border/40 pb-2 text-muted-foreground">
                                <span className="flex items-center gap-1.5 font-bold text-foreground"><LineChart size={14} className="text-sky-400" /> Rendered Chart Overlay</span>
                                <span className="text-emerald-400 font-bold">Execution Time: 4ms</span>
                            </div>

                            <div className="h-44 rounded-xl bg-gradient-to-r from-violet-500/10 via-sky-500/10 to-emerald-500/10 border border-dashed border-border/60 p-4 flex flex-col justify-between">
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-sky-400">Fast EMA (12): 2,654.40</span>
                                    <span className="text-violet-400">Slow EMA (26): 2,648.10</span>
                                </div>
                                <div className="my-auto text-center text-emerald-400 font-bold text-xs bg-emerald-500/10 py-1.5 rounded border border-emerald-500/20">
                                    ▲ Bullish Crossover Signal Triggered @ 2,650.10
                                </div>
                                <div className="flex justify-between text-[10px] text-muted-foreground">
                                    <span>Plots: 2 Lines</span>
                                    <span>Shapes: 1 Triangle Up</span>
                                    <span>Alerts: 1 Active</span>
                                </div>
                            </div>

                            <div className="rounded-xl bg-muted/40 p-3 border border-border/40 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Bell size={15} className="text-amber-400 shrink-0" />
                                    <span>Alert Target: Webhook & Telegram Dispatch</span>
                                </div>
                                <span className="text-emerald-400 font-bold text-[10px]">ENABLED</span>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </section>
    );
}
