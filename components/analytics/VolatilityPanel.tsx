"use client";

import { Zap, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { VolatilityData } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    volatility: VolatilityData;
};

function getStateConfig(state: string) {
    switch (state) {
        case "extreme": return { color: "text-negative", bg: "bg-negative/10", border: "border-negative/20", label: "Extreme" };
        case "high": return { color: "text-warning", bg: "bg-warning/10", border: "border-warning/20", label: "High" };
        case "low": return { color: "text-info", bg: "bg-info/10", border: "border-info/20", label: "Low" };
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
                    <p className="text-micro font-semibold uppercase text-foreground/50">ATR</p>
                    <p className="mt-1 font-numeric text-sm text-foreground/70">{volatility.atr.toFixed(volatility.atr >= 100 ? 2 : 5)}</p>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-micro font-semibold uppercase text-foreground/50">ATR %</p>
                    <p className={cn("mt-1 font-numeric text-sm font-medium", config.color)}>{volatility.atrPercent.toFixed(3)}%</p>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-micro font-semibold uppercase text-foreground/50">Range Change</p>
                    <div className="mt-1 flex items-center gap-1">
                        {volatility.rangeExpansion > 0 ? <TrendingUp size={11} className="text-positive" /> : volatility.rangeExpansion < 0 ? <TrendingDown size={11} className="text-negative" /> : <Minus size={11} className="text-muted-foreground" />}
                        <p className={cn("font-numeric text-sm", volatility.rangeExpansion > 0 ? "text-positive" : volatility.rangeExpansion < 0 ? "text-negative" : "text-muted-foreground")}>
                            {volatility.rangeExpansion > 0 ? "+" : ""}{volatility.rangeExpansion.toFixed(1)}%
                        </p>
                    </div>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-micro font-semibold uppercase text-foreground/50">Lookback</p>
                    <p className="mt-1 font-numeric text-sm text-muted-foreground">{volatility.lookbackPeriods} periods</p>
                </div>
            </div>
        </div>
    );
}
