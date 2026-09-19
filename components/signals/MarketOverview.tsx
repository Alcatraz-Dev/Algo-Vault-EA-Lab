"use client";

import {
    TrendingUp,
    TrendingDown,
    Minus,
    BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SentimentItem = {
    symbol: string;
    direction: "BUY" | "SELL" | "NEUTRAL";
    confidence: number;
    signalCount: number;
};

type Props = {
    sentiments: SentimentItem[];
};

function directionConfig(direction: SentimentItem["direction"]) {
    switch (direction) {
        case "BUY":
            return {
                label: "BUY",
                color: "text-emerald-400",
                bg: "bg-emerald-500/10",
                border: "border-emerald-500/20",
                icon: TrendingUp,
            };
        case "SELL":
            return {
                label: "SELL",
                color: "text-rose-400",
                bg: "bg-rose-500/10",
                border: "border-rose-500/20",
                icon: TrendingDown,
            };
        case "NEUTRAL":
            return {
                label: "NEUTRAL",
                color: "text-muted-foreground",
                bg: "bg-muted/10",
                border: "border-border/30",
                icon: Minus,
            };
    }
}

export default function MarketOverview({ sentiments }: Props) {
    const sorted = [...sentiments].sort((a, b) => b.confidence - a.confidence);

    return (
        <div className="rounded-2xl border border-border/20 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl overflow-hidden">
            {/* Header with gradient */}
            <div className="border-b border-border/10 bg-gradient-to-r from-amber-500/5 via-transparent to-blue-500/5 px-4 py-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Market Sentiment
                    </h3>
                    <span className="text-[10px] text-foreground/50">{sorted.length} symbols</span>
                </div>
            </div>

            {/* Grid */}
            {sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                    <Minus size={20} className="mb-2 text-foreground/50" />
                    <p className="text-xs text-foreground/50">No sentiment data</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-px bg-border/20 sm:grid-cols-3 lg:grid-cols-4">
                    {sorted.map((item) => {
                        const dir = directionConfig(item.direction);
                        const DirIcon = dir.icon;

                        return (
                            <div
                                key={item.symbol}
                                className="flex flex-col gap-2 bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                            >
                                {/* Symbol + Badge */}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold tracking-tight text-foreground">
                                        {item.symbol}
                                    </span>
                                    <span
                                        className={cn(
                                            "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold",
                                            dir.bg,
                                            dir.border,
                                            dir.color
                                        )}
                                    >
                                        <DirIcon size={8} />
                                        {dir.label}
                                    </span>
                                </div>

                                {/* Confidence Bar */}
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[9px] text-foreground/50">Confidence</span>
                                        <span className={cn("font-mono text-[10px] font-bold", dir.color)}>
                                            {item.confidence}%
                                        </span>
                                    </div>
                                    <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
                                        <div
                                            className={cn(
                                                "h-full rounded-full transition-all",
                                                item.direction === "BUY"
                                                    ? "bg-emerald-500"
                                                    : item.direction === "SELL"
                                                    ? "bg-rose-500"
                                                    : "bg-muted"
                                            )}
                                            style={{ width: `${item.confidence}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Signal Count */}
                                <div className="flex items-center gap-1 text-[10px] text-foreground/50">
                                    <BarChart3 size={9} />
                                    <span>
                                        {item.signalCount} signal{item.signalCount !== 1 ? "s" : ""}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
