"use client";

import { useState, useMemo } from "react";
import { Calculator, Coins, Target, TrendingUp, ArrowUpRight, Sparkles, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ToolPageShell } from "@/components/tools/ToolPageShell";

const INSTRUMENTS: Record<string, { contractSize: number; digits: number; marginPercent: number; pipSize: number }> = {
    XAUUSD: { contractSize: 100, digits: 2, marginPercent: 1, pipSize: 0.01 },
    EURUSD: { contractSize: 100000, digits: 5, marginPercent: 2, pipSize: 0.0001 },
    GBPUSD: { contractSize: 100000, digits: 5, marginPercent: 2, pipSize: 0.0001 },
    USDJPY: { contractSize: 100000, digits: 3, marginPercent: 2, pipSize: 0.01 },
    BTCUSD: { contractSize: 1, digits: 2, marginPercent: 10, pipSize: 0.01 },
    ETHUSD: { contractSize: 1, digits: 2, marginPercent: 10, pipSize: 0.01 },
    US30: { contractSize: 1, digits: 1, marginPercent: 5, pipSize: 0.01 },
    NAS100: { contractSize: 1, digits: 2, marginPercent: 5, pipSize: 0.01 },
    AUDUSD: { contractSize: 100000, digits: 5, marginPercent: 2, pipSize: 0.0001 },
    USDCAD: { contractSize: 100000, digits: 5, marginPercent: 2, pipSize: 0.0001 },
    USDCHF: { contractSize: 100000, digits: 5, marginPercent: 2, pipSize: 0.0001 },
    NZDUSD: { contractSize: 100000, digits: 5, marginPercent: 2, pipSize: 0.0001 },
    EURGBP: { contractSize: 100000, digits: 5, marginPercent: 2, pipSize: 0.0001 },
    EURJPY: { contractSize: 100000, digits: 3, marginPercent: 2, pipSize: 0.01 },
    GBPJPY: { contractSize: 100000, digits: 3, marginPercent: 2, pipSize: 0.01 },
};

type LiteTab = "position" | "pip";

