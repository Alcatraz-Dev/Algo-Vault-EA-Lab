"use client";

import { useState, useMemo } from "react";
import { DollarSign, Crown, Sparkles, ArrowUpRight, Info } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { cn } from "@/lib/utils";
import Link from "next/link";

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

/**
 * Broker Fee Calculator — Lite.
 *
 * Free: read-only broker fee table with a simple total-cost projection.
 * Pro: side-by-side cost projection at your trade size, account-aware
 *      ranking, broker shortlist, rollover/swap comparison.
 */

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

    const inputClass =
        "w-full rounded-md border border-border/40 bg-muted/40 px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none";

    return (
        <ToolPageShell
            title="Broker Fee Calculator"
            description="Compare total trading costs across brokers for a single trade. Pro adds account-aware ranking, side-by-side projection and saved broker shortlist."
            badge="lite"
            icon={DollarSign}
            backHref="/tools"
            proHeadline="Pro adds account-aware ranking: rank brokers by what you'd actually pay at your volume."
            proFeatures={[
                "Side-by-side cost projection per trade size",
                "Account-aware ranking (your volume / pairs)",
                "Save broker shortlist",
                "Rollover / swap comparison",
            ]}
        >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border bg-card p-4">
                    <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Instrument</label>
                    <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className={inputClass}>
                        {Object.keys(pipValues).map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                    <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Lots</label>
                    <input type="number" step="0.01" min="0.01" value={lots} onChange={(e) => setLots(e.target.value)} className={inputClass} />
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                    <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Days Held</label>
                    <input type="number" min="1" value={daysHeld} onChange={(e) => setDaysHeld(e.target.value)} className={inputClass} />
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                    <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Direction</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setDirection("long")} className={cn("rounded-md px-3 py-2 text-xs font-medium transition", direction === "long" ? "bg-positive/20 text-positive" : "bg-muted text-muted-foreground")}>Long</button>
                        <button type="button" onClick={() => setDirection("short")} className={cn("rounded-md px-3 py-2 text-xs font-medium transition", direction === "short" ? "bg-negative/20 text-negative" : "bg-muted text-muted-foreground")}>Short</button>
                    </div>
                </div>
            </div>

            <div className="flex gap-2">
                {(["total", "spread", "commission"] as const).map((s) => (
                    <button
                        key={s}
                        type="button"
                        onClick={() => setSortBy(s)}
                        className={cn(
                            "rounded-md px-4 py-2 text-xs font-medium transition-all",
                            sortBy === s ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
                        )}
                    >
                        Sort by {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                ))}
            </div>

            <div className="space-y-3">
                {results.map((r, i) => (
                    <div
                        key={r.name}
                        className={cn(
                            "rounded-lg border p-5 transition-all",
                            i === 0 ? "border-positive/20 bg-positive/[0.03]" : "border-border bg-card",
                        )}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className={cn("flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold", i === 0 ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground")}>
                                    #{i + 1}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-foreground">{r.name}</span>
                                        {i === 0 && <span className="rounded-md bg-positive/20 px-2 py-0.5 text-micro font-semibold text-positive">CHEAPEST</span>}
                                    </div>
                                    <p className="text-micro text-muted-foreground">Leverage: 1:{r.leverage}</p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-6">
                                <div className="text-right">
                                    <p className="text-micro uppercase text-muted-foreground">Spread</p>
                                    <p className="font-mono text-sm font-bold text-muted-foreground">${r.spreadCost}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-micro uppercase text-muted-foreground">Commission</p>
                                    <p className="font-mono text-sm font-bold text-muted-foreground">${r.commission}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-micro uppercase text-muted-foreground">Swap ({daysHeld}d)</p>
                                    <p className="font-mono text-sm font-bold text-muted-foreground">${r.swapCost}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-micro uppercase text-muted-foreground">Total</p>
                                    <p className={cn("font-mono text-lg font-bold", i === 0 ? "text-positive" : "text-foreground")}>${r.total}</p>
                                </div>
                                {cheapest > 0 && r.total > cheapest && (
                                    <div className="text-right">
                                        <p className="text-micro uppercase text-muted-foreground">Extra</p>
                                        <p className="font-mono text-sm font-bold text-negative">+${(r.total - cheapest).toFixed(2)}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="rounded-lg border border-warning/15 bg-warning/[0.04] p-3 text-xs text-warning">
                <Info size={12} className="mr-1 inline" />
                Costs are estimates based on typical spread/commission values. Actual costs vary by account type, volume, and market conditions.
            </div>

            {/* Pro upsell row */}
            <div className="grid gap-3 md:grid-cols-3">
                <ProTile
                    title="Account-Aware Ranking"
                    description="Rank by what you'd actually pay at your volume and pair mix."
                />
                <ProTile
                    title="Save Shortlist"
                    description="Pin the brokers you use and see their live ranking on one screen."
                />
                <ProTile
                    title="Rollover / Swap Compare"
                    description="Side-by-side swap costs across brokers for long and short positions."
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