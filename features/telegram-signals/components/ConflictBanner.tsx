"use client";

import { AlertTriangle } from "lucide-react";
import type { SignalConflictSummary } from "../types";

interface ConflictBannerProps {
    conflicts: SignalConflictSummary[];
}

export function ConflictBanner({ conflicts }: ConflictBannerProps) {
    if (conflicts.length === 0) return null;

    return (
        <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 backdrop-blur-xl">
            <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
                <div className="flex-1">
                    <h3 className="text-sm font-bold text-foreground">
                        Signal Conflict Detected ({conflicts.length} active conflict{conflicts.length > 1 ? "s" : ""})
                    </h3>
                    <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                        {conflicts.map((c) => (
                            <div key={c.symbol} className="flex items-center gap-2">
                                <span className="font-bold text-foreground">{c.symbol}:</span>
                                <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-400">
                                    BUY: {c.buyCount}
                                </span>
                                <span className="rounded bg-rose-500/10 px-2 py-0.5 font-bold text-rose-400">
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
