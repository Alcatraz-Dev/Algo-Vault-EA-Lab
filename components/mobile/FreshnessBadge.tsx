"use client";

/**
 * Phase 11 — data freshness badge.
 *
 * The single component that makes data honesty visible. Every screen that shows a
 * price renders one of these next to it, so "LIVE" is always a claim the UI has
 * earned rather than a hard-coded green dot.
 *
 * Visual language follows the existing AlgoVault identity: 1px borders, compact
 * type, muted palette. Only the semantic state colours are used, and they are
 * chosen for legibility in both themes rather than to shout.
 */

import { cn } from "@/lib/utils";
import { formatAge } from "@/lib/mobile/freshness";
import { FRESHNESS_LABEL, type FreshnessDescriptor } from "@/lib/mobile/contracts";

const TONE: Record<
    FreshnessDescriptor["freshness"],
    { dot: string; text: string; border: string; bg: string }
> = {
    live: {
        dot: "bg-positive",
        text: "text-positive",
        border: "border-positive/30",
        bg: "bg-positive/10",
    },
    delayed: {
        dot: "bg-warning",
        text: "text-warning",
        border: "border-warning/30",
        bg: "bg-warning/10",
    },
    stale: {
        dot: "bg-warning",
        text: "text-warning",
        border: "border-warning/30",
        bg: "bg-warning/10",
    },
    offline: {
        dot: "bg-muted",
        text: "text-muted-foreground",
        border: "border-border/30",
        bg: "bg-muted/10",
    },
    reconnecting: {
        dot: "animate-pulse bg-info",
        text: "text-info",
        border: "border-info/30",
        bg: "bg-info/10",
    },
};

export interface FreshnessBadgeProps {
    descriptor: FreshnessDescriptor;
    /** Show the age next to the state, e.g. "STALE · 4m". */
    showAge?: boolean;
    /** Hide the state word and show only the dot (for dense list rows). */
    compact?: boolean;
    className?: string;
}

export function FreshnessBadge({ descriptor, showAge = true, compact = false, className }: FreshnessBadgeProps) {
    const tone = TONE[descriptor.freshness];
    const age = formatAge(descriptor.dataTimestamp || null, descriptor.evaluatedAt);

    return (
        <span
            // Announced politely: a screen reader should hear the data state when
            // it changes, but not interrupt whatever the trader is doing.
            aria-live="polite"
            title={`${FRESHNESS_LABEL[descriptor.freshness]} · ${age} old · source: ${descriptor.source}${descriptor.fromCache ? " · cached" : ""}`}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide",
                tone.border,
                tone.bg,
                tone.text,
                className,
            )}
        >
            <span className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
            {!compact && <span>{FRESHNESS_LABEL[descriptor.freshness]}</span>}
            {showAge && age !== "—" && (
                <span className="tabular-nums opacity-80">{age}</span>
            )}
            {descriptor.fromCache && <span className="opacity-60">· cached</span>}
        </span>
    );
}

/**
 * The blocked-action banner shown above any surface that requires live data.
 * Uses the same descriptor, so the wording can never drift from the badge.
 */
export function StaleDataNotice({
    descriptor,
    className,
}: {
    descriptor: FreshnessDescriptor;
    className?: string;
}) {
    if (descriptor.freshness === "live") return null;
    const tone = TONE[descriptor.freshness];
    const age = formatAge(descriptor.dataTimestamp || null, descriptor.evaluatedAt);

    const message: Record<FreshnessDescriptor["freshness"], string> = {
        live: "",
        delayed: `Market data is ${age} old. Prices shown may not reflect the book.`,
        stale: `Market data is ${age} old and no longer updating. Trading actions are blocked.`,
        offline: "This device is offline. Showing the last known state.",
        reconnecting: "Reconnecting to the data feed…",
    };

    return (
        <div
            role="status"
            className={cn(
                "flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs",
                tone.border,
                tone.bg,
                tone.text,
                className,
            )}
        >
            <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
            <span>{message[descriptor.freshness]}</span>
        </div>
    );
}
