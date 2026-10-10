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
        <div className="rounded-lg border border-border bg-card p-4" data-guide="daily-limit">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                        <CircleDollarSign className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Daily Signal Usage</p>
                        <p className="font-numeric text-sm font-bold text-foreground">
                            {used} / {limit} signals used today
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="h-2 w-40 overflow-hidden rounded-full bg-border" aria-hidden="true">
                        <div
                            className={`h-full rounded-full transition-all ${limitReached ? "bg-negative" : "bg-warning"}`}
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
