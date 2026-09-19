"use client";

import { useState, useMemo } from "react";
import { Calculator, ArrowLeft, Info, RotateCcw, Coins, Percent, Clock, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

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

type Tab = "position" | "pip" | "margin" | "swap";

export default function TradingCalculators() {
    const [tab, setTab] = useState<Tab>("pip");

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6" data-guide="page-header">
                    <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Trading Calculators</h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">Pip value, margin requirement, and swap cost calculators</p>
                </div>

                {/* Tabs */}
                <div className="mb-6 flex gap-2 rounded-xl border border-border/30 bg-muted/50 p-1">
                    {([
                        { key: "position" as const, label: "Position Size", icon: Target },
                        { key: "pip" as const, label: "Pip Value", icon: Coins },
                        { key: "margin" as const, label: "Margin", icon: Calculator },
                        { key: "swap" as const, label: "Swap", icon: Clock },
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
                                        ? "bg-violet-600 text-foreground shadow-lg shadow-violet-500/20"
                                        : "text-muted-foreground hover:text-muted-foreground hover:bg-muted/40"
                                )}
                            >
                                <Icon size={15} /> {t.label}
                            </button>
                        );
                    })}
                </div>

                {/* Tab content */}
                <div data-guide="stats" className="space-y-6">
                    {tab === "position" && <PositionSizeCalc />}
                    {tab === "pip" && <PipValueCalc />}
                    {tab === "margin" && <MarginCalc />}
                    {tab === "swap" && <SwapCalc />}
                </div>
            </div>
        </div>
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
        } else if (inst.contractSize === 100) {
            lotSize = riskAmount / (stopDistance * inst.contractSize);
        } else {
            lotSize = riskAmount / (stopDistance * inst.contractSize);
        }

        const lotSizeRounded = Math.floor(lotSize * 100) / 100;
        const tpPips = tp > 0 ? Math.abs(tp - entry) / inst.pipSize : 0;
        const riskReward = stopDistance > 0 && tp > 0 ? Math.abs(tp - entry) / stopDistance : 0;
        const actualRisk = lotSizeRounded * (inst.contractSize === 100000 ? (pipDistance * inst.contractSize * inst.pipSize) : stopDistance * inst.contractSize);

        return {
            lotSize: lotSizeRounded,
            actualRisk: Number(actualRisk.toFixed(2)),
            riskAmount: Number(riskAmount.toFixed(2)),
            stopDistance: Number(stopDistance.toFixed(inst.digits)),
            pipDistance: Number(pipDistance.toFixed(1)),
            tpPips: Number(tpPips.toFixed(1)),
            riskReward: Number(riskReward.toFixed(2)),
            marginRequired: Number((lotSizeRounded * inst.contractSize * entry * 0.01).toFixed(2)),
        };
    }, [accountBalance, riskPercent, entryPrice, stopLoss, takeProfit, instrument]);

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Target size={15} className="text-violet-400" /> Trade Parameters</h2>
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Instrument</label>
                            <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition">
                                {Object.keys(INSTRUMENTS).map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Account Balance</label>
                            <input type="number" step="any" value={accountBalance} onChange={(e) => setAccountBalance(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Risk %</label>
                        <input type="number" step="0.1" min="0.01" max="100" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Entry Price</label>
                            <input type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} placeholder="0.00" className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none transition" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Stop Loss</label>
                            <input type="number" step="any" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="0.00" className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none transition" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Take Profit</label>
                            <input type="number" step="any" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} placeholder="0.00" className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none transition" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Result</h2>
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-xl bg-gradient-to-br from-emerald-500/10 to-blue-500/10 p-5 text-center border border-emerald-500/20">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Position Size</p>
                            <p className="mt-1 text-3xl font-bold font-mono text-emerald-400">{result.lotSize} lots</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Risk Amount</p>
                                <p className="font-mono text-sm font-bold text-rose-400">${result.actualRisk}</p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Risk:Reward</p>
                                <p className={cn("font-mono text-sm font-bold", result.riskReward >= 2 ? "text-emerald-400" : result.riskReward >= 1 ? "text-amber-400" : "text-rose-400")}>1:{result.riskReward}</p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Stop Distance</p>
                                <p className="font-mono text-sm font-bold text-muted-foreground">{result.stopDistance}</p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Pips to SL</p>
                                <p className="font-mono text-sm font-bold text-muted-foreground">{result.pipDistance} pips</p>
                            </div>
                            {result.tpPips > 0 && (
                                <div className="rounded-lg bg-muted p-3">
                                    <p className="text-[9px] uppercase text-muted-foreground">Pips to TP</p>
                                    <p className="font-mono text-sm font-bold text-emerald-400/80">{result.tpPips} pips</p>
                                </div>
                            )}
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Est. Margin</p>
                                <p className="font-mono text-sm font-bold text-muted-foreground">${result.marginRequired}</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex h-40 items-center justify-center"><p className="text-xs text-muted-foreground">Enter trade parameters to calculate</p></div>
                )}
            </div>
        </div>
    );
}

