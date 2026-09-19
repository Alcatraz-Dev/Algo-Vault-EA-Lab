"use client";

import { AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { LiquidityLevel, LiquiditySweep } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    levels: LiquidityLevel[];
    sweeps: LiquiditySweep[];
    currentPrice: number;
};

function formatLevelType(type: string): string {
    return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function getStrengthColor(strength: number): string {
    if (strength >= 80) return "text-rose-400";
    if (strength >= 60) return "text-amber-400";
    return "text-muted-foreground";
}

export default function LiquidityMap({ levels, sweeps, currentPrice }: Props) {
    const sortedLevels = [...levels].sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));

    return (
        <div className="space-y-3">
            {sweeps.length > 0 && (
                <div className="space-y-1.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Recent Sweeps</h4>
                    {sweeps.slice(-3).reverse().map((sweep) => (
                        <div key={sweep.id} className="flex items-center gap-2 rounded-lg bg-amber-500/[0.06] px-2.5 py-1.5 text-xs">
                            <AlertTriangle size={12} className="text-amber-400" />
                            <span className="font-medium text-amber-400">{sweep.side === "buy_side" ? "Buy Sweep" : "Sell Sweep"}</span>
                            <span className="font-mono text-muted-foreground">{sweep.level.toFixed(sweep.level >= 100 ? 2 : 5)}</span>
                            <span className="text-foreground/50">→ {sweep.sweepPrice.toFixed(sweep.sweepPrice >= 100 ? 2 : 5)}</span>
                            {sweep.confirmed && <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] text-amber-400">Confirmed</span>}
                        </div>
                    ))}
                </div>
            )}

            <div className="space-y-1.5">
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-foreground/70">Liquidity Levels</h4>
                {sortedLevels.length === 0 && (
                    <p className="py-3 text-center text-xs text-foreground/50">No liquidity levels detected</p>
                )}
                {sortedLevels.slice(0, 8).map((level) => {
                    const distance = Math.abs(level.price - currentPrice);
                    const distancePercent = (distance / currentPrice) * 100;
                    const isAbove = level.price > currentPrice;

                    return (
                        <div key={level.id} className="flex items-center gap-2 rounded-lg bg-foreground/4 px-2.5 py-1.5 text-xs">
                            {isAbove ? <TrendingUp size={11} className="text-foreground/70" /> : <TrendingDown size={11} className="text-foreground/70" />}
                            <span className="flex-1 text-muted-foreground">{formatLevelType(level.type)}</span>
                            <span className="font-mono text-foreground/70">{level.price.toFixed(level.price >= 100 ? 2 : 5)}</span>
                            <span className={cn("font-mono text-[10px]", getStrengthColor(level.strength))}>{level.strength}</span>
                            <span className="text-[10px] text-foreground/50">{distancePercent.toFixed(2)}%</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
