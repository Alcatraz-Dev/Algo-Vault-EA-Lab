"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { VolumeData } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    volume: VolumeData;
};

export default function VolumePanel({ volume }: Props) {
    const getStateIcon = () => {
        if (volume.state === "expanded") return <TrendingUp size={14} className="text-emerald-400" />;
        if (volume.state === "contracted") return <TrendingDown size={14} className="text-rose-400" />;
        return <Minus size={14} className="text-muted-foreground" />;
    };

    const getStateColor = () => {
        if (volume.state === "expanded") return "text-emerald-400";
        if (volume.state === "contracted") return "text-rose-400";
        return "text-muted-foreground";
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                {getStateIcon()}
                <span className={cn("text-sm font-semibold capitalize", getStateColor())}>{volume.state}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Current</p>
                    <p className="mt-1 font-mono text-sm text-foreground/70">{volume.volume.toLocaleString()}</p>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Average</p>
                    <p className="mt-1 font-mono text-sm text-foreground/70">{volume.averageVolume.toLocaleString()}</p>
                </div>
                <div className="col-span-2 rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Relative Volume</p>
                    <div className="mt-1 flex items-baseline gap-2">
                        <p className={cn("font-mono text-lg font-bold", volume.relativeVolume > 1.5 ? "text-emerald-400" : volume.relativeVolume < 0.5 ? "text-rose-400" : "text-foreground/70")}>
                            {volume.relativeVolume.toFixed(2)}x
                        </p>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                            <div
                                className={cn("h-full rounded-full transition-all", volume.relativeVolume > 1.5 ? "bg-emerald-500" : volume.relativeVolume < 0.5 ? "bg-rose-500" : "bg-muted")}
                                style={{ width: `${Math.min(100, volume.relativeVolume * 50)}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {volume.isTickVolume && (
                <p className="rounded-lg bg-amber-500/[0.06] px-2.5 py-1.5 text-[10px] text-amber-400">
                    Tick Volume — Not exchange volume
                </p>
            )}
        </div>
    );
}
