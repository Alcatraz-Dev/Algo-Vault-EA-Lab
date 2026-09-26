"use client";

import { CircleDot, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RegimeAnalysis } from "@/lib/ai/analysis/intelligence";
import {
    AwaitingState,
    ConfidenceMeter,
    SourceFooter,
    StatRow,
    TerminalPanel,
} from "@/components/scalping/TerminalPrimitives";
import { formatPrice, relativeTime } from "@/lib/scalping/client";

/**
 * Market regime panel.
 *
 * The regime itself comes from the existing classifier in `lib/analytics`; this
 * panel only presents it with the classifier's own factor list, so the reasoning
 * shown is the engine's reasoning and not a re-interpretation.
 */

const REGIME_TONE: Record<string, string> = {
    trending_bullish: "border-positive/40 bg-positive/10 text-positive",
    trending_bearish: "border-negative/40 bg-negative/10 text-negative",
    ranging: "border-border bg-muted text-muted-foreground",
    volatile: "border-warning/40 bg-warning/10 text-warning",
    quiet: "border-border bg-muted text-muted-foreground",
    transitional: "border-border bg-muted text-muted-foreground",
};

export function RegimePanel({
    regime,
    now,
    className,
}: {
    regime: RegimeAnalysis | null;
    now: number;
    className?: string;
}) {
    if (!regime) {
        return (
            <TerminalPanel title="Market Regime" icon={<Compass className="size-3.5" />} className={className}>
                <AwaitingState reason="The regime classifier has not run yet." />
            </TerminalPanel>
        );
    }

    const regimeValue = regime.regime.value;
    const reversal = regime.reversal.value;

    return (
        <TerminalPanel
            title="Market Regime"
            icon={<Compass className="size-3.5" />}
            className={className}
        >
            <div className="flex flex-wrap items-center gap-2">
                <span
                    className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
                        regimeValue ? (REGIME_TONE[regimeValue] ?? "border-border bg-muted text-muted-foreground") : "border-border bg-muted text-muted-foreground"
                    )}
                >
                    <CircleDot className="size-3" />
                    {regimeValue ? regimeValue.replace(/_/g, " ") : "Data unavailable"}
                </span>
                {regime.label.status === "available" && regime.label.value !== regimeValue ? (
                    <span className="text-xs text-muted-foreground">{regime.label.value}</span>
                ) : null}
            </div>

            <div className="mt-3">
                <ConfidenceMeter
                    metric={regime.confidence}
                    label="Classifier confidence"
                    weightNote="reported by the regime engine"
                />
            </div>

            {regime.classifierFactors.length > 0 ? (
                <div className="mt-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Classifier factors</p>
                    <ul className="space-y-1">
                        {regime.classifierFactors.map((f, i) => (
                            <li key={i} className="text-xs text-muted-foreground">
                                {f}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <p className="mt-3 text-xs text-muted-foreground italic">
                    The classifier reported no factor breakdown.
                </p>
            )}

            <div className="mt-3 rounded-md border border-border p-2.5">
                <p className="mb-1 text-xs font-medium text-foreground">Reversal</p>
                {reversal?.detected ? (
                    <>
                        <StatRow
                            label="Bias flip"
                            value={
                                <span className="font-mono">
                                    {reversal.priorBias} → {reversal.currentBias}
                                </span>
                            }
                        />
                        <StatRow
                            label="Break"
                            value={
                                <span className="font-mono tabular-nums">
                                    {formatPrice(reversal.breakPrice)} · {relativeTime(reversal.breakTimestamp, now)}
                                </span>
                            }
                        />
                        <StatRow
                            label="Bars since"
                            value={<span className="font-mono tabular-nums">{reversal.barsSince}</span>}
                        />
                    </>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        No change of character on this timeframe. Reversal is only reported when a real
                        break flips the prevailing bias.
                    </p>
                )}
            </div>

            <SourceFooter
                className="mt-3 border-t border-border pt-2"
                items={[
                    { label: "Source", value: <span>{regime.regime.source.label}</span> },
                    {
                        label: "Evidence items",
                        value: <span className="font-mono tabular-nums">{regime.evidence.length}</span>,
                    },
                ]}
            />
        </TerminalPanel>
    );
}
