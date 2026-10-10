"use client";

import {
    TrendingUp,
    TrendingDown,
    Minus,
    BarChart3,
    Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/ai-signals/symbol-specs";

type SentimentItem = {
    symbol: string;
    direction: "BUY" | "SELL" | "NEUTRAL";
    confidence: number;
    signalCount: number;
};

type Props = {
    sentiments: SentimentItem[];
    /** Live prices keyed by symbol (5s polling); symbols without a quote show nothing rather than fake data. */
    prices?: Record<string, number>;
};

function directionConfig(direction: SentimentItem["direction"]) {
    switch (direction) {
        case "BUY":
            return {
                label: "BUY",
                color: "text-positive",
                bg: "bg-positive/10",
                border: "border-positive/30",
                icon: TrendingUp,
            };
        case "SELL":
            return {
                label: "SELL",
                color: "text-negative",
                bg: "bg-negative/10",
                border: "border-negative/30",
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

export default function MarketOverview({ sentiments, prices }: Props) {
    const sorted = [...sentiments].sort((a, b) => b.confidence - a.confidence);

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
            {/* Header */}
            <div className="border-b border-border px-4 py-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Market Sentiment
                    </h3>
                    <span className="text-micro text-foreground/50">{sorted.length} symbols</span>
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
                                            "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-micro font-bold",
                                            dir.bg,
                                            dir.border,
                                            dir.color
                                        )}
                                    >
                                        <DirIcon size={8} />
                                        {dir.label}
                                    </span>
                                </div>

                                {/* Live price (real quote from the shared resolver; hidden when unavailable) */}
                                {prices && (() => {
                                    const live = prices[item.symbol];
                                    if (live == null || !Number.isFinite(live) || live <= 0) return null;
                                    return (
                                        <div className="flex items-center gap-1">
                                            <Activity size={9} className="text-muted-foreground" />
                                            <span className="font-numeric text-micro font-bold text-foreground">
                                                {formatPrice(live, item.symbol)}
                                            </span>
                                        </div>
                                    );
                                })()}

                                {/* Confidence Bar */}
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-micro text-foreground/50">Confidence</span>
                                        <span className={cn("font-numeric text-micro font-bold", dir.color)}>
                                            {item.confidence}%
                                        </span>
                                    </div>
                                    <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
                                        <div
                                            className={cn(
                                                "h-full rounded-full transition-all",
                                                item.direction === "BUY"
                                                    ? "bg-positive"
                                                    : item.direction === "SELL"
                                                    ? "bg-negative"
                                                    : "bg-muted"
                                            )}
                                            style={{ width: `${item.confidence}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Signal Count */}
                                <div className="flex items-center gap-1 text-micro text-foreground/50">
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
