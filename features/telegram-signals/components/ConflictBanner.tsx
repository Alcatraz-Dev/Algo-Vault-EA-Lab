"use client";

import { AlertTriangle } from "lucide-react";
import type { SignalConflictSummary } from "../types";

interface ConflictBannerProps {
    conflicts: SignalConflictSummary[];
}

export function ConflictBanner({ conflicts }: ConflictBannerProps) {
    if (conflicts.length === 0) return null;

    return (
        <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 p-4">
            <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-warning mt-0.5" />
                <div className="flex-1">
                    <h3 className="text-sm font-semibold text-foreground">
                        Signal Conflict Detected ({conflicts.length} active conflict{conflicts.length > 1 ? "s" : ""})
                    </h3>
                    <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                        {conflicts.map((c) => (
                            <div key={c.symbol} className="flex items-center gap-2">
                                <span className="font-semibold text-foreground">{c.symbol}:</span>
                                <span className="rounded-md bg-positive/10 px-2 py-0.5 font-numeric font-semibold text-positive-foreground">
                                    BUY: {c.buyCount}
                                </span>
                                <span className="rounded-md bg-negative/10 px-2 py-0.5 font-numeric font-semibold text-negative-foreground">
                                    SELL: {c.sellCount}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
