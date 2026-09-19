"use client";

import { Zap, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { VolatilityData } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    volatility: VolatilityData;
};

function getStateConfig(state: string) {
    switch (state) {
        case "extreme": return { color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Extreme" };
        case "high": return { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", label: "High" };
        case "low": return { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Low" };
        default: return { color: "text-muted-foreground", bg: "bg-muted/10", border: "border-border/30", label: "Normal" };
    }
}

export default function VolatilityPanel({ volatility }: Props) {
    const config = getStateConfig(volatility.state);

    return (
        <div className="space-y-3">
            <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", config.bg, config.border)}>
                <Zap size={14} className={config.color} />
                <span className={cn("text-sm font-semibold", config.color)}>{config.label} Volatility</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">ATR</p>
                    <p className="mt-1 font-mono text-sm text-foreground/70">{volatility.atr.toFixed(volatility.atr >= 100 ? 2 : 5)}</p>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">ATR %</p>
                    <p className={cn("mt-1 font-mono text-sm font-medium", config.color)}>{volatility.atrPercent.toFixed(3)}%</p>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Range Change</p>
                    <div className="mt-1 flex items-center gap-1">
                        {volatility.rangeExpansion > 0 ? <TrendingUp size={11} className="text-emerald-400" /> : volatility.rangeExpansion < 0 ? <TrendingDown size={11} className="text-rose-400" /> : <Minus size={11} className="text-muted-foreground" />}
                        <p className={cn("font-mono text-sm", volatility.rangeExpansion > 0 ? "text-emerald-400" : volatility.rangeExpansion < 0 ? "text-rose-400" : "text-muted-foreground")}>
                            {volatility.rangeExpansion > 0 ? "+" : ""}{volatility.rangeExpansion.toFixed(1)}%
                        </p>
                    </div>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Lookback</p>
                    <p className="mt-1 font-mono text-sm text-muted-foreground">{volatility.lookbackPeriods} periods</p>
                </div>
            </div>
        </div>
    );
}
