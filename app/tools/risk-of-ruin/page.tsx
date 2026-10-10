"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, Shield, Crown, Sparkles, ArrowUpRight, Info } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * Risk of Ruin — Lite.
 *
 * Free: single-point risk of ruin % + trades-to-double + max consecutive losses.
 * Pro: Kelly criterion, expected value per trade, Monte-Carlo distribution,
 *      saved scenarios.
 */

export default function RiskOfRuinCalculator() {
    const [winRate, setWinRate] = useState("55");
    const [riskReward, setRiskReward] = useState("1.5");
    const [riskPerTrade, setRiskPerTrade] = useState("2");
    const [maxDrawdown, setMaxDrawdown] = useState("25");
    const [accountSize, setAccountSize] = useState("10000");

    const calc = useMemo(() => {
        const wr = Number(winRate) / 100;
        const rr = Number(riskReward);
        const rpct = Number(riskPerTrade) / 100;
        const mdd = Number(maxDrawdown) / 100;

        if (!wr || !rr || !rpct || !mdd) return null;

        // Risk of Ruin formula (simplified — common form for fixed fractional)
        const a = Math.pow((1 + rr) / rr, wr) * Math.pow(1 / rr, 1 - wr);
        const riskOfRuin = Math.pow(1 / a, mdd / rpct);

        // Number of trades to double
        const q = 1 - wr;
        const growthRate = Math.log(1 + rpct * (wr * rr - q));
        const tradesToDouble = growthRate > 0 ? Math.ceil(Math.log(2) / growthRate) : Infinity;

        // Max consecutive losses (expected)
        const maxConsecLosses = q > 0 ? Math.ceil(Math.log(0.05) / Math.log(q)) : 0;

        return {
            riskOfRuin: Number((Math.min(100, Math.max(0, riskOfRuin * 100))).toFixed(4)),
            tradesToDouble,
            maxConsecLosses,
        };
    }, [winRate, riskReward, riskPerTrade, maxDrawdown]);

    const inputClass =
        "w-full rounded-md border border-border/40 bg-muted/40 px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition";

    return (
        <ToolPageShell
            title="Risk of Ruin"
            description="Probability of blowing the account given win rate, RR, risk per trade and max drawdown. Pro adds Kelly criterion, expected value, and Monte-Carlo."
            badge="lite"
            icon={Shield}
            backHref="/tools"
            proHeadline="Pro adds the position-sizing math: Kelly fraction, half-Kelly, expected value per trade, and 1000-path Monte Carlo."
            proFeatures={[
                "Kelly criterion & half-Kelly position sizing",
                "Expected value per trade in $",
                "Monte-Carlo ruin distribution (1000 paths)",
                "Save scenarios to your account",
            ]}
        >
            <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-5">
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Shield size={15} className="text-primary" /> Inputs
                    </h2>
                    <div className="space-y-3">
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Win Rate (%)</label>
                            <input type="number" step="0.1" value={winRate} onChange={(e) => setWinRate(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Risk : Reward</label>
                            <input type="number" step="0.1" value={riskReward} onChange={(e) => setRiskReward(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Risk Per Trade (%)</label>
                            <input type="number" step="0.1" value={riskPerTrade} onChange={(e) => setRiskPerTrade(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Max Drawdown (%)</label>
                            <input type="number" step="0.1" value={maxDrawdown} onChange={(e) => setMaxDrawdown(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Account Size ($)</label>
                            <input type="number" value={accountSize} onChange={(e) => setAccountSize(e.target.value)} className={inputClass} />
                            <p className="mt-1 text-micro text-muted-foreground">Lite gives you the ruin %. Pro gives the dollar answer too.</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    {calc ? (
                        <>
                            <div
                                className={cn(
                                    "rounded-lg border p-5 text-center",
                                    calc.riskOfRuin >= 10
                                        ? "border-negative/20 bg-negative/[0.05]"
                                        : calc.riskOfRuin >= 1
                                          ? "border-warning/20 bg-warning/[0.05]"
                                          : "border-positive/20 bg-positive/[0.05]",
                                )}
                            >
                                <p className="text-micro uppercase tracking-wider text-muted-foreground">Risk of Ruin</p>
                                <p
                                    className={cn(
                                        "mt-1 font-mono text-4xl font-bold",
                                        calc.riskOfRuin >= 10
                                            ? "text-negative"
                                            : calc.riskOfRuin >= 1
                                              ? "text-warning"
                                              : "text-positive",
                                    )}
                                >
                                    {calc.riskOfRuin < 0.0001 ? "< 0.0001" : `${calc.riskOfRuin}%`}
                                </p>
                                <p className="mt-1 text-micro text-muted-foreground">
                                    Probability the account breaches max drawdown at this setup.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-lg bg-muted p-4">
                                    <p className="text-micro uppercase text-muted-foreground">Trades to Double</p>
                                    <p className="mt-1 font-mono text-xl font-bold text-foreground">
                                        {calc.tradesToDouble === Infinity ? "∞" : calc.tradesToDouble}
                                    </p>
                                </div>
                                <div className="rounded-lg bg-muted p-4">
                                    <p className="text-micro uppercase text-muted-foreground">Max Consec Losses</p>
                                    <p className="mt-1 font-mono text-xl font-bold text-foreground">{calc.maxConsecLosses}</p>
                                </div>
                            </div>

                            <div className="rounded-lg border border-info/15 bg-info/[0.04] p-3 text-xs text-info">
                                <Info size={12} className="mr-1 inline" />
                                Keep risk-per-trade under 2% for the ruin % to stay under 1% on most setups.
                            </div>
                        </>
                    ) : (
                        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                            Enter win rate, RR and risk per trade.
                        </div>
                    )}
                </div>
            </div>

            {/* Pro upsell row */}
            <div className="grid gap-3 md:grid-cols-3">
                <ProTile
                    title="Kelly Criterion"
                    description="Optimal position sizing from your edge (wr, RR). Includes half-Kelly."
                />
                <ProTile
                    title="Expected Value $"
                    description="$ EV per trade from your win rate, RR and account size."
                />
                <ProTile
                    title="Monte-Carlo Ruin"
                    description="1000 simulated paths to show your real-world ruin distribution."
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