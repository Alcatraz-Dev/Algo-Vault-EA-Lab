"use client";

import { Layers3, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MultiTimeframeAnalysis, TimeframeAnalysis } from "@/lib/ai/analysis/intelligence";
import {
    AwaitingState,
    BiasChip,
    ConfidenceMeter,
    SourceFooter,
    TerminalPanel,
} from "@/components/scalping/TerminalPrimitives";

/**
 * Multi-timeframe ladder.
 *
 * Each rung is a separate measurement pass, so a rung the data provider does not
 * serve (biquote returns no M3 bars) renders as an explicit unavailable row with
 * the reason — it is never silently dropped, because a missing rung would change
 * how the alignment ratio reads.
 */

const ALIGNMENT_TONE = {
    aligned: "text-positive",
    conflicting: "text-negative",
    neutral: "text-muted-foreground",
} as const;

export function MtfLadderPanel({
    mtf,
    primaryTimeframe,
    onSelectTimeframe,
    className,
}: {
    mtf: MultiTimeframeAnalysis | null;
    primaryTimeframe?: string;
    onSelectTimeframe?: (tf: string) => void;
    className?: string;
}) {
    if (!mtf) {
        return (
            <TerminalPanel title="Multi-Timeframe Ladder" icon={<Layers3 className="size-3.5" />} className={className}>
                <AwaitingState reason="The multi-timeframe pass has not run yet." />
            </TerminalPanel>
        );
    }

    return (
        <TerminalPanel
            title="Multi-Timeframe Ladder"
            icon={<Layers3 className="size-3.5" />}
            meta={`${mtf.availableCount}/${mtf.requestedCount} timeframes measured`}
            dense
            className={className}
        >
            <div className="overflow-x-auto">
                <table className="w-full min-w-full border-collapse text-xs">
                    <thead>
                        <tr className="border-b border-border">
                            {["TF", "Trend", "Momentum", "Volatility", "Regime", "VWAP", "Bars", "Alignment"].map(
                                (h, i) => (
                                    <th
                                        key={h}
                                        scope="col"
                                        className={cn(
                                            "whitespace-nowrap px-2 py-1.5 text-xs font-medium text-muted-foreground",
                                            i > 0 && i < 6 ? "text-left" : "text-left"
                                        )}
                                    >
                                        {h}
                                    </th>
                                )
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {mtf.timeframes.map((tf) => (
                            <LadderRow
                                key={tf.timeframe}
                                tf={tf}
                                isPrimary={tf.timeframe === primaryTimeframe}
                                onSelect={onSelectTimeframe}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="border-t border-border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <p className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Scale className="size-3" />
                            Dominant bias
                        </p>
                        <BiasChip bias={mtf.dominantBias.value} />
                    </div>
                    <div>
                        <ConfidenceMeter
                            metric={mtf.alignmentRatio}
                            label="Alignment ratio"
                            label2={
                                <span className="font-mono tabular-nums">
                                    {mtf.alignedCount}A / {mtf.conflictingCount}C
                                </span>
                            }
                            weightNote="aligned ÷ (aligned + conflicting)"
                        />
                    </div>
                </div>
                {mtf.summary.status === "available" ? (
                    <p className="mt-3 text-xs text-muted-foreground">{mtf.summary.value}</p>
                ) : (
                    <p className="mt-3 text-xs text-muted-foreground italic">
                        Data unavailable: {mtf.summary.reason ?? "the engine produced no summary."}
                    </p>
                )}
            </div>

            <SourceFooter
                className="border-t border-border px-3 py-2"
                items={[
                    { label: "Source", value: <span>{mtf.dominantBias.source.label}</span> },
                    {
                        label: "Coverage",
                        value: (
                            <span className="font-mono tabular-nums">
                                {mtf.availableCount} of {mtf.requestedCount} rungs measured
                            </span>
                        ),
                    },
                ]}
            />
        </TerminalPanel>
    );
}

function LadderRow({
    tf,
    isPrimary,
    onSelect,
}: {
    tf: TimeframeAnalysis;
    isPrimary: boolean;
    onSelect?: (tf: string) => void;
}) {
    const unavailable = !tf.available;

    return (
        <tr className={cn("border-b border-border/60 last:border-0", isPrimary && "bg-primary/5")}>
            <td className="whitespace-nowrap px-2 py-1.5">
                {onSelect ? (
                    <button
                        type="button"
                        onClick={() => onSelect(tf.timeframe)}
                        disabled={unavailable}
                        className="rounded border border-border px-1.5 py-0.5 font-mono text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {tf.timeframe}
                    </button>
                ) : (
                    <span className="font-mono text-xs font-medium text-foreground">{tf.timeframe}</span>
                )}
                {isPrimary ? <span className="ml-1 text-xs text-primary">·</span> : null}
            </td>

            <Cell>
                {unavailable ? (
                    <Unavailable reason={tf.reason} />
                ) : (
                    <BiasChip bias={tf.trend.value} />
                )}
            </Cell>
            <Cell>
                {unavailable ? <span className="text-muted-foreground/40">—</span> : <BiasChip bias={tf.momentum.value} />}
            </Cell>
            <Cell>
                {unavailable ? (
                    <span className="text-muted-foreground/40">—</span>
                ) : (
                    <span className="font-mono text-xs capitalize text-muted-foreground">
                        {tf.volatilityState.value ?? "unavailable"}
                    </span>
                )}
            </Cell>
            <Cell>
                {unavailable ? (
                    <span className="text-muted-foreground/40">—</span>
                ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                        {String(tf.regime.value ?? "unavailable").replace(/_/g, " ")}
                    </span>
                )}
            </Cell>
            <Cell>
                {unavailable ? (
                    <span className="text-muted-foreground/40">—</span>
                ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                        {tf.vwapPosition.value ?? "unavailable"}
                    </span>
                )}
            </Cell>
            <Cell>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{tf.bars}</span>
            </Cell>
            <Cell>
                {unavailable ? (
                    <span className="text-muted-foreground/40">—</span>
                ) : (
                    <span className={cn("font-mono text-xs", ALIGNMENT_TONE[tf.alignment.value ?? "neutral"])}>
                        {tf.alignment.value ?? "unavailable"}
                    </span>
                )}
            </Cell>
        </tr>
    );
}

function Cell({ children }: { children: React.ReactNode }) {
    return <td className="whitespace-nowrap px-2 py-1.5 align-middle">{children}</td>;
}

function Unavailable({ reason }: { reason?: string }) {
    return (
        <span className="text-xs text-muted-foreground italic" title={reason}>
            Data unavailable
        </span>
    );
}
