"use client";

import { Activity, ShieldCheck, LineChart, TrendingUp } from "lucide-react";
import Link from "next/link";

export default function LiveMonitoringSection() {
    return (
        <section className="py-20 border-b border-border/40 bg-background relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Live Telemetry</p>
                    <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                        Real-Time Multi-Account Monitoring
                    </h2>
                    <p className="mt-3 text-base text-muted-foreground">
                        Track live equity curves, open drawdown, symbol exposure, and trade logs across all your connected MT5 broker accounts in one unified dashboard.
                    </p>
                </div>

                {/* Live Account Dashboard Preview */}
                <div className="mt-12 rounded-3xl border border-border/80 bg-card/80 p-6 md:p-8 shadow-2xl backdrop-blur-xl">
                    <div className="space-y-6">
                        
                        {/* Top Summary Bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono text-xs">
                            <div className="rounded-2xl bg-background/80 p-4 border border-border/40">
                                <div className="text-[10px] text-muted-foreground">Combined Balance</div>
                                <div className="text-lg font-bold text-foreground mt-0.5">$24,500.00</div>
                                <div className="text-[10px] text-emerald-400 font-bold">+18.2% Total Profit</div>
                            </div>
                            <div className="rounded-2xl bg-background/80 p-4 border border-border/40">
                                <div className="text-[10px] text-muted-foreground">Active Equity</div>
                                <div className="text-lg font-bold text-foreground mt-0.5">$24,715.00</div>
                                <div className="text-[10px] text-emerald-400 font-bold">+$215.00 Floating P/L</div>
                            </div>
                            <div className="rounded-2xl bg-background/80 p-4 border border-border/40">
                                <div className="text-[10px] text-muted-foreground">Open Drawdown</div>
                                <div className="text-lg font-bold text-emerald-400 mt-0.5">1.2%</div>
                                <div className="text-[10px] text-muted-foreground">Well within 5.0% limit</div>
                            </div>
                            <div className="rounded-2xl bg-background/80 p-4 border border-border/40">
                                <div className="text-[10px] text-muted-foreground">Connected Accounts</div>
                                <div className="text-lg font-bold text-sky-400 mt-0.5">3 Active</div>
                                <div className="text-[10px] text-emerald-400 font-bold">Gateway Sync Online</div>
                            </div>
                        </div>

                        {/* Open Positions Table Preview */}
                        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-background/80 p-4 font-mono text-xs">
                            <div className="flex items-center justify-between border-b border-border/40 pb-3 text-muted-foreground">
                                <span className="font-bold text-foreground">Live Positions Monitor (Sample Preview)</span>
                                <span className="text-emerald-400 font-bold flex items-center gap-1"><ShieldCheck size={14} /> Gateway Stream Live</span>
                            </div>
                            <table className="w-full text-left mt-3">
                                <thead>
                                    <tr className="border-b border-border/40 text-[10px] text-muted-foreground uppercase">
                                        <th className="py-2">Ticket</th>
                                        <th className="py-2">Symbol</th>
                                        <th className="py-2">Type</th>
                                        <th className="py-2">Volume</th>
                                        <th className="py-2">Open Price</th>
                                        <th className="py-2">Current</th>
                                        <th className="py-2">SL / TP</th>
                                        <th className="py-2 text-right">Floating P/L</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30">
                                    <tr className="hover:bg-muted/30">
                                        <td className="py-2 text-muted-foreground">#108421</td>
                                        <td className="py-2 font-bold text-foreground">XAUUSD</td>
                                        <td className="py-2 text-emerald-400 font-bold">BUY</td>
                                        <td className="py-2">0.50</td>
                                        <td className="py-2">2,650.10</td>
                                        <td className="py-2">2,654.40</td>
                                        <td className="py-2 text-[11px] text-muted-foreground">2642.00 / 2662.00</td>
                                        <td className="py-2 text-right text-emerald-400 font-bold">+$215.00</td>
                                    </tr>
                                    <tr className="hover:bg-muted/30">
                                        <td className="py-2 text-muted-foreground">#108422</td>
                                        <td className="py-2 font-bold text-foreground">BTCUSD</td>
                                        <td className="py-2 text-emerald-400 font-bold">BUY</td>
                                        <td className="py-2">0.10</td>
                                        <td className="py-2">67,800.00</td>
                                        <td className="py-2">68,450.00</td>
                                        <td className="py-2 text-[11px] text-muted-foreground">66800.00 / 70000.00</td>
                                        <td className="py-2 text-right text-emerald-400 font-bold">+$65.00</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                    </div>
                </div>

            </div>
        </section>
    );
}
