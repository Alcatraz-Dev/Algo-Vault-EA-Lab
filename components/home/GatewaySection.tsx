"use client";

import { Activity, ShieldCheck, Terminal, Cpu, ArrowRight, Download } from "lucide-react";
import Link from "next/link";

export default function GatewaySection() {
    return (
        <section className="py-20 border-b border-border/40 bg-card/20 relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Execution Bridge</p>
                        <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                            AlgoVault MT5 Trading Gateway
                        </h2>
                        <p className="mt-3 text-base text-muted-foreground max-w-2xl">
                            High-frequency HTTP REST bridge connecting web platform intelligence directly to MetaTrader 4 and 5 terminals via custom MQL5 Expert Advisors.
                        </p>
                    </div>
                    <Link
                        href="/account/trading-access"
                        className="mt-4 md:mt-0 inline-flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300 transition"
                    >
                        Configure Gateway Tokens <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Gateway Architecture Visual */}
                <div className="mt-12 rounded-3xl border border-border/80 bg-card/80 p-6 md:p-8 shadow-2xl backdrop-blur-xl">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                        
                        {/* Flow Diagram */}
                        <div className="lg:col-span-7 space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 font-mono text-xs text-center">
                                <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4 space-y-1">
                                    <span className="text-[10px] text-violet-400 font-bold">SOURCE</span>
                                    <div className="font-bold text-foreground">AlgoVault Web</div>
                                    <div className="text-[10px] text-muted-foreground">Order Intelligence</div>
                                </div>
                                <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 space-y-1">
                                    <span className="text-[10px] text-sky-400 font-bold">REST API</span>
                                    <div className="font-bold text-foreground">Trading Gateway</div>
                                    <div className="text-[10px] text-muted-foreground">Bearer Token Auth</div>
                                </div>
                                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-1">
                                    <span className="text-[10px] text-emerald-400 font-bold">TERMINAL</span>
                                    <div className="font-bold text-foreground">MetaTrader 5</div>
                                    <div className="text-[10px] text-muted-foreground">MQL5 EA Bridge</div>
                                </div>
                                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-1">
                                    <span className="text-[10px] text-amber-400 font-bold">BROKER</span>
                                    <div className="font-bold text-foreground">Live Execution</div>
                                    <div className="text-[10px] text-muted-foreground">Direct Liquidity</div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-border/60 bg-background/80 p-5 font-mono text-xs space-y-2">
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Gateway Architecture</span>
                                    <span className="text-emerald-400 font-bold">Single Unified Protocol</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Authentication</span>
                                    <span className="text-sky-400 font-bold">HMAC Token Exchange</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Heartbeat Interval</span>
                                    <span className="text-foreground">5,000 ms</span>
                                </div>
                            </div>
                        </div>

                        {/* Right MQL5 Source Code Box */}
                        <div className="lg:col-span-5 rounded-2xl border border-border/60 bg-background/90 p-5 font-mono text-xs space-y-3">
                            <div className="flex items-center justify-between border-b border-border/40 pb-2 text-muted-foreground">
                                <span className="flex items-center gap-1.5 font-bold text-foreground"><Terminal size={14} className="text-emerald-400" /> MQL5 EA Bridge Code</span>
                                <span className="text-[10px] text-emerald-400 font-bold">MQL5 Source Available</span>
                            </div>
                            <div className="p-3 rounded-xl bg-muted/40 text-[11px] text-muted-foreground space-y-1.5 overflow-x-auto no-scrollbar">
                                <div>// AlgoVaultTradeGateway.mq5</div>
                                <div>#include &lt;Trade\Trade.mqh&gt;</div>
                                <div>input string GatewayToken = "ag_live_...";</div>
                                <div>void OnTimer() &#123;</div>
                                <div className="pl-4">WebRequest("GET", "https://.../commands");</div>
                                <div className="pl-4">ExecutePendingOrders();</div>
                                <div>&#125;</div>
                            </div>
                            <div className="pt-2 flex items-center justify-between text-[11px]">
                                <span className="text-muted-foreground">Compatible with MT4 & MT5 terminals.</span>
                                <Link href="/account/trading-access" className="flex items-center gap-1 text-violet-400 font-bold hover:underline">
                                    <Download size={12} /> Download EA
                                </Link>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </section>
    );
}
