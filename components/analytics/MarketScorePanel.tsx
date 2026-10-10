"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { MarketScore } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    score: MarketScore;
};

function getBiasConfig(bias: string) {
    switch (bias) {
        case "bullish": return { color: "text-positive", bg: "bg-positive/10", ring: "text-positive" };
        case "bearish": return { color: "text-negative", bg: "bg-negative/10", ring: "text-negative" };
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
                        {score.bias === "bullish" ? <TrendingUp size={14} className="text-positive" /> : score.bias === "bearish" ? <TrendingDown size={14} className="text-negative" /> : <Minus size={14} className="text-muted-foreground" />}
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
                                    className={cn("h-full rounded-full", comp.direction === "bullish" ? "bg-positive" : comp.direction === "bearish" ? "bg-negative" : "bg-muted")}
                                    style={{ width: `${Math.abs(comp.value) / comp.max * 100}%` }}
                                />
                            </div>
                        </div>
                        <span className={cn("w-8 text-right font-numeric text-micro", comp.direction === "bullish" ? "text-positive" : comp.direction === "bearish" ? "text-negative" : "text-foreground/70")}>
                            {comp.value > 0 ? "+" : ""}{comp.value}
                        </span>
                    </div>
                ))}
            </div>

            <p className="rounded-lg bg-warning/[0.04] px-2.5 py-1.5 text-micro text-warning/70">
                Analytical score — Not a trading guarantee
            </p>
        </div>
    );
}
