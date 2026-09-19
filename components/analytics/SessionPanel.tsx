"use client";

import { Clock, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

type SessionInfo = {
    current: string;
    name: string;
    high: number;
    low: number;
    range: number;
};

type Props = {
    session: SessionInfo;
    currentPrice: number;
};

function getSessionColor(name: string): string {
    if (name === "London") return "text-blue-400 bg-blue-500/10 border-blue-500/20";
    if (name === "New York") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    if (name === "Asian") return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    if (name.includes("Overlap")) return "text-violet-400 bg-violet-500/10 border-violet-500/20";
    return "text-muted-foreground bg-muted/10 border-border/30";
}

export default function SessionPanel({ session, currentPrice }: Props) {
    const positionInRange = session.range > 0
        ? ((currentPrice - session.low) / session.range) * 100
        : 50;

    return (
        <div className="space-y-3">
            <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", getSessionColor(session.name))}>
                <Clock size={14} />
                <span className="text-sm font-semibold">{session.name}</span>
                {session.current === "closed" && <span className="text-xs opacity-60">(Market Closed)</span>}
            </div>

            <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">High</p>
                    <div className="mt-1 flex items-center gap-1">
                        <TrendingUp size={11} className="text-emerald-400" />
                        <p className="font-mono text-xs text-emerald-400">{session.high.toFixed(session.high >= 100 ? 2 : 5)}</p>
                    </div>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Low</p>
                    <div className="mt-1 flex items-center gap-1">
                        <TrendingDown size={11} className="text-rose-400" />
                        <p className="font-mono text-xs text-rose-400">{session.low.toFixed(session.low >= 100 ? 2 : 5)}</p>
                    </div>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-foreground/50">Range</p>
                    <p className="mt-1 font-mono text-xs text-foreground/70">{session.range.toFixed(session.range >= 100 ? 2 : 5)}</p>
                </div>
            </div>

            {session.range > 0 && (
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <div className="flex items-center justify-between text-[10px] text-foreground/50">
                        <span>{session.low.toFixed(session.low >= 100 ? 2 : 5)}</span>
                        <span>Position in range</span>
                        <span>{session.high.toFixed(session.high >= 100 ? 2 : 5)}</span>
                    </div>
                    <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/10">
                        <div
                            className="absolute h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500"
                            style={{ width: "100%" }}
                        />
                        <div
                            className="absolute top-0 h-full w-1 rounded-full bg-background shadow-[0_0_6px_rgba(255,255,255,0.5)]"
                            style={{ left: `${Math.max(0, Math.min(100, positionInRange))}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
