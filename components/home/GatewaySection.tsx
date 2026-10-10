"use client";

import { Terminal, ArrowRight, Download } from "lucide-react";
import Link from "next/link";

export default function GatewaySection() {
    return (
        <section className="relative overflow-hidden border-b border-border bg-muted/30 py-20">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-primary-text">Execution Bridge</p>
                        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                            AlgoVault MT5 Trading Gateway
                        </h2>
                        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
                            High-frequency HTTP REST bridge connecting web platform intelligence directly to MetaTrader 4 and 5 terminals via custom MQL5 Expert Advisors.
                        </p>
                    </div>
                    <Link
                        href="/account/trading-access"
                        className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-primary-text transition hover:opacity-80 md:mt-0"
                    >
                        Configure Gateway Tokens <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Gateway Architecture Visual */}
                <div className="mt-12 rounded-lg border border-border bg-card p-6 md:p-8">
                    <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
                        
                        {/* Flow Diagram */}
                        <div className="space-y-6 lg:col-span-7">
                            <div className="grid grid-cols-1 gap-3 text-center font-numeric text-xs sm:grid-cols-4">
                                <div className="space-y-1 rounded-lg border border-primary/30 bg-primary/10 p-4">
                                    <span className="text-micro font-bold text-primary-text">SOURCE</span>
                                    <div className="font-bold text-foreground">AlgoVault Web</div>
                                    <div className="text-micro text-muted-foreground">Order Intelligence</div>
                                </div>
                                <div className="space-y-1 rounded-lg border border-info/30 bg-info/10 p-4">
                                    <span className="text-micro font-bold text-info">REST API</span>
                                    <div className="font-bold text-foreground">Trading Gateway</div>
                                    <div className="text-micro text-muted-foreground">Bearer Token Auth</div>
                                </div>
                                <div className="space-y-1 rounded-lg border border-positive/30 bg-positive/10 p-4">
                                    <span className="text-micro font-bold text-positive">TERMINAL</span>
                                    <div className="font-bold text-foreground">MetaTrader 5</div>
                                    <div className="text-micro text-muted-foreground">MQL5 EA Bridge</div>
                                </div>
                                <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-4">
                                    <span className="text-micro font-bold text-warning">BROKER</span>
                                    <div className="font-bold text-foreground">Live Execution</div>
                                    <div className="text-micro text-muted-foreground">Direct Liquidity</div>
                                </div>
                            </div>

                            <div className="space-y-2 rounded-lg border border-border bg-background p-5 font-numeric text-xs">
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Gateway Architecture</span>
                                    <span className="font-bold text-positive">Single Unified Protocol</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Authentication</span>
                                    <span className="font-bold text-info">HMAC Token Exchange</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Heartbeat Interval</span>
                                    <span className="text-foreground">5,000 ms</span>
                                </div>
                            </div>
                        </div>

                        {/* Right MQL5 Source Code Box */}
                        <div className="space-y-3 rounded-lg border border-border bg-background p-5 font-numeric text-xs lg:col-span-5">
                            <div className="flex items-center justify-between border-b border-border pb-2 text-muted-foreground">
                                <span className="flex items-center gap-1.5 font-bold text-foreground"><Terminal size={14} className="text-positive" /> MQL5 EA Bridge Code</span>
                                <span className="text-micro font-bold text-positive">MQL5 Source Available</span>
                            </div>
                            <div className="no-scrollbar space-y-1.5 overflow-x-auto rounded-md bg-muted/40 p-3 text-micro text-muted-foreground">
                                <div>{"// AlgoVaultTradeGateway.mq5"}</div>
                                <div>#include &lt;Trade\Trade.mqh&gt;</div>
                                <div>input string GatewayToken = &quot;ag_live_...&quot;;</div>
                                <div>void OnTimer() &#123;</div>
                                <div className="pl-4">WebRequest(&quot;GET&quot;, &quot;https://.../commands&quot;);</div>
                                <div className="pl-4">ExecutePendingOrders();</div>
                                <div>&#125;</div>
                            </div>
                            <div className="flex items-center justify-between pt-2 text-micro">
                                <span className="text-muted-foreground">Compatible with MT4 &amp; MT5 terminals.</span>
                                <Link href="/account/trading-access" className="flex items-center gap-1 font-bold text-primary-text hover:underline">
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
