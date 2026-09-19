"use client";

import { TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import { RegimeData, MarketRegime } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    regime: RegimeData;
};

function getRegimeConfig(regime: MarketRegime) {
    switch (regime) {
        case "trending_bullish": return { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: TrendingUp };
        case "trending_bearish": return { color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", icon: TrendingDown };
        case "ranging": return { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", icon: Minus };
        case "breakout": return { color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", icon: Zap };
        case "high_volatility": return { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", icon: Zap };
        case "low_volatility": return { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", icon: Minus };
        default: return { color: "text-muted-foreground", bg: "bg-muted/10", border: "border-border/30", icon: Minus };
    }
}

export default function MarketRegimePanel({ regime }: Props) {
    const config = getRegimeConfig(regime.regime);
    const Icon = config.icon;

    return (
        <div className="space-y-3">
            <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", config.bg, config.border)}>
                <Icon size={14} className={config.color} />
                <span className={cn("text-sm font-semibold", config.color)}>
                    {regime.regime.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                </span>
            </div>

            <div className="rounded-lg bg-foreground/4 p-2.5">
                <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Confidence</p>
                    <p className={cn("font-mono text-xs font-medium", config.color)}>{regime.confidence}%</p>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                    <div
                        className={cn("h-full rounded-full transition-all", regime.regime.includes("bullish") ? "bg-emerald-500" : regime.regime.includes("bearish") ? "bg-rose-500" : "bg-violet-500")}
                        style={{ width: `${regime.confidence}%` }}
                    />
                </div>
            </div>

            {regime.factors.length > 0 && (
                <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Factors</p>
                    {regime.factors.map((factor, i) => (
                        <div key={i} className="flex items-center gap-2 rounded bg-foreground/3 px-2 py-1 text-[11px] text-muted-foreground">
                            <span className="h-1 w-1 rounded-full bg-muted" />
                            {factor}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
