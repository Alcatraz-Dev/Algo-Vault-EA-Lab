"use client";

import { useState, useMemo } from "react";
import { Shield, Crown, Info } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import ProGate from "@/components/subscription/ProGate";
import { cn } from "@/lib/utils";
import { expectedValuePerTrade, kellyResult, simulateRuin } from "@/lib/quant/risk-of-ruin";
import { advertisableFeatures } from "@/lib/tools-capability-audit";

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
        "w-full rounded-md border border-border/40 bg-muted/40 px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none transition-colors";

    return (
        <ToolPageShell
            title="Risk of Ruin"
            description="Probability of blowing the account given win rate, RR, risk per trade and max drawdown. Pro adds Kelly criterion, expected value, and Monte-Carlo."
            badge="lite"
            icon={Shield}
            backHref="/tools"
            proHeadline="Pro adds the position-sizing math: Kelly fraction, half-Kelly, expected value per trade, and 1000-path Monte Carlo."
            proFeatures={advertisableFeatures([
                "Kelly criterion & half-Kelly position sizing",
                "Expected value per trade in $",
                "Monte-Carlo ruin distribution (1000 paths)",
            ])}
        >
            <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] p-5">
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
                                        "mt-1 font-numeric text-4xl font-bold",
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
                                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Trades to Double</p>
                                    <p className="mt-1 font-numeric text-sm font-semibold font-bold text-foreground">
                                        {calc.tradesToDouble === Infinity ? "∞" : calc.tradesToDouble}
                                    </p>
                                </div>
                                <div className="rounded-lg bg-muted p-4">
                                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Max Consec Losses</p>
                                    <p className="mt-1 font-numeric text-sm font-semibold font-bold text-foreground">{calc.maxConsecLosses}</p>
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

            {/* Pro analysis — real maths from lib/quant/risk-of-ruin */}
            <ProGate>
                <ProRuinAnalysis
                    winRate={Number(winRate) / 100}
                    riskReward={Number(riskReward)}
                    riskPerTradePct={Number(riskPerTrade)}
                    ruinDrawdownPct={Number(maxDrawdown)}
                    accountSize={Number(accountSize)}
                />
            </ProGate>
        </ToolPageShell>
    );
}

function ProRuinAnalysis({
    winRate,
    riskReward,
    riskPerTradePct,
    ruinDrawdownPct,
    accountSize,
}: {
    winRate: number;
    riskReward: number;
    riskPerTradePct: number;
    ruinDrawdownPct: number;
    accountSize: number;
}) {
    const model = useMemo(() => {
        const kelly = kellyResult({ winRate, riskReward, accountSize });
        const ev = expectedValuePerTrade({ winRate, riskReward, riskPerTradePct, accountSize });
        const ruin = simulateRuin({ winRate, riskReward, riskPerTradePct, ruinDrawdownPct, paths: 1000, tradesPerPath: 500, seed: 42 });
        return { kelly, ev, ruin };
    }, [winRate, riskReward, riskPerTradePct, ruinDrawdownPct, accountSize]);

    if (!model.kelly || !model.ev || !model.ruin) {
        return (
            <div className="rounded-xl border border-dashed border-border p-5 text-xs text-muted-foreground">
                Enter a win rate between 0–100%, a positive reward:risk ratio and a positive risk per trade.
            </div>
        );
    }

    const { kelly, ev, ruin } = model;
    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

    return (
        <div className="space-y-4 rounded-xl border border-primary/25 bg-primary/[0.03] p-5">
            <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Crown size={15} className="text-primary" /> Pro — sizing &amp; ruin model
                </h2>
                <span className="text-micro uppercase tracking-wider text-muted-foreground">
                    seed {ruin.seed} · {ruin.paths.toLocaleString()} paths × {ruin.tradesPerPath} trades
                </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Full Kelly" value={pct(kelly.kellyFraction)} tone={kelly.kellyFraction > 0 ? "positive" : "negative"} />
                <Stat label="Half Kelly (recommended)" value={pct(kelly.halfKellyFraction)} />
                <Stat label="EV / trade" value={ev.expectedValue === null ? `${ev.expectedR}R` : `$${ev.expectedValue.toFixed(2)}`} tone={ev.expectedR > 0 ? "positive" : "negative"} />
                <Stat label="Simulated ruin probability" value={pct(ruin.ruinProbability)} tone={ruin.ruinProbability > 0.1 ? "negative" : "positive"} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Median ending equity" value={`${ruin.medianEquityMultiple.toFixed(2)}×`} />
                <Stat label="Median max drawdown" value={`${ruin.maxDrawdown.median.toFixed(2)}%`} />
                <Stat label="95th percentile drawdown" value={`${ruin.maxDrawdown.p95.toFixed(2)}%`} />
            </div>

            <p className="text-micro leading-relaxed text-muted-foreground">
                Monte Carlo draws independent wins and losses from your inputs — it is a model of the assumptions, not a
                forecast. Ruin means breaching {ruinDrawdownPct}% drawdown from peak. A positive Kelly fraction is not a
                promise of profit.
            </p>
        </div>
    );
}

function Stat({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: "positive" | "negative";
}) {
    return (
        <div className="rounded-lg bg-muted p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p
                className={cn(
                    "mt-1 font-numeric text-sm font-semibold text-foreground",
                    tone === "positive" && "text-positive",
                    tone === "negative" && "text-negative",
                )}
            >
                {value}
            </p>
        </div>
    );
}