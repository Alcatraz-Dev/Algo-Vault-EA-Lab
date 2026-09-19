"use client";

import { Activity, TrendingUp, TrendingDown } from "lucide-react";
import { VWAPData } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    vwap: VWAPData;
    currentPrice: number;
};

export default function VWAPPanel({ vwap, currentPrice }: Props) {
    const position = currentPrice > vwap.vwap ? "above" : currentPrice < vwap.vwap ? "below" : "at";

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <Activity size={14} className="text-violet-400" />
                <span className="text-sm font-semibold text-foreground/70">VWAP</span>
                <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-400">{vwap.period}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 rounded-lg bg-violet-500/[0.06] p-3">
                    <p className="text-[10px] font-semibold uppercase text-violet-300/60">VWAP Level</p>
                    <p className="mt-1 font-mono text-lg font-bold text-violet-400">{vwap.vwap.toFixed(vwap.vwap >= 100 ? 2 : 5)}</p>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Distance</p>
                    <p className={cn("mt-1 font-mono text-sm font-medium", position === "above" ? "text-emerald-400" : position === "below" ? "text-rose-400" : "text-muted-foreground")}>
                        {vwap.distance >= 0 ? "+" : ""}{vwap.distance.toFixed(vwap.distance >= 100 ? 2 : 5)}
                    </p>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Distance %</p>
                    <p className={cn("mt-1 font-mono text-sm font-medium", position === "above" ? "text-emerald-400" : position === "below" ? "text-rose-400" : "text-muted-foreground")}>
                        {vwap.distancePercent >= 0 ? "+" : ""}{vwap.distancePercent.toFixed(3)}%
                    </p>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Upper Band</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{vwap.upperBand1.toFixed(vwap.upperBand1 >= 100 ? 2 : 5)}</p>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Lower Band</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{vwap.lowerBand1.toFixed(vwap.lowerBand1 >= 100 ? 2 : 5)}</p>
                </div>
            </div>

            <div className="flex items-center gap-2 rounded-lg bg-foreground/4 px-2.5 py-2">
                {position === "above" ? <TrendingUp size={13} className="text-emerald-400" /> : position === "below" ? <TrendingDown size={13} className="text-rose-400" /> : null}
                <span className="text-xs text-muted-foreground">
                    Price is <span className={cn("font-medium", position === "above" ? "text-emerald-400" : position === "below" ? "text-rose-400" : "text-muted-foreground")}>{position}</span> VWAP
                </span>
            </div>
        </div>
    );
}