export default function TradingCalculators() {
    const [tab, setTab] = useState<LiteTab>("position");

    return (
        <ToolPageShell
            title="Trading Calculators"
            description="Two free calculators for sizing trades and reading pip cost. Margin, swap, profit-split, and spread analyzers are part of Pro."
            badge="lite"
            icon={Calculator}
            backHref="/tools"
            proHeadline="Pro adds margin, swap, profit-split and spread analyzers — the full trading-cost toolkit."
            proFeatures={[
                "Margin calculator (per instrument, leverage aware)",
                "Swap cost calculator (multi-day carry)",
                "Profit Split calculator (investor / manager)",
                "Spread analyzer (pips, $ cost, % of price)",
                "Save calculator presets to your account",
            ]}
        >
            {/* Lite tabs (2 free calculators) */}
            <div className="flex gap-2 rounded-lg border border-border bg-card p-1">
                {([
                    { key: "position" as const, label: "Position Size", icon: Target },
                    { key: "pip" as const, label: "Pip Value", icon: Coins },
                ]).map((t) => {
                    const Icon = t.icon;
                    return (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={cn(
                                "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all",
                                tab === t.key
                                    ? "bg-foreground text-background"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                        >
                            <Icon size={15} /> {t.label}
                        </button>
                    );
                })}
            </div>

            <div className="space-y-6">
                {tab === "position" && <PositionSizeCalc />}
                {tab === "pip" && <PipValueCalc />}
            </div>

            {/* Pro upsell row: locked calculators */}
            <div className="grid gap-3 md:grid-cols-2">
                <LockedCalcCard
                    title="Margin Calculator"
                    description="Required margin per instrument, leverage-aware."
                    href="/pricing"
                />
                <LockedCalcCard
                    title="Swap / Rollover"
                    description="Per-day carry cost for any position size and duration."
                    href="/pricing"
                />
                <LockedCalcCard
                    title="Profit Split"
                    description="Investor / manager share of profits from any contribution."
                    href="/pricing"
                />
                <LockedCalcCard
                    title="Spread Analyzer"
                    description="Spread in pips, $ cost, and % of price."
                    href="/pricing"
                />
            </div>
        </ToolPageShell>
    );
}

function PositionSizeCalc() {
    const [accountBalance, setAccountBalance] = useState("10000");
    const [riskPercent, setRiskPercent] = useState("1");
    const [entryPrice, setEntryPrice] = useState("");
    const [stopLoss, setStopLoss] = useState("");
    const [takeProfit, setTakeProfit] = useState("");
    const [instrument, setInstrument] = useState("EURUSD");

    const result = useMemo(() => {
        const balance = Number(accountBalance) || 0;
        const riskPct = Number(riskPercent) || 0;
        const entry = Number(entryPrice) || 0;
        const sl = Number(stopLoss) || 0;
        const tp = Number(takeProfit) || 0;

        if (!balance || !riskPct || !entry || !sl || entry === sl) return null;

        const riskAmount = balance * (riskPct / 100);
        const stopDistance = Math.abs(entry - sl);
        const inst = INSTRUMENTS[instrument] || INSTRUMENTS.EURUSD;

        const pipDistance = stopDistance / inst.pipSize;
        let lotSize = 0;
        if (inst.contractSize === 100000) {
            lotSize = riskAmount / (pipDistance * inst.contractSize * inst.pipSize);
        } else {
            lotSize = riskAmount / (stopDistance * inst.contractSize);
        }

        const lotSizeRounded = Math.floor(lotSize * 100) / 100;
        const tpPips = tp > 0 ? Math.abs(tp - entry) / inst.pipSize : 0;
        const riskReward = stopDistance > 0 && tp > 0 ? Math.abs(tp - entry) / stopDistance : 0;
        const actualRisk =
            lotSizeRounded *
            (inst.contractSize === 100000
                ? pipDistance * inst.contractSize * inst.pipSize
                : stopDistance * inst.contractSize);

        return {
            lotSize: lotSizeRounded,
            actualRisk: Number(actualRisk.toFixed(2)),
            riskAmount: Number(riskAmount.toFixed(2)),
            stopDistance: Number(stopDistance.toFixed(inst.digits)),
            pipDistance: Number(pipDistance.toFixed(1)),
            tpPips: Number(tpPips.toFixed(1)),
            riskReward: Number(riskReward.toFixed(2)),
        };
    }, [accountBalance, riskPercent, entryPrice, stopLoss, takeProfit, instrument]);

    const inputClass =
        "w-full rounded-md border border-border/40 bg-muted/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition";

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Target size={15} className="text-primary" /> Trade Parameters
                </h2>
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Instrument</label>
                            <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className={inputClass}>
                                {Object.keys(INSTRUMENTS).map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Account Balance</label>
                            <input type="number" step="any" value={accountBalance} onChange={(e) => setAccountBalance(e.target.value)} className={inputClass} />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Risk %</label>
                        <input type="number" step="0.1" min="0.01" max="100" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} className={inputClass} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Entry</label>
                            <input type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} placeholder="0.00" className={inputClass} />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Stop Loss</label>
                            <input type="number" step="any" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="0.00" className={inputClass} />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Take Profit</label>
                            <input type="number" step="any" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} placeholder="0.00" className={inputClass} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Result</h2>
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-lg border border-positive/20 bg-positive/[0.06] p-5 text-center">
                            <p className="text-micro uppercase tracking-wider text-muted-foreground">Position Size</p>
                            <p className="mt-1 font-numeric text-3xl font-bold text-positive">{result.lotSize} lots</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-micro uppercase text-muted-foreground">Risk Amount</p>
                                <p className="font-numeric text-sm font-bold text-negative">${result.actualRisk}</p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-micro uppercase text-muted-foreground">Risk:Reward</p>
                                <p className={cn("font-numeric text-sm font-bold", result.riskReward >= 2 ? "text-positive" : result.riskReward >= 1 ? "text-warning" : "text-negative")}>1:{result.riskReward}</p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-micro uppercase text-muted-foreground">Stop Distance</p>
                                <p className="font-numeric text-sm font-bold text-muted-foreground">{result.stopDistance}</p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-micro uppercase text-muted-foreground">Pips to SL</p>
                                <p className="font-numeric text-sm font-bold text-muted-foreground">{result.pipDistance} pips</p>
                            </div>
                            {result.tpPips > 0 && (
                                <div className="rounded-lg bg-muted p-3">
                                    <p className="text-micro uppercase text-muted-foreground">Pips to TP</p>
                                    <p className="font-numeric text-sm font-bold text-positive">{result.tpPips} pips</p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                        Enter balance, risk %, entry and stop loss.
                    </div>
                )}
            </div>
        </div>
    );
}

