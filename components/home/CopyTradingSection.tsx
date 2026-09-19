"use client";

import Link from "next/link";
import { Copy, ArrowRight, Shield, CheckCircle2, Users } from "lucide-react";

export default function CopyTradingSection() {
    return (
        <section className="py-20 border-b border-border/40 bg-card/20 relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Account Mirroring</p>
                        <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                            Real-Time MT5 Copy Trading Engine
                        </h2>
                        <p className="mt-3 text-base text-muted-foreground max-w-2xl">
                            Mirror trades from verified master MT5 accounts to follower accounts in real time with individual risk multipliers.
                        </p>
                    </div>
                    <Link
                        href="/copy-trading"
                        className="mt-4 md:mt-0 inline-flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300 transition"
                    >
                        Copy Trading Marketplace <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Architecture Visual Card */}
                <div className="mt-12 rounded-3xl border border-border/80 bg-card/80 p-6 md:p-8 shadow-2xl backdrop-blur-xl">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                        
                        {/* Master -> Follower Stream Visual */}
                        <div className="lg:col-span-6 space-y-4 font-mono text-xs">
                            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                                <div className="flex justify-between items-center text-emerald-400 font-bold">
                                    <span>Master Account #49201 (XAUUSD Scalper)</span>
                                    <span className="text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded">VERIFIED MASTER</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Executing: BUY 1.00 Lot @ 2,650.10</span>
                                    <span className="text-foreground font-bold">Instant Dispatch</span>
                                </div>
                            </div>

                            <div className="flex justify-center text-violet-400">
                                <span className="text-xs uppercase font-bold tracking-widest bg-violet-500/10 px-3 py-1 rounded-full border border-violet-500/20">
                                    ↓ Risk Filters Applied ↓
                                </span>
                            </div>

                            <div className="space-y-2">
                                <div className="rounded-xl border border-border/60 bg-background/80 p-3 flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-foreground">Follower #1 (Risk: 0.5x)</div>
                                        <div className="text-[10px] text-muted-foreground">Lot Sizing: 0.50 Lots</div>
                                    </div>
                                    <span className="text-emerald-400 font-bold">MIRRORED</span>
                                </div>
                                <div className="rounded-xl border border-border/60 bg-background/80 p-3 flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-foreground">Follower #2 (Risk: 1.0x)</div>
                                        <div className="text-[10px] text-muted-foreground">Lot Sizing: 1.00 Lot</div>
                                    </div>
                                    <span className="text-emerald-400 font-bold">MIRRORED</span>
                                </div>
                            </div>
                        </div>

                        {/* Right Key Features */}
                        <div className="lg:col-span-6 space-y-4 text-xs font-mono">
                            <div className="rounded-xl border border-border/60 bg-background/80 p-4 space-y-1">
                                <span className="font-bold text-foreground flex items-center gap-1.5"><Copy size={14} className="text-violet-400" /> Sub-Second Execution Latency</span>
                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                    Direct gateway route mirrors master account orders to follower terminals within milliseconds.
                                </p>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-background/80 p-4 space-y-1">
                                <span className="font-bold text-foreground flex items-center gap-1.5"><Shield size={14} className="text-emerald-400" /> Individual Follower Protection</span>
                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                    Followers set their own max daily loss limits and equity protection caps independent of master strategy settings.
                                </p>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </section>
    );
}
