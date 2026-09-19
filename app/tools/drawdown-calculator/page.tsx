"use client";

import { useState, useMemo } from "react";
import { TrendingDown, Info } from "lucide-react";
import SiteNavbar from "@/components/navbar/SiteNavbar";
import { cn } from "@/lib/utils";

export default function DrawdownCalculator() {
    const [balance, setBalance] = useState("10000");
    const [lossPercent, setLossPercent] = useState("10");
    const [consecutiveLosses, setConsecutiveLosses] = useState("5");

    const calc = useMemo(() => {
        const bal = Number(balance) || 0;
        const loss = Number(lossPercent) || 0;
        const losses = Number(consecutiveLosses) || 0;
        if (!bal || !loss || !losses) return null;

        let current = bal;
        const curve: number[] = [bal];
        for (let i = 0; i < losses; i++) {
            current = current * (1 - loss / 100);
            curve.push(Number(current.toFixed(2)));
        }

        const finalBalance = current;
        const totalDrawdown = bal - finalBalance;
        const drawdownPct = (totalDrawdown / bal) * 100;
        const riskPerTrade = bal * (loss / 100);

        // Recovery calculation
        const recoveryNeeded = ((100 / (100 - loss)) - 1) * 100;

        return {
            finalBalance: Number(finalBalance.toFixed(2)),
            totalDrawdown: Number(totalDrawdown.toFixed(2)),
            drawdownPct: Number(drawdownPct.toFixed(2)),
            riskPerTrade: Number(riskPerTrade.toFixed(2)),
            curve,
            recoveryNeeded: Number(recoveryNeeded.toFixed(2)),
            maxRecoveryTrades: losses,
        };
    }, [balance, lossPercent, consecutiveLosses]);

    return (
        <div className="min-h-screen bg-background">
            <SiteNavbar />
            <div className="mx-auto max-w-4xl px-4 py-8">
                <div className="mb-6" data-guide="page-header">
                    <h1 className="text-2xl font-bold text-foreground">Drawdown Calculator</h1>
                    <p className="mt-1 text-sm text-muted-foreground">Visualize compounding losses and recovery requirements</p>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><TrendingDown size={15} className="text-rose-400" /> Parameters</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Starting Balance ($)</label>
                                <input type="number" step="any" value={balance} onChange={(e) => setBalance(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                            </div>
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Loss Per Trade (%)</label>
                                <input type="number" step="0.1" min="0.01" max="100" value={lossPercent} onChange={(e) => setLossPercent(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                            </div>
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Consecutive Losses</label>
                                <input type="number" min="1" max="100" value={consecutiveLosses} onChange={(e) => setConsecutiveLosses(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {calc ? (
                            <>
                                <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.03] p-5">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-[10px] uppercase text-muted-foreground">Final Balance</p>
                                            <p className="mt-1 text-xl font-bold font-mono text-foreground">${calc.finalBalance.toLocaleString()}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase text-muted-foreground">Total Drawdown</p>
                                            <p className="mt-1 text-xl font-bold font-mono text-rose-400">-{calc.drawdownPct}%</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase text-muted-foreground">Amount Lost</p>
                                            <p className="font-mono text-sm font-bold text-rose-400/80">${calc.totalDrawdown.toLocaleString()}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase text-muted-foreground">Risk Per Trade</p>
                                            <p className="font-mono text-sm font-bold text-muted-foreground">${calc.riskPerTrade.toLocaleString()}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                    <h3 className="mb-3 text-xs font-semibold text-muted-foreground">Equity Curve</h3>
                                    <div className="flex items-end gap-1 h-32">
                                        {calc.curve.map((val, i) => {
                                            const maxVal = Math.max(...calc.curve);
                                            const height = maxVal > 0 ? (val / maxVal) * 100 : 0;
                                            const isLast = i === calc.curve.length - 1;
                                            return (
                                                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                                    <span className="text-[8px] font-mono text-muted-foreground">${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}</span>
                                                    <div className={cn("w-full rounded-t transition-all", isLast ? "bg-emerald-500" : "bg-rose-500/60")} style={{ height: `${height}%` }} />
                                                    <span className="text-[8px] text-muted-foreground">#{i}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-3 text-[11px] text-amber-400/60">
                                    <Info size={12} className="mr-1 inline" />
                                    After {calc.drawdownPct}% drawdown, you need +{calc.recoveryNeeded}% gain to recover to breakeven. This illustrates why proper risk management is critical.
                                </div>
                            </>
                        ) : (
                            <div className="flex h-64 items-center justify-center rounded-xl border border-border/30 bg-muted/50">
                                <p className="text-xs text-muted-foreground">Enter parameters to see drawdown simulation</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
