"use client";

import { TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import { RegimeData, MarketRegime } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    regime: RegimeData;
};

function getRegimeConfig(regime: MarketRegime) {
    switch (regime) {
        case "trending_bullish": return { color: "text-positive", bg: "bg-positive/10", border: "border-positive/20", icon: TrendingUp };
        case "trending_bearish": return { color: "text-negative", bg: "bg-negative/10", border: "border-negative/20", icon: TrendingDown };
        case "ranging": return { color: "text-warning", bg: "bg-warning/10", border: "border-warning/20", icon: Minus };
        case "breakout": return { color: "text-chart-3", bg: "bg-chart-3/10", border: "border-chart-3/20", icon: Zap };
        case "high_volatility": return { color: "text-warning", bg: "bg-warning/10", border: "border-warning/20", icon: Zap };
        case "low_volatility": return { color: "text-info", bg: "bg-info/10", border: "border-info/20", icon: Minus };
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
                    <p className="text-micro font-semibold uppercase text-foreground/50">Confidence</p>
                    <p className={cn("font-mono text-xs font-medium", config.color)}>{regime.confidence}%</p>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                    <div
                        className={cn("h-full rounded-full transition-all", regime.regime.includes("bullish") ? "bg-positive" : regime.regime.includes("bearish") ? "bg-negative" : "bg-chart-3")}
                        style={{ width: `${regime.confidence}%` }}
                    />
                </div>
            </div>

            {regime.factors.length > 0 && (
                <div className="space-y-1">
                    <p className="text-micro font-semibold uppercase text-foreground/50">Factors</p>
                    {regime.factors.map((factor, i) => (
                        <div key={i} className="flex items-center gap-2 rounded bg-foreground/3 px-2 py-1 text-micro text-muted-foreground">
                            <span className="h-1 w-1 rounded-full bg-muted" />
                            {factor}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