function PipValueCalc() {
    const [instrument, setInstrument] = useState("EURUSD");
    const [lotSize, setLotSize] = useState("1");
    const [accountCurrency, setAccountCurrency] = useState("USD");

    const result = useMemo(() => {
        const lots = Number(lotSize) || 0;
        const inst = INSTRUMENTS[instrument];
        if (!lots || !inst) return null;

        const pipValuePerLot = inst.contractSize * inst.pipSize;
        const totalPipValue = pipValuePerLot * lots;

        return {
            pipValuePerLot: Number(pipValuePerLot.toFixed(2)),
            totalPipValue: Number(totalPipValue.toFixed(2)),
            contractSize: inst.contractSize,
        };
    }, [instrument, lotSize]);

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Coins size={15} className="text-violet-400" /> Parameters</h2>
                <div className="space-y-3">
                    <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Instrument</label>
                        <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition">
                            {Object.keys(INSTRUMENTS).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lot Size</label>
                            <input type="number" step="0.01" min="0.01" value={lotSize} onChange={(e) => setLotSize(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Account Currency</label>
                            <select value={accountCurrency} onChange={(e) => setAccountCurrency(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition">
                                {["USD", "EUR", "GBP", "JPY"].map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Result</h2>
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 p-5 text-center border border-violet-500/20">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pip Value (1 lot)</p>
                            <p className="mt-1 text-3xl font-bold font-mono text-foreground">${result.pipValuePerLot}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Total for {lotSize} lots</p>
                                <p className="font-mono text-sm font-bold text-emerald-400">${result.totalPipValue}</p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Contract Size</p>
                                <p className="font-mono text-sm font-bold text-muted-foreground">{result.contractSize.toLocaleString()}</p>
                            </div>
                        </div>
                        <div className="rounded-lg bg-muted p-3">
                            <p className="text-[9px] uppercase text-muted-foreground">10 Pip Move Value</p>
                            <p className="font-mono text-sm font-bold text-amber-400">${(result.totalPipValue * 10).toFixed(2)}</p>
                        </div>
                    </div>
                ) : (
                    <div className="flex h-40 items-center justify-center"><p className="text-xs text-muted-foreground">Enter parameters to calculate</p></div>
                )}
            </div>
        </div>
    );
}

function MarginCalc() {
    const [instrument, setInstrument] = useState("EURUSD");
    const [lotSize, setLotSize] = useState("1");
    const [price, setPrice] = useState("");
    const [leverage, setLeverage] = useState("100");

    const result = useMemo(() => {
        const lots = Number(lotSize) || 0;
        const p = Number(price) || 0;
        const lev = Number(leverage) || 1;
        const inst = INSTRUMENTS[instrument];
        if (!lots || !p || !lev || !inst) return null;

        const notionalValue = lots * inst.contractSize * p;
        const marginRequired = notionalValue / lev;
        const marginPercent = (marginRequired / notionalValue) * 100;

        return {
            notionalValue: Number(notionalValue.toFixed(2)),
            marginRequired: Number(marginRequired.toFixed(2)),
            marginPercent: Number(marginPercent.toFixed(2)),
            leverage: lev,
        };
    }, [instrument, lotSize, price, leverage]);

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Calculator size={15} className="text-violet-400" /> Parameters</h2>
                <div className="space-y-3">
                    <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Instrument</label>
                        <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition">
                            {Object.keys(INSTRUMENTS).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lot Size</label>
                            <input type="number" step="0.01" min="0.01" value={lotSize} onChange={(e) => setLotSize(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Price</label>
                            <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none transition" />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Leverage</label>
                        <div className="grid grid-cols-4 gap-2">
                            {["10", "20", "50", "100", "200", "500"].map((l) => (
                                <button key={l} type="button" onClick={() => setLeverage(l)} className={cn("rounded-lg border px-3 py-2 text-xs font-medium transition", leverage === l ? "border-violet-500/40 bg-violet-500/10 text-violet-400" : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted/40")}>
                                    1:{l}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Result</h2>
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 p-5 text-center border border-violet-500/20">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Margin Required</p>
                            <p className="mt-1 text-3xl font-bold font-mono text-foreground">${result.marginRequired.toLocaleString()}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Notional Value</p>
                                <p className="font-mono text-sm font-bold text-muted-foreground">${result.notionalValue.toLocaleString()}</p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Leverage</p>
                                <p className="font-mono text-sm font-bold text-muted-foreground">1:{result.leverage}</p>
                            </div>
                        </div>
                        <div className="rounded-lg bg-muted p-3">
                            <p className="text-[9px] uppercase text-muted-foreground">Margin %</p>
                            <p className="font-mono text-sm font-bold text-amber-400">{result.marginPercent}%</p>
                        </div>
                    </div>
                ) : (
                    <div className="flex h-40 items-center justify-center"><p className="text-xs text-muted-foreground">Enter parameters to calculate</p></div>
                )}
            </div>
        </div>
    );
}

function SwapCalc() {
    const [instrument, setInstrument] = useState("EURUSD");
    const [lotSize, setLotSize] = useState("1");
    const [daysHeld, setDaysHeld] = useState("7");
    const [direction, setDirection] = useState<"long" | "short">("long");

    const SWAP_RATES: Record<string, { long: number; short: number }> = {
        EURUSD: { long: -0.5, short: 0.3 },
        GBPUSD: { long: -0.8, short: 0.1 },
        USDJPY: { long: 0.2, short: -0.9 },
        XAUUSD: { long: -2.5, short: 1.8 },
        BTCUSD: { long: -15, short: 5 },
        ETHUSD: { long: -8, short: 2 },
        US30: { long: -3, short: 0.5 },
        NAS100: { long: -2, short: 0.3 },
        AUDUSD: { long: -0.4, short: 0.2 },
        USDCAD: { long: 0.1, short: -0.6 },
        USDCHF: { long: 0.3, short: -0.7 },
        NZDUSD: { long: -0.3, short: 0.1 },
        EURGBP: { long: -0.6, short: 0.1 },
        EURJPY: { long: -0.3, short: -0.6 },
        GBPJPY: { long: -0.6, short: -0.3 },
    };

    const result = useMemo(() => {
        const lots = Number(lotSize) || 0;
        const days = Number(daysHeld) || 0;
        const swap = SWAP_RATES[instrument];
        if (!lots || !days || !swap) return null;

        const swapPerDay = swap[direction] * lots;
        const totalSwap = swapPerDay * days;
        const tripleSwapDays = Math.floor(days / 7);

        return {
            swapPerDay: Number(swapPerDay.toFixed(2)),
            totalSwap: Number(totalSwap.toFixed(2)),
            tripleSwapDays,
            direction,
            rate: swap[direction],
        };
    }, [instrument, lotSize, daysHeld, direction]);

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Clock size={15} className="text-violet-400" /> Parameters</h2>
                <div className="space-y-3">
                    <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Instrument</label>
                        <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition">
                            {Object.keys(SWAP_RATES).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lot Size</label>
                            <input type="number" step="0.01" min="0.01" value={lotSize} onChange={(e) => setLotSize(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Days Held</label>
                            <input type="number" min="1" value={daysHeld} onChange={(e) => setDaysHeld(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/40 px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none transition" />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Direction</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setDirection("long")} className={cn("rounded-xl border px-4 py-3 text-sm font-medium transition", direction === "long" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-border/30 bg-muted/50 text-muted-foreground")}>
                                Long (Buy)
                            </button>
                            <button type="button" onClick={() => setDirection("short")} className={cn("rounded-xl border px-4 py-3 text-sm font-medium transition", direction === "short" ? "border-rose-500/40 bg-rose-500/10 text-rose-400" : "border-border/30 bg-muted/50 text-muted-foreground")}>
                                Short (Sell)
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Result</h2>
                {result ? (
                    <div className="space-y-3">
                        <div className={cn("rounded-xl p-5 text-center border", result.totalSwap >= 0 ? "bg-emerald-500/[0.06] border-emerald-500/20" : "bg-rose-500/[0.06] border-rose-500/20")}>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Swap Cost</p>
                            <p className={cn("mt-1 text-3xl font-bold font-mono", result.totalSwap >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                {result.totalSwap >= 0 ? "+" : ""}${result.totalSwap}
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Swap/Day</p>
                                <p className={cn("font-mono text-sm font-bold", result.swapPerDay >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {result.swapPerDay >= 0 ? "+" : ""}${result.swapPerDay}
                                </p>
                            </div>
                            <div className="rounded-lg bg-muted p-3">
                                <p className="text-[9px] uppercase text-muted-foreground">Rate (points)</p>
                                <p className="font-mono text-sm font-bold text-muted-foreground">{result.rate}</p>
                            </div>
                        </div>
                        <div className="rounded-lg bg-amber-500/[0.04] border border-amber-500/10 p-3">
                            <p className="text-[10px] text-amber-400/70">
                                <Info size={10} className="mr-1 inline" />
                                Triple swap charged on Wednesday night for forex, Friday for commodities. Actual rates vary by broker.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="flex h-40 items-center justify-center"><p className="text-xs text-muted-foreground">Enter parameters to calculate</p></div>
                )}
            </div>
        </div>
    );
}
