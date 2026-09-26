"use client";

/**
 * Account metric tiles.
 *
 * Compact by design: label above, figure below, 9px label. Tone-coded values — a
 * negative open P/L, a redlined margin level or a real drawdown should be visible
 * without reading the number.
 *
 * A margin level of "no value" is a first-class state, not a zero. It means no
 * margin is in use, and it is shown as "N/A" rather than `0%` so it cannot be
 * misread as a margin call.
 */

import {
    Activity,
    AlertTriangle,
    TrendingDown,
    TrendingUp,
    Wallet,
    type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccountHealthMetrics } from "@/lib/account-health/types";

function money(value: number, dp = 2): string {
    return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
    })}`;
}

type Tone = "default" | "positive" | "negative" | "warning";

export function MetricTile({
    label,
    value,
    icon: Icon,
    tone = "default",
    className,
}: {
    label: string;
    value: string;
    icon: LucideIcon;
    tone?: Tone;
    className?: string;
}) {
    return (
        <div className={cn("rounded-xl border border-border/30 bg-muted/50 px-3 py-2.5", className)}>
            <div className="flex items-center gap-1.5">
                <Icon size={11} className="shrink-0 text-muted-foreground" />
                <span className="truncate text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                </span>
            </div>
            <p
                className={cn(
                    "mt-1.5 font-mono text-[13px] font-semibold tabular-nums",
                    tone === "positive" && "text-emerald-400",
                    tone === "negative" && "text-rose-400",
                    tone === "warning" && "text-amber-400",
                    tone === "default" && "text-foreground",
                )}
            >
                {value}
            </p>
        </div>
    );
}

export function AccountMetrics({ metrics, className }: { metrics: AccountHealthMetrics; className?: string }) {
    // Null means no margin in use. That is the safest possible state, so it never
    // takes a warning tone.
    const marginLevel = metrics.marginLevel;
    const marginTone: Tone = marginLevel === null
        ? "default"
        : marginLevel < 200 ? "negative" : marginLevel < 500 ? "warning" : "positive";

    const drawdownTone: Tone = metrics.drawdown > 15
        ? "negative"
        : metrics.drawdown > 8 ? "warning" : "default";

    return (
        <div className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-4", className)}>
            <MetricTile label="Balance" value={money(metrics.balance)} icon={Wallet} />
            <MetricTile label="Equity" value={money(metrics.equity)} icon={Activity} />
            <MetricTile
                label="Free margin"
                value={metrics.marginLevel === null ? "—" : money(metrics.freeMargin)}
                icon={Wallet}
            />
            <MetricTile
                label="Open P/L"
                value={`${metrics.floatingPnl > 0 ? "+" : ""}${money(metrics.floatingPnl)}`}
                icon={metrics.floatingPnl >= 0 ? TrendingUp : TrendingDown}
                tone={metrics.floatingPnl > 0 ? "positive" : metrics.floatingPnl < 0 ? "negative" : "default"}
            />
            <MetricTile
                label="Positions"
                value={String(metrics.totalPositions)}
                icon={Activity}
                tone={metrics.positionsAtRisk > 0 ? "warning" : "default"}
            />
            <MetricTile
                label="Open risk"
                value={money(metrics.openRisk)}
                icon={AlertTriangle}
                tone={metrics.positionsAtRisk > 0 ? "negative" : "default"}
            />
            <MetricTile
                label="Margin level"
                // "N/A" matches the rest of the app: an unleveraged account has
                // no level to report, and printing 0% would imply a margin call.
                value={marginLevel === null ? "N/A" : `${marginLevel.toFixed(1)}%`}
                icon={Wallet}
                tone={marginTone}
            />
            <MetricTile
                label="Drawdown"
                value={`${metrics.drawdown.toFixed(1)}%`}
                icon={TrendingDown}
                tone={drawdownTone}
            />
        </div>
    );
}
