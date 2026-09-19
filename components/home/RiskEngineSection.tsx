"use client";

import { ShieldAlert, Lock, CheckCircle2, AlertOctagon, Sliders } from "lucide-react";

export default function RiskEngineSection() {
    return (
        <section className="py-20 border-b border-border/40 bg-background relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Capital Protection</p>
                    <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                        Pre-Execution Risk Engine & Rules
                    </h2>
                    <p className="mt-3 text-base text-muted-foreground">
                        AlgoVault does not simply generate signals; it enforces mandatory risk constraints before sending order commands to your MT5 terminal.
                    </p>
                </div>

                {/* Risk Control Console Preview */}
                <div className="mt-12 rounded-3xl border border-border/80 bg-card/80 p-6 md:p-8 shadow-2xl backdrop-blur-xl">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                        
                        {/* Risk Metrics Cards */}
                        <div className="lg:col-span-6 space-y-3 font-mono text-xs">
                            <div className="flex items-center justify-between rounded-xl bg-background/80 p-3.5 border border-border/40">
                                <div>
                                    <div className="font-bold text-foreground">Risk Per Trade</div>
                                    <div className="text-[10px] text-muted-foreground">Fixed % allocation per order</div>
                                </div>
                                <span className="rounded bg-violet-500/10 px-2.5 py-1 font-bold text-violet-300 border border-violet-500/20">1.0% Capital</span>
                            </div>

                            <div className="flex items-center justify-between rounded-xl bg-background/80 p-3.5 border border-border/40">
                                <div>
                                    <div className="font-bold text-foreground">Max Daily Loss Limit</div>
                                    <div className="text-[10px] text-muted-foreground">Halts new trades if breached</div>
                                </div>
                                <span className="rounded bg-rose-500/10 px-2.5 py-1 font-bold text-rose-400 border border-rose-500/20">3.0% Max Daily</span>
                            </div>

                            <div className="flex items-center justify-between rounded-xl bg-background/80 p-3.5 border border-border/40">
                                <div>
                                    <div className="font-bold text-foreground">Max Open Positions</div>
                                    <div className="text-[10px] text-muted-foreground">Prevents over-exposure</div>
                                </div>
                                <span className="rounded bg-sky-500/10 px-2.5 py-1 font-bold text-sky-400 border border-sky-500/20">2 / 5 Active</span>
                            </div>

                            <div className="flex items-center justify-between rounded-xl bg-background/80 p-3.5 border border-border/40">
                                <div>
                                    <div className="font-bold text-foreground">Symbol Exposure Limit</div>
                                    <div className="text-[10px] text-muted-foreground">Cap on single symbol lots</div>
                                </div>
                                <span className="rounded bg-emerald-500/10 px-2.5 py-1 font-bold text-emerald-400 border border-emerald-500/20">Controlled</span>
                            </div>
                        </div>

                        {/* Right Protection Features */}
                        <div className="lg:col-span-6 space-y-4 text-xs font-mono">
                            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-2">
                                <div className="flex items-center gap-2 font-bold text-emerald-400">
                                    <CheckCircle2 size={16} />
                                    <span>Mandatory Stop Loss Protection</span>
                                </div>
                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                    Any signal lacking a defined Stop Loss level is automatically flagged as invalid and rejected by the risk validator.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-2">
                                <div className="flex items-center gap-2 font-bold text-amber-400">
                                    <Sliders size={16} />
                                    <span>Automated Cooldown Window</span>
                                </div>
                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                    Enforces a 300-second execution cooldown after closed trades to prevent revenge trading or duplicate signal triggering.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 space-y-2">
                                <div className="flex items-center gap-2 font-bold text-rose-400">
                                    <AlertOctagon size={16} />
                                    <span>One-Click Emergency Circuit Breaker</span>
                                </div>
                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                    Instantly close all open gateway positions and revoke active execution tokens across connected MT5 accounts.
                                </p>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </section>
    );
}
