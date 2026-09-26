"use client";

/**
 * Compact account-health status chips.
 *
 * Deliberately small: these sit in a cluster beside the score ring, where the
 * previous `text-xs` pills dominated the card and competed with the score for
 * attention. A 10px label with a leading dot reads as a status tag rather than
 * a headline, and the colour still carries the meaning on its own for anyone who
 * cannot distinguish the tints.
 */

import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExposureStatus, HealthStatus, RiskLevel } from "@/lib/account-health/types";

const TONE: Record<RiskLevel | HealthStatus | ExposureStatus, string> = {
    LOW: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    SAFE: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    MODERATE: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    WARNING: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    HIGH: "border-rose-500/25 bg-rose-500/10 text-rose-400",
    DANGER: "border-rose-500/25 bg-rose-500/10 text-rose-400",
};

const IDLE = "border-border/40 bg-muted/30 text-muted-foreground";

export function StatusPill({
    label,
    value,
    className,
}: {
    label: string;
    value: RiskLevel | HealthStatus | ExposureStatus | null;
    className?: string;
}) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-[3px] text-[10px] font-medium leading-none",
                value ? TONE[value] : IDLE,
                className,
            )}
        >
            <span className="text-[9px] font-normal opacity-60">{label}</span>
            <span
                aria-hidden
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", value ? "opacity-90" : "opacity-40")}
            />
            {value ?? "—"}
        </span>
    );
}

/** The four account verdicts, in one wrapping row. */
export function StatusPillRow({
    riskLevel,
    drawdownStatus,
    marginStatus,
    exposureStatus,
    hasData = true,
    className,
}: {
    riskLevel: RiskLevel | null;
    drawdownStatus: HealthStatus | null;
    marginStatus: HealthStatus | null;
    exposureStatus: ExposureStatus | null;
    hasData?: boolean;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-wrap gap-1.5", className)}>
            <StatusPill label="Risk" value={hasData ? riskLevel : null} />
            <StatusPill label="Drawdown" value={hasData ? drawdownStatus : null} />
            <StatusPill label="Margin" value={hasData ? marginStatus : null} />
            <StatusPill label="Exposure" value={hasData ? exposureStatus : null} />
        </div>
    );
}

/** Neutral placeholder for an account with nothing to report. */
export function NoDataPill({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/30 px-1.5 py-[3px] text-[10px] font-medium leading-none text-muted-foreground",
                className,
            )}
        >
            <Shield size={10} className="opacity-60" />
            No activity
        </span>
    );
}
