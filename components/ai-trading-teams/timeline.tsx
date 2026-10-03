"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { TeamTimelineEntry } from "@/lib/ai-trading-teams/types";

/**
 * TeamTimeline — bottom execution timeline of a run. Newest entries append;
 * each row is timestamped and typed (info / started / completed / warning /
 * error / synthesis).
 */

const KIND_STYLE: Record<TeamTimelineEntry["kind"], string> = {
    info: "border-border text-muted-foreground",
    started: "border-primary/60 text-primary",
    completed: "border-positive/60 text-positive",
    warning: "border-warning/60 text-warning",
    error: "border-destructive/60 text-destructive",
    synthesis: "border-primary/70 text-primary",
};

function formatTime(t: number): string {
    const date = new Date(t);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const TeamTimeline = memo(function TeamTimeline({
    entries,
    emptyLabel = "No execution activity yet.",
    className,
}: {
    entries: TeamTimelineEntry[];
    emptyLabel?: string;
    className?: string;
}) {
    if (entries.length === 0) {
        return (
            <p className={cn("px-1 py-3 text-xs text-muted-foreground", className)}>{emptyLabel}</p>
        );
    }
    return (
        <ol className={cn("space-y-1.5 overflow-y-auto px-1 py-2", className)}>
            {entries.map((entry, index) => (
                <li key={`${entry.t}-${index}`} className="flex items-start gap-2 text-[11px] leading-snug">
                    <span className="shrink-0 tabular-nums text-muted-foreground/70">{formatTime(entry.t)}</span>
                    <span
                        className={cn(
                            "mt-1 h-2 w-2 shrink-0 rounded-full border",
                            KIND_STYLE[entry.kind] ?? KIND_STYLE.info,
                        )}
                        aria-hidden="true"
                    />
                    <span className={cn("min-w-0 flex-1", entry.kind === "error" ? "text-destructive" : "text-foreground/80")}>
                        {entry.agentId ? (
                            <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">{entry.agentId}</span>
                        ) : null}
                        {entry.text}
                    </span>
                </li>
            ))}
        </ol>
    );
});
