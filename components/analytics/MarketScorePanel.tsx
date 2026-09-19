"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { MarketScore } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    score: MarketScore;
};

function getBiasConfig(bias: string) {
    switch (bias) {
        case "bullish": return { color: "text-emerald-400", bg: "bg-emerald-500/10", ring: "text-emerald-500" };
        case "bearish": return { color: "text-rose-400", bg: "bg-rose-500/10", ring: "text-rose-500" };
        default: return { color: "text-muted-foreground", bg: "bg-muted/10", ring: "text-foreground/70" };
    }
}

export default function MarketScorePanel({ score }: Props) {
    const config = getBiasConfig(score.bias);

    return (
        <div className="space-y-3">
            {/* Score circle */}
            <div className="flex items-center gap-4">
                <div className="relative h-20 w-20 shrink-0">
                    <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="4" className="text-foreground/[0.05]" />
                        <circle
                            cx="40" cy="40" r="34" fill="none" strokeWidth="4"
                            strokeDasharray={`${(score.total / 100) * 213.6} 213.6`}
                            strokeLinecap="round"
                            className={cn("transition-all duration-500", config.ring)}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={cn("text-lg font-bold", config.color)}>{score.total}</span>
                        <span className="text-[8px] text-foreground/50">/ 100</span>
                    </div>
                </div>
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        {score.bias === "bullish" ? <TrendingUp size={14} className="text-emerald-400" /> : score.bias === "bearish" ? <TrendingDown size={14} className="text-rose-400" /> : <Minus size={14} className="text-muted-foreground" />}
                        <span className={cn("text-sm font-semibold uppercase", config.color)}>{score.bias}</span>
                    </div>
                    <p className="text-xs text-foreground/70">Confidence: <span className="text-foreground/70 capitalize">{score.confidence}</span></p>
                </div>
            </div>

            {/* Components */}
            <div className="space-y-1.5">
                {score.components.map((comp) => (
                    <div key={comp.name} className="flex items-center gap-2 text-xs">
                        <span className="w-16 text-foreground/70">{comp.name}</span>
                        <div className="flex-1">
                            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                                <div
                                    className={cn("h-full rounded-full", comp.direction === "bullish" ? "bg-emerald-500" : comp.direction === "bearish" ? "bg-rose-500" : "bg-muted")}
                                    style={{ width: `${Math.abs(comp.value) / comp.max * 100}%` }}
                                />
                            </div>
                        </div>
                        <span className={cn("w-8 text-right font-mono text-[10px]", comp.direction === "bullish" ? "text-emerald-400" : comp.direction === "bearish" ? "text-rose-400" : "text-foreground/70")}>
                            {comp.value > 0 ? "+" : ""}{comp.value}
                        </span>
                    </div>
                ))}
            </div>

            <p className="rounded-lg bg-amber-500/[0.04] px-2.5 py-1.5 text-[10px] text-amber-400/70">
                Analytical score — Not a trading guarantee
            </p>
        </div>
    );
}
