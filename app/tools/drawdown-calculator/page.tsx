"use client";

import { useState, useMemo } from "react";
import { TrendingDown, Info, Crown, Sparkles, ArrowUpRight } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * Drawdown Calculator — Lite.
 *
 * Free (this page): fixed-loss compounding curve + recovery % to breakeven.
 * Pro (gated below): variable-loss scenario, Monte-Carlo distribution,
 * equity-curve export, and saved scenarios.
 */

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
        const recoveryNeeded = ((100 / (100 - loss)) - 1) * 100;

        return {
            finalBalance: Number(finalBalance.toFixed(2)),
            totalDrawdown: Number(totalDrawdown.toFixed(2)),
            drawdownPct: Number(drawdownPct.toFixed(2)),
            riskPerTrade: Number(riskPerTrade.toFixed(2)),
            curve,
            recoveryNeeded: Number(recoveryNeeded.toFixed(2)),
        };
    }, [balance, lossPercent, consecutiveLosses]);

    const inputClass =
        "w-full rounded-md border border-border/40 bg-muted/40 px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition";

    return (
        <ToolPageShell
            title="Drawdown Calculator"
            description="See how consecutive losses compound and how much you need to recover to breakeven. Pro adds Monte-Carlo scenarios, variable loss %, and saved scenarios."
            badge="lite"
            icon={TrendingDown}
            backHref="/tools"
            proHeadline="Pro adds the scenarios traders actually need: variable loss %, Monte-Carlo distribution, and saved comparisons."
            proFeatures={[
                "Variable loss-per-trade (different size per trade)",
                "Monte-Carlo drawdown distribution (1000 paths)",
                "Equity-curve export to CSV",
                "Save scenarios to your account",
                "Compare two scenarios side-by-side",
            ]}
        >
            <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-5">
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <TrendingDown size={15} className="text-negative" /> Parameters
                    </h2>
                    <div className="space-y-3">
                        <div>
                            <label className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">Starting Balance ($)</label>
                            <input type="number" step="any" value={balance} onChange={(e) => setBalance(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">Loss Per Trade (%)</label>
                            <input
                                type="number"
                                step="0.1"
                                min="0.01"
                                max="100"
                                value={lossPercent}
                                onChange={(e) => setLossPercent(e.target.value)}
                                className={inputClass}
                            />
                            <p className="mt-1 text-micro text-muted-foreground">Lite uses a fixed loss % for every trade. Variable loss is a Pro feature.</p>
                        </div>
                        <div>
                            <label className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">Consecutive Losses</label>
                            <input type="number" min="1" max="100" value={consecutiveLosses} onChange={(e) => setConsecutiveLosses(e.target.value)} className={inputClass} />
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    {calc ? (
                        <>
                            <div className="rounded-lg border border-negative/20 bg-negative/[0.04] p-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-micro uppercase text-muted-foreground">Final Balance</p>
                                        <p className="mt-1 font-mono text-xl font-bold text-foreground">${calc.finalBalance.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-micro uppercase text-muted-foreground">Total Drawdown</p>
                                        <p className="mt-1 font-mono text-xl font-bold text-negative">-{calc.drawdownPct}%</p>
                                    </div>
                                    <div>
                                        <p className="text-micro uppercase text-muted-foreground">Amount Lost</p>
                                        <p className="font-mono text-sm font-bold text-negative">${calc.totalDrawdown.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-micro uppercase text-muted-foreground">Risk Per Trade</p>
                                        <p className="font-mono text-sm font-bold text-muted-foreground">${calc.riskPerTrade.toLocaleString()}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-lg border border-border bg-card p-5">
                                <h3 className="mb-3 text-xs font-semibold text-muted-foreground">Equity Curve</h3>
                                <div className="flex items-end gap-1 h-32">
                                    {calc.curve.map((val, i) => {
                                        const maxVal = Math.max(...calc.curve);
                                        const height = maxVal > 0 ? (val / maxVal) * 100 : 0;
                                        const isLast = i === calc.curve.length - 1;
                                        return (
                                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                                <span className="text-[8px] font-mono text-muted-foreground">${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}</span>
                                                <div className={cn("w-full rounded-t transition-all", isLast ? "bg-positive" : "bg-negative/60")} style={{ height: `${height}%` }} />
                                                <span className="text-[8px] text-muted-foreground">#{i}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="rounded-lg border border-warning/15 bg-warning/[0.04] p-3 text-xs text-warning">
                                <Info size={12} className="mr-1 inline" />
                                After {calc.drawdownPct}% drawdown, you need +{calc.recoveryNeeded}% gain to recover to breakeven.
                            </div>
                        </>
                    ) : (
                        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                            Enter parameters to see drawdown simulation.
                        </div>
                    )}
                </div>
            </div>

            {/* Pro upsell row */}
            <div className="grid gap-3 md:grid-cols-3">
                <ProTile
                    title="Variable Loss %"
                    description="Different loss size per trade, with a per-trade sequence editor."
                />
                <ProTile
                    title="Monte-Carlo Paths"
                    description="1000 simulated drawdown distributions from your win/loss setup."
                />
                <ProTile
                    title="Save & Compare"
                    description="Save scenarios to your account and compare two scenarios side-by-side."
                />
            </div>
        </ToolPageShell>
    );
}

function ProTile({ title, description }: { title: string; description: string }) {
    return (
        <Link
            href="/pricing"
            className="group flex flex-col gap-2 rounded-lg border border-dashed border-primary/25 bg-primary/[0.03] p-4 transition hover:border-primary/40 hover:bg-primary/[0.05]"
        >
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider text-primary">
                    <Crown className="size-2.5" />
                    Pro
                </span>
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary transition group-hover:gap-1.5">
                <Sparkles className="size-3" />
                Unlock
                <ArrowUpRight className="size-3" />
            </span>
        </Link>
    );
}