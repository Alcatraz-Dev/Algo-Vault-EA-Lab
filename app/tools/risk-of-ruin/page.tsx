"use client";

import { useState, useMemo } from "react";
import { ArrowLeft, AlertTriangle, Shield, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

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
        const bal = Number(accountSize);

        if (!wr || !rr || !rpct || !mdd || !bal) return null;

        // Risk of Ruin formula (simplified)
        const q = 1 - wr;
        const a = Math.pow((1 + rr) / rr, wr) * Math.pow(1 / rr, q);
        const riskOfRuin = Math.pow(1 / a, mdd / rpct);

        // Expected value per trade
        const ev = (wr * rr - q) * rpct * bal;
        const evPerTrade = (wr * rr * rpct - q * rpct) * bal;

        // Number of trades to double
        const growthRate = Math.log(1 + rpct * (wr * rr - q));
        const tradesToDouble = growthRate > 0 ? Math.ceil(Math.log(2) / growthRate) : Infinity;

        // Max consecutive losses (expected)
        const maxConsecLosses = Math.ceil(Math.log(0.05) / Math.log(q));

        // Kelly Criterion
        const kelly = wr - (q / rr);
        const halfKelly = kelly / 2;

        const riskPct = Math.min(100, Math.max(0, riskOfRuin * 100));

        return {
            riskOfRuin: Number(riskPct.toFixed(4)),
            evPerTrade: Number(evPerTrade.toFixed(2)),
            tradesToDouble: tradesToDouble === Infinity ? "∞" : String(tradesToDouble),
            maxConsecLosses,
            kellyPercent: Number((kelly * 100).toFixed(2)),
            halfKellyPercent: Number((halfKelly * 100).toFixed(2)),
            riskGrade: riskPct < 1 ? "A" : riskPct < 5 ? "B" : riskPct < 15 ? "C" : riskPct < 30 ? "D" : "F",
        };
    }, [winRate, riskReward, riskPerTrade, maxDrawdown, accountSize]);

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6" data-guide="page-header">
                    <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Risk of Ruin Calculator</h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">Calculate probability of account blowup based on your trading parameters</p>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Inputs */}
                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                        <h2 className="mb-4 text-sm font-semibold text-foreground">Trading Parameters</h2>
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Win Rate (%)</label>
                                    <input type="number" step="1" min="0" max="100" value={winRate} onChange={(e) => setWinRate(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Risk:Reward</label>
                                    <input type="number" step="0.1" min="0.1" value={riskReward} onChange={(e) => setRiskReward(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Risk Per Trade (%)</label>
                                    <input type="number" step="0.1" min="0.1" max="100" value={riskPerTrade} onChange={(e) => setRiskPerTrade(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Max Drawdown Tolerance (%)</label>
                                    <input type="number" step="1" min="1" max="100" value={maxDrawdown} onChange={(e) => setMaxDrawdown(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                                </div>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Account Size ($)</label>
                                <input type="number" step="any" value={accountSize} onChange={(e) => setAccountSize(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                            </div>
                        </div>
                    </div>

                    {/* Results */}
                    <div className="space-y-4">
                        {calc ? (
                            <>
                                <div className={cn(
                                    "rounded-2xl border p-5 text-center",
                                    calc.riskGrade === "A" ? "border-emerald-500/20 bg-emerald-500/[0.06]" :
                                    calc.riskGrade === "B" ? "border-emerald-500/15 bg-emerald-500/[0.04]" :
                                    calc.riskGrade === "C" ? "border-amber-500/15 bg-amber-500/[0.04]" :
                                    "border-rose-500/15 bg-rose-500/[0.04]"
                                )}>
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk of Ruin</p>
                                    <p className={cn(
                                        "mt-1 text-4xl font-bold font-mono",
                                        calc.riskGrade === "A" ? "text-emerald-400" :
                                        calc.riskGrade === "B" ? "text-emerald-400" :
                                        calc.riskGrade === "C" ? "text-amber-400" :
                                        "text-rose-400"
                                    )}>
                                        {calc.riskOfRuin < 0.01 ? "<0.01%" : calc.riskOfRuin < 1 ? `${calc.riskOfRuin}%` : `${calc.riskOfRuin.toFixed(1)}%`}
                                    </p>
                                    <p className={cn(
                                        "mt-1 text-sm font-bold",
                                        calc.riskGrade === "A" ? "text-emerald-400" :
                                        calc.riskGrade === "B" ? "text-emerald-400" :
                                        calc.riskGrade === "C" ? "text-amber-400" :
                                        "text-rose-400"
                                    )}>
                                        Grade: {calc.riskGrade}
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                        <p className="text-[9px] uppercase text-muted-foreground">EV per Trade</p>
                                        <p className={cn("font-mono text-sm font-bold", calc.evPerTrade >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            ${calc.evPerTrade.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                        <p className="text-[9px] uppercase text-muted-foreground">Trades to Double</p>
                                        <p className="font-mono text-sm font-bold text-foreground">{calc.tradesToDouble}</p>
                                    </div>
                                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                        <p className="text-[9px] uppercase text-muted-foreground">Max Consec. Losses</p>
                                        <p className="font-mono text-sm font-bold text-amber-400">{calc.maxConsecLosses}</p>
                                    </div>
                                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                                        <p className="text-[9px] uppercase text-muted-foreground">Kelly %</p>
                                        <p className="font-mono text-sm font-bold text-violet-400">{calc.kellyPercent}%</p>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-violet-500/10 bg-violet-500/[0.03] p-4">
                                    <p className="flex items-center gap-2 text-xs font-semibold text-violet-400">
                                        <Shield size={13} /> Optimal Position Sizing
                                    </p>
                                    <p className="mt-1.5 text-xs text-muted-foreground">
                                        Half-Kelly suggests risking <span className="font-bold text-foreground">{calc.halfKellyPercent}%</span> per trade for optimal growth with reduced risk.
                                        Your current {riskPerTrade}% risk is {Number(riskPerTrade) > calc.halfKellyPercent ? (
                                            <span className="text-rose-400 font-bold">higher</span>
                                        ) : (
                                            <span className="text-emerald-400 font-bold">within</span>
                                        )} than optimal.
                                    </p>
                                </div>
                            </>
                        ) : (
                            <div className="flex h-64 items-center justify-center rounded-2xl border border-border/30 bg-muted/50">
                                <p className="text-xs text-muted-foreground">Enter parameters to calculate risk of ruin</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-6 rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-3 text-[11px] text-amber-400/60">
                    <Info size={12} className="mr-1 inline" />
                    Risk of ruin is calculated using simplified statistical models. Actual results depend on market conditions, execution quality, and psychological factors.
                </div>
            </div>
        </div>
    );
}
