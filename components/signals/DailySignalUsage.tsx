"use client";

import { CircleDollarSign } from "lucide-react";

type DailySignalUsageProps = {
    used: number;
    limit: number;
};

export function DailySignalUsage({ used, limit }: DailySignalUsageProps) {
    const remaining = Math.max(0, limit - used);
    const usagePercent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
    const limitReached = used >= limit;

    return (
        <div className="rounded-2xl border border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 p-4 backdrop-blur-xl" data-guide="daily-limit">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-card">
                        <CircleDollarSign className="h-5 w-5 text-amber-400" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Daily Signal Usage</p>
                        <p className="text-sm font-bold text-foreground">
                            {used} / {limit} signals used today
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="h-2 w-40 overflow-hidden rounded-full bg-border" aria-hidden="true">
                        <div
                            className={`h-full rounded-full transition-all ${limitReached ? "bg-red-500" : "bg-amber-500"}`}
                            style={{ width: `${usagePercent}%` }}
                        />
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground">
                        {limitReached ? "Limit Reached" : `${remaining} remaining`}
                    </span>
                </div>
            </div>
        </div>
    );
}
