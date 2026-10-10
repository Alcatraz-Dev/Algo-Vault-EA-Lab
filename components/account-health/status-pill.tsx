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
    LOW: "border-positive/25 bg-positive/10 text-positive",
    SAFE: "border-positive/25 bg-positive/10 text-positive",
    MODERATE: "border-warning/25 bg-warning/10 text-warning",
    WARNING: "border-warning/25 bg-warning/10 text-warning",
    HIGH: "border-negative/25 bg-negative/10 text-negative",
    DANGER: "border-negative/25 bg-negative/10 text-negative",
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
                "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-[3px] text-micro font-medium leading-none",
                value ? TONE[value] : IDLE,
                className,
            )}
        >
            <span className="text-micro font-normal opacity-60">{label}</span>
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
                "inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/30 px-1.5 py-[3px] text-micro font-medium leading-none text-muted-foreground",
                className,
            )}
        >
            <Shield size={10} className="opacity-60" />
            No activity
        </span>
    );
}
