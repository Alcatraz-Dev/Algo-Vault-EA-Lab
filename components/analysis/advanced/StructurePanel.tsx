"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, GitBranch, Layers, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketStructureAnalysis, ReversalSetup } from "@/lib/ai/analysis/intelligence";
import type { MarketStructureEvent } from "@/lib/market-data/types";
import {
    AwaitingState,
    BiasChip,
    SourcedValue,
    SourceFooter,
    StatRow,
    TerminalPanel,
} from "@/components/scalping/TerminalPrimitives";
import { formatPrice, relativeTime } from "@/lib/scalping/client";

/**
 * Market structure panel.
 *
 * Everything shown here is a measurement the existing analytics engines made:
 * BOS / CHOCH events, clustered swing levels, detected liquidity and zones. The
 * reversal block is deliberately conditional — it only renders when a real
 * character break was detected, because the underlying `MarketRegime` union has
 * no `"reversal"` member and inventing one would be fabrication.
 */

export function StructurePanel({
    structure,
    now,
    className,
}: {
    structure: MarketStructureAnalysis | null;
    now: number;
    className?: string;
}) {
    const [tab, setTab] = useState<"levels" | "events" | "zones">("levels");

    if (!structure) {
        return (
            <TerminalPanel title="Market Structure" icon={<GitBranch className="size-3.5" />} className={className}>
                <AwaitingState reason="Structure analysis has not been computed yet." />
            </TerminalPanel>
        );
    }

    const support = structure.support.value ?? [];
    const resistance = structure.resistance.value ?? [];
    const events = [...structure.structureEvents.value ?? []].sort(
        (a, b) => b.timestamp - a.timestamp
    );
    const zones = [...(structure.fairValueGaps.value ?? []), ...(structure.orderBlocks.value ?? [])];
    const reversal = structure.reversalSetup.value;

    return (
        <TerminalPanel
            title="Market Structure"
            icon={<GitBranch className="size-3.5" />}
            meta={
                <span className="inline-flex items-center gap-2">
                    <BiasChip bias={structure.trend.value} />
                    <span>VWAP {structure.vwapPosition.value ?? "—"}</span>
                </span>
            }
            className={className}
            action={<SourcedValue metric={structure.vwap} format={(v) => formatPrice(v)} className="text-xs" />}
        >
            <div className="flex flex-wrap gap-1.5">
                {(
                    [
                        { id: "levels" as const, label: `Levels (${support.length + resistance.length})` },
                        { id: "events" as const, label: `Events (${events.length})` },
                        { id: "zones" as const, label: `Zones (${zones.length})` },
                    ]
                ).map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        aria-pressed={tab === t.id}
                        className={cn(
                            "rounded-md border border-border px-2 py-0.5 text-xs transition",
                            tab === t.id
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="mt-3">
                {tab === "levels" ? (
                    <LevelList support={support} resistance={resistance} />
                ) : tab === "events" ? (
                    <EventList events={events} now={now} />
                ) : (
                    <ZoneList
                        fvgs={structure.fairValueGaps.value ?? []}
                        orderBlocks={structure.orderBlocks.value ?? []}
                    />
                )}
            </div>

            <ReversalBlock reversal={reversal} structure={structure} now={now} />

            <SourceFooter
                className="mt-3 border-t border-border pt-2"
                items={[
                    {
                        label: "Liquidity",
                        value: (
                            <span className="font-mono tabular-nums">
                                {structure.liquidityLevels.value?.length ?? 0} levels ·{" "}
                                {structure.liquiditySweeps.value?.length ?? 0} sweeps
                            </span>
                        ),
                    },
                    {
                        label: "Last structure event",
                        value: structure.lastEvent ? (
                            <span className="font-mono">{structure.lastEvent.type}</span>
                        ) : (
                            <span className="italic">none detected</span>
                        ),
                    },
                    { label: "Source", value: <span>{structure.trend.source.label}</span> },
                ]}
            />
        </TerminalPanel>
    );
}

function LevelList({
    support,
    resistance,
}: {
    support: MarketStructureAnalysis["support"]["value"];
    resistance: MarketStructureAnalysis["resistance"]["value"];
}) {
    if ((!support || support.length === 0) && (!resistance || resistance.length === 0)) {
        return (
            <AwaitingState
                compact
                reason="No support or resistance band was clustered from the available swing points."
            />
        );
    }
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Resistance</p>
                {(resistance ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Data unavailable</p>
                ) : (
                    <ul className="space-y-1">
                        {(resistance ?? []).map((l) => (
                            <LevelRow key={`r-${l.price}`} level={l} tone="resistance" />
                        ))}
                    </ul>
                )}
            </div>
            <div className="min-w-0">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Support</p>
                {(support ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Data unavailable</p>
                ) : (
                    <ul className="space-y-1">
                        {(support ?? []).map((l) => (
                            <LevelRow key={`s-${l.price}`} level={l} tone="support" />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function LevelRow({
    level,
    tone,
}: {
    level: { price: number; touches: number; strength: number; lastTouch: number; kind: string };
    tone: "support" | "resistance";
}) {
    return (
        <li className="flex items-baseline justify-between gap-2 text-xs">
            <span
                className={cn(
                    "font-mono font-medium tabular-nums",
                    tone === "support" ? "text-positive" : "text-negative"
                )}
            >
                {formatPrice(level.price)}
            </span>
            <span className="text-muted-foreground">
                {level.touches} touch{level.touches === 1 ? "" : "es"} · strength{" "}
                <span className="font-mono tabular-nums">{(level.strength * 100).toFixed(0)}%</span>
            </span>
        </li>
    );
}

function EventList({ events, now }: { events: MarketStructureEvent[]; now: number }) {
    if (events.length === 0) {
        return (
            <AwaitingState
                compact
                reason="The structure engine did not detect a break of structure or change of character on this timeframe."
            />
        );
    }
    return (
        <ul className="max-h-[300px] space-y-1 overflow-y-auto">
            {events.map((e) => {
                const up = e.direction === "bullish";
                return (
                    <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span
                            className={cn(
                                "inline-flex items-center gap-1 rounded border px-1 py-0.5 font-mono text-xs font-medium",
                                e.type === "CHOCH"
                                    ? "border-primary/50 bg-primary/10 text-primary"
                                    : up
                                      ? "border-positive/40 bg-positive/10 text-positive"
                                      : "border-negative/40 bg-negative/10 text-negative"
                            )}
                        >
                            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                            {e.type}
                        </span>
                        <span className="font-mono tabular-nums text-foreground">{formatPrice(e.price)}</span>
                        {typeof e.brokenLevel === "number" ? (
                            <span className="text-muted-foreground">
                                broke <span className="font-mono tabular-nums">{formatPrice(e.brokenLevel)}</span>
                            </span>
                        ) : null}
                        <span className="ml-auto font-mono text-muted-foreground">
                            {relativeTime(e.timestamp, now)}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

function ZoneList({
    fvgs,
    orderBlocks,
}: {
    fvgs: MarketStructureAnalysis["fairValueGaps"]["value"];
    orderBlocks: MarketStructureAnalysis["orderBlocks"]["value"];
}) {
    const all = useMemo(
        () => [
            ...(fvgs ?? []).map((z) => ({ ...z, kind: "FVG" as const })),
            ...(orderBlocks ?? []).map((z) => ({ ...z, kind: "OB" as const })),
        ],
        [fvgs, orderBlocks]
    );

    if (all.length === 0) {
        return (
            <AwaitingState
                compact
                reason="No fair value gap or order block was detected on this timeframe."
            />
        );
    }

    return (
        <ul className="max-h-[300px] space-y-1 overflow-y-auto">
            {all.map((z) => (
                <li key={`${z.kind}-${z.id}`} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="rounded border border-border px-1 py-0.5 font-mono text-xs text-muted-foreground">
                        {z.kind}
                    </span>
                    <span
                        className={cn(
                            "font-medium uppercase",
                            z.direction === "bullish"
                                ? "text-positive"
                                : z.direction === "bearish"
                                  ? "text-negative"
                                  : "text-muted-foreground"
                        )}
                    >
                        {z.direction}
                    </span>
                    <span className="font-mono tabular-nums text-foreground">
                        {formatPrice(z.low)} – {formatPrice(z.high)}
                    </span>
                    <span className="text-muted-foreground">
                        strength{" "}
                        <span className="font-mono tabular-nums">{(z.strength * 100).toFixed(0)}%</span>
                    </span>
                    <span className="ml-auto text-muted-foreground">
                        <span className="font-mono uppercase">{z.status}</span>
                    </span>
                </li>
            ))}
        </ul>
    );
}

/**
 * Reversal block. Renders only when a real character break was detected; the
 * "no reversal" wording is a measurement statement, not a guess.
 */
function ReversalBlock({
    reversal,
    structure,
    now,
}: {
    reversal: ReversalSetup | null | undefined;
    structure: MarketStructureAnalysis;
    now: number;
}) {
    const detected = reversal?.detected === true;

    return (
        <div className="mt-3 rounded-md border border-border p-2.5">
            <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Waves className="size-3" />
                Reversal setup
            </p>
            {!detected ? (
                <p className="text-xs text-muted-foreground">
                    No change of character detected — the structure engine has not recorded a break that
                    flips the prevailing bias.
                </p>
            ) : (
                <div className="grid gap-1 sm:grid-cols-2">
                    <StatRow
                        label="Bias flip"
                        value={
                            <span className="font-mono">
                                {reversal!.priorBias} → {reversal!.currentBias}
                            </span>
                        }
                    />
                    <StatRow
                        label="Break price"
                        value={
                            <span className="font-mono tabular-nums">{formatPrice(reversal!.breakPrice)}</span>
                        }
                    />
                    <StatRow label="Bars since break" value={<span className="font-mono tabular-nums">{reversal!.barsSince}</span>} />
                    <StatRow label="At" value={<span className="font-mono">{relativeTime(reversal!.breakTimestamp, now)}</span>} />
                </div>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground/80">
                Regime <span className="font-mono">{structure.trend.value ?? "unavailable"}</span> · derived
                from real BOS / CHOCH events, not asserted.
            </p>
        </div>
    );
}

/** Zone strength list used by the evidence panel. */
export function ScoredZoneList({
    zones,
    className,
}: {
    zones: Array<{ zone: { id: string; type: string; direction: string; low: number; high: number; status: string }; score: number; reasons: string[] }>;
    className?: string;
}) {
    if (zones.length === 0) {
        return <AwaitingState compact reason="No zone on this symbol received a real score." />;
    }
    return (
        <ul className={cn("space-y-1.5", className)}>
            {zones.map((z) => (
                <li key={z.zone.id} className="text-xs">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="inline-flex items-center gap-1 font-mono font-medium text-foreground">
                            <Layers className="size-3 text-muted-foreground" />
                            {z.zone.type}
                        </span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                            {formatPrice(z.zone.low)} – {formatPrice(z.zone.high)}
                        </span>
                        <span className="ml-auto font-mono tabular-nums font-semibold text-foreground">
                            {(z.score * 100).toFixed(0)}
                        </span>
                    </span>
                    {z.reasons.length > 0 ? (
                        <span className="mt-0.5 block text-muted-foreground">{z.reasons.join(" · ")}</span>
                    ) : null}
                </li>
            ))}
        </ul>
    );
}
