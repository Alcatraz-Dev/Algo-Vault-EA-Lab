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
    if (name === "London") return "text-info bg-info/10 border-info/20";
    if (name === "New York") return "text-positive bg-positive/10 border-positive/20";
    if (name === "Asian") return "text-warning bg-warning/10 border-warning/20";
    if (name.includes("Overlap")) return "text-primary bg-primary/10 border-primary/20";
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
                    <p className="text-micro font-semibold uppercase text-foreground/50">High</p>
                    <div className="mt-1 flex items-center gap-1">
                        <TrendingUp size={11} className="text-positive" />
                        <p className="font-mono text-xs text-positive">{session.high.toFixed(session.high >= 100 ? 2 : 5)}</p>
                    </div>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-micro font-semibold uppercase text-foreground/50">Low</p>
                    <div className="mt-1 flex items-center gap-1">
                        <TrendingDown size={11} className="text-negative" />
                        <p className="font-mono text-xs text-negative">{session.low.toFixed(session.low >= 100 ? 2 : 5)}</p>
                    </div>
                </div>
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <p className="text-micro font-semibold uppercase text-foreground/50">Range</p>
                    <p className="mt-1 font-mono text-xs text-foreground/70">{session.range.toFixed(session.range >= 100 ? 2 : 5)}</p>
                </div>
            </div>

            {session.range > 0 && (
                <div className="rounded-lg bg-foreground/4 p-2.5">
                    <div className="flex items-center justify-between text-micro text-foreground/50">
                        <span>{session.low.toFixed(session.low >= 100 ? 2 : 5)}</span>
                        <span>Position in range</span>
                        <span>{session.high.toFixed(session.high >= 100 ? 2 : 5)}</span>
                    </div>
                    <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/10">
                        <div
                            className="absolute h-full rounded-full bg-gradient-to-r from-negative via-warning to-positive"
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