function PipValueCalc() {
    const [instrument, setInstrument] = useState("EURUSD");
    const [lotSize, setLotSize] = useState("1");
    const [accountCurrency, setAccountCurrency] = useState<"USD" | "EUR">("USD");

    const result = useMemo(() => {
        const inst = INSTRUMENTS[instrument] || INSTRUMENTS.EURUSD;
        const lots = Number(lotSize) || 0;
        if (!lots) return null;

        const baseValuePerLot =
            inst.contractSize === 100000 ? 10 : inst.contractSize === 100 ? 1 : 0.01;
        const valuePerPipPerLot = baseValuePerLot;
        const totalValuePerPip = valuePerPipPerLot * lots;

        return {
            pipSize: inst.pipSize,
            contractSize: inst.contractSize,
            valuePerPipPerLot,
            totalValuePerPip: totalValuePerPip.toFixed(2),
        };
    }, [instrument, lotSize, accountCurrency]);

    const inputClass =
        "w-full rounded-md border border-border/40 bg-muted/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition";

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Coins size={15} className="text-primary" /> Inputs
                </h2>
                <div className="space-y-3">
                    <div>
                        <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Instrument</label>
                        <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className={inputClass}>
                            {Object.keys(INSTRUMENTS).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Lot Size</label>
                        <input type="number" step="0.01" value={lotSize} onChange={(e) => setLotSize(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Account Currency</label>
                        <div className="flex gap-2">
                            {(["USD", "EUR"] as const).map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setAccountCurrency(c)}
                                    className={cn(
                                        "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition",
                                        accountCurrency === c
                                            ? "border-primary/40 bg-primary/10 text-primary"
                                            : "border-border bg-muted text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {c}
                                </button>
                            ))}
                        </div>
                        <p className="mt-1 text-micro text-muted-foreground">Cross-pair conversions are a Pro feature.</p>
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Pip Math</h2>
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-lg border border-info/20 bg-info/[0.06] p-5 text-center">
                            <p className="text-micro uppercase tracking-wider text-muted-foreground">Value per Pip</p>
                            <p className="mt-1 font-numeric text-3xl font-bold text-info">
                                ${result.totalValuePerPip}
                            </p>
                            <p className="mt-1 text-micro text-muted-foreground">{lotSize} lot(s) of {instrument}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-micro uppercase text-muted-foreground">Pip Size</p>
                                <p className="font-numeric text-sm font-bold text-foreground">{result.pipSize}</p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-micro uppercase text-muted-foreground">Contract Size</p>
                                <p className="font-numeric text-sm font-bold text-foreground">{result.contractSize.toLocaleString()}</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                        Enter a lot size.
                    </div>
                )}
            </div>
        </div>
    );
}

function LockedCalcCard({
    title,
    description,
    href,
}: {
    title: string;
    description: string;
    href: string;
}) {
    return (
        <Link
            href={href}
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