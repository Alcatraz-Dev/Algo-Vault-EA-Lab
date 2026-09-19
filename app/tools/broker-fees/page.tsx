"use client";

import { useState, useMemo } from "react";
import { ArrowLeft, DollarSign, Calculator, TrendingDown, Info } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Broker = {
    name: string; spreadPips: number; commissionPerLot: number;
    swapLong: number; swapShort: number; leverage: number; pip: number;
};

const BROKERS: Broker[] = [
    { name: "IC Markets", spreadPips: 0.1, commissionPerLot: 7, swapLong: -0.5, swapShort: 0.3, leverage: 500, pip: 0.0001 },
    { name: "Pepperstone", spreadPips: 0.2, commissionPerLot: 7, swapLong: -0.4, swapShort: 0.2, leverage: 500, pip: 0.0001 },
    { name: "XM", spreadPips: 0.6, commissionPerLot: 0, swapLong: -0.5, swapShort: 0.3, leverage: 500, pip: 0.0001 },
    { name: "OANDA", spreadPips: 1.0, commissionPerLot: 0, swapLong: -0.6, swapShort: 0.2, leverage: 50, pip: 0.0001 },
    { name: "FXCM", spreadPips: 0.8, commissionPerLot: 0, swapLong: -0.5, swapShort: 0.1, leverage: 200, pip: 0.0001 },
    { name: "Exness", spreadPips: 0.1, commissionPerLot: 3.5, swapLong: -0.3, swapShort: 0.1, leverage: 2000, pip: 0.0001 },
    { name: "RoboForex", spreadPips: 0.4, commissionPerLot: 4, swapLong: -0.4, swapShort: 0.2, leverage: 1000, pip: 0.0001 },
];

export default function BrokerFeeCalcPage() {
    const [lots, setLots] = useState("1");
    const [daysHeld, setDaysHeld] = useState("7");
    const [direction, setDirection] = useState<"long" | "short">("long");
    const [instrument, setInstrument] = useState("EURUSD");
    const [sortBy, setSortBy] = useState<"total" | "spread" | "commission">("total");

    const pipValues: Record<string, { pip: number; contractSize: number }> = {
        EURUSD: { pip: 0.0001, contractSize: 100000 },
        GBPUSD: { pip: 0.0001, contractSize: 100000 },
        USDJPY: { pip: 0.01, contractSize: 100000 },
        XAUUSD: { pip: 0.01, contractSize: 100 },
        BTCUSD: { pip: 0.01, contractSize: 1 },
    };

    const results = useMemo(() => {
        const l = Number(lots) || 1;
        const d = Number(daysHeld) || 1;
        const inst = pipValues[instrument] || pipValues.EURUSD;

        return BROKERS.map((b) => {
            const spreadCost = b.spreadPips * inst.pip * inst.contractSize * l;
            const commission = b.commissionPerLot * l;
            const swapRate = direction === "long" ? b.swapLong : b.swapShort;
            const swapCost = Math.abs(swapRate * l * d);
            const total = spreadCost + commission + swapCost;

            return {
                ...b,
                spreadCost: Number(spreadCost.toFixed(2)),
                commission: Number(commission.toFixed(2)),
                swapCost: Number(swapCost.toFixed(2)),
                total: Number(total.toFixed(2)),
            };
        }).sort((a, b) => {
            if (sortBy === "spread") return a.spreadCost - b.spreadCost;
            if (sortBy === "commission") return a.commission - b.commission;
            return a.total - b.total;
        });
    }, [lots, daysHeld, direction, instrument, sortBy]);

    const cheapest = results[0]?.total || 0;

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
                    <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Broker Fee Calculator</h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">Compare total trading costs across brokers</p>
                </div>

                {/* Inputs */}
                <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Instrument</label>
                        <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                            {Object.keys(pipValues).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lots</label>
                        <input type="number" step="0.01" min="0.01" value={lots} onChange={(e) => setLots(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                    </div>
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Days Held</label>
                        <input type="number" min="1" value={daysHeld} onChange={(e) => setDaysHeld(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                    </div>
                    <div className="rounded-xl border border-border/30 bg-muted/50 p-4">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Direction</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setDirection("long")} className={cn("rounded-lg px-3 py-2 text-xs font-medium transition", direction === "long" ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground")}>Long</button>
                            <button type="button" onClick={() => setDirection("short")} className={cn("rounded-lg px-3 py-2 text-xs font-medium transition", direction === "short" ? "bg-rose-500/20 text-rose-400" : "bg-muted text-muted-foreground")}>Short</button>
                        </div>
                    </div>
                </div>

                {/* Sort */}
                <div className="mb-4 flex gap-2">
                    {(["total", "spread", "commission"] as const).map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setSortBy(s)}
                            className={cn(
                                "rounded-xl px-4 py-2 text-xs font-medium transition-all",
                                sortBy === s ? "bg-violet-600 text-foreground" : "text-muted-foreground hover:text-muted-foreground bg-muted"
                            )}
                        >
                            Sort by {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Results */}
                <div className="space-y-3">
                    {results.map((r, i) => (
                        <div
                            key={r.name}
                            className={cn(
                                "rounded-2xl border p-5 transition-all",
                                i === 0 ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-border/30 bg-muted/50"
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold", i === 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/20 text-muted-foreground")}>
                                        #{i + 1}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold text-foreground">{r.name}</span>
                                            {i === 0 && <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[9px] font-semibold text-emerald-400">CHEAPEST</span>}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">Leverage: 1:{r.leverage}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    <div className="text-right">
                                        <p className="text-[9px] uppercase text-muted-foreground">Spread Cost</p>
                                        <p className="font-mono text-sm font-bold text-muted-foreground">${r.spreadCost}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] uppercase text-muted-foreground">Commission</p>
                                        <p className="font-mono text-sm font-bold text-muted-foreground">${r.commission}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] uppercase text-muted-foreground">Swap ({daysHeld}d)</p>
                                        <p className="font-mono text-sm font-bold text-muted-foreground">${r.swapCost}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] uppercase text-muted-foreground">Total Cost</p>
                                        <p className={cn("font-mono text-lg font-bold", i === 0 ? "text-emerald-400" : "text-foreground")}>${r.total}</p>
                                    </div>
                                    {cheapest > 0 && r.total > cheapest && (
                                        <div className="text-right">
                                            <p className="text-[9px] uppercase text-muted-foreground">Extra</p>
                                            <p className="font-mono text-sm font-bold text-rose-400">+${(r.total - cheapest).toFixed(2)}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-6 rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-3 text-[11px] text-amber-400/60">
                    <Info size={12} className="mr-1 inline" />
                    Costs are estimates based on typical spread/commission values. Actual costs vary by account type, volume, and market conditions.
                </div>
            </div>
        </div>
    );
}
