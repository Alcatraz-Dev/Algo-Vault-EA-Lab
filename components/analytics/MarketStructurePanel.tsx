"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { MarketStructureEvent } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    events: MarketStructureEvent[];
};

function getBias(events: MarketStructureEvent[]): "bullish" | "bearish" | "neutral" {
    const recent = events.filter((e) => e.type === "BOS" || e.type === "CHOCH").slice(-5);
    if (recent.length === 0) return "neutral";
    const b = recent.filter((e) => e.direction === "bullish").length;
    const s = recent.filter((e) => e.direction === "bearish").length;
    if (b > s) return "bullish";
    if (s > b) return "bearish";
    return "neutral";
}

export default function MarketStructurePanel({ events }: Props) {
    const bias = useMemo(() => getBias(events), [events]);
    const bosCount = events.filter((e) => e.type === "BOS").length;
    const chochCount = events.filter((e) => e.type === "CHOCH").length;
    const recentEvents = events.slice(-8).reverse();

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {bias === "bullish" ? <TrendingUp size={14} className="text-emerald-400" /> : bias === "bearish" ? <TrendingDown size={14} className="text-rose-400" /> : <Minus size={14} className="text-muted-foreground" />}
                    <span className={cn("text-sm font-semibold", bias === "bullish" ? "text-emerald-400" : bias === "bearish" ? "text-rose-400" : "text-muted-foreground")}>
                        {bias.toUpperCase()}
                    </span>
                </div>
                <div className="flex gap-2 text-[10px] text-foreground/70">
                    <span>BOS: {bosCount}</span>
                    <span>CHoCH: {chochCount}</span>
                </div>
            </div>

            <div className="space-y-1">
                {recentEvents.length === 0 && (
                    <p className="py-4 text-center text-xs text-foreground/50">No structure events detected</p>
                )}
                {recentEvents.map((event) => (
                    <div
                        key={event.id}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs",
                            event.type === "BOS" ? "bg-foreground/4" : "bg-violet-500/[0.04]"
                        )}
                    >
                        {event.direction === "bullish" ? (
                            <ArrowUpRight size={12} className="text-emerald-400" />
                        ) : (
                            <ArrowDownRight size={12} className="text-rose-400" />
                        )}
                        <span className={cn("font-medium", event.direction === "bullish" ? "text-emerald-400" : "text-rose-400")}>
                            {event.type}
                        </span>
                        <span className="font-mono text-foreground/70">{event.price.toFixed(event.price >= 100 ? 2 : 5)}</span>
                        {event.brokenLevel && (
                            <span className="text-foreground/50">broke {event.brokenLevel.toFixed(event.brokenLevel >= 100 ? 2 : 5)}</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
