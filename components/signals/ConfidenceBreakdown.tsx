"use client";

import {
    TrendingUp,
    LayoutGrid,
    Droplets,
    Gauge,
    BarChart3,
    Activity,
    Crosshair,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConfidenceBreakdown as ConfidenceBreakdownType } from "@/lib/ai-signals/types";

type Props = {
    breakdown: ConfidenceBreakdownType;
};

const FACTORS = [
    { key: "trendAlignment" as const, label: "Trend", icon: TrendingUp },
    { key: "marketStructure" as const, label: "Structure", icon: LayoutGrid },
    { key: "liquidity" as const, label: "Liquidity", icon: Droplets },
    { key: "momentum" as const, label: "Momentum", icon: Gauge },
    { key: "volume" as const, label: "Volume", icon: BarChart3 },
    { key: "orderFlow" as const, label: "Order Flow", icon: Activity },
    { key: "entryConfirmation" as const, label: "Entry", icon: Crosshair },
];

function barColor(percentage: number) {
    if (percentage >= 75) return "bg-positive";
    if (percentage >= 50) return "bg-warning";
    return "bg-negative";
}

function textColor(percentage: number) {
    if (percentage >= 75) return "text-positive";
    if (percentage >= 50) return "text-warning";
    return "text-negative";
}

function totalColor(total: number) {
    if (total >= 80) return "text-positive";
    if (total >= 60) return "text-warning";
    return "text-negative";
}

export default function ConfidenceBreakdown({ breakdown }: Props) {
    const totalPct = Math.round((breakdown.total / 700) * 100);

    return (
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Confidence Breakdown
                </h3>
                <span className="text-micro text-foreground/50">7 factors</span>
            </div>

            {/* Large Score */}
            <div className="flex flex-col items-center py-2">
                <span className={cn("font-numeric text-5xl font-black tracking-tight", totalColor(breakdown.total))}>
                    {breakdown.total}
                </span>
                <span className="mt-1 text-xs text-foreground/50">/ 700</span>
                <div className="mt-2 h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-foreground/10">
                    <div
                        className={cn("h-full rounded-full transition-all duration-500", barColor(totalPct))}
                        style={{ width: `${totalPct}%` }}
                    />
                </div>
            </div>

            {/* Factor Bars */}
            <div className="space-y-2.5">
                {FACTORS.map(({ key, label, icon: Icon }) => {
                    const factor = breakdown[key];
                    const pct = Math.round((factor.score / factor.max) * 100);

                    return (
                        <div key={key} className="space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <Icon size={11} className="text-foreground/50" />
                                    <span className="text-micro font-medium text-muted-foreground">{label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-numeric text-micro text-foreground/50">
                                        {factor.score}/{factor.max}
                                    </span>
                                    <span className={cn("font-numeric text-micro font-bold", textColor(pct))}>
                                        {pct}%
                                    </span>
                                </div>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                                <div
                                    className={cn("h-full rounded-full transition-all duration-500", barColor(pct))}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            {factor.detail && (
                                <p className="text-micro text-foreground/50 leading-relaxed pl-[18px]">
                                    {factor.detail}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
