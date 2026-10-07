"use client";

/**
 * LayerPicker — the shared chart-layer picker with inline honesty.
 *
 * Every layer renders as a chip. Degraded/unavailable layers stay
 * non-interactive but are no longer silent: clicking one expands an inline
 * explanation directly beneath the chip row showing WHY it is unavailable
 * and WHICH data source would unlock it. Estimated-quality layers keep an
 * amber provenance hint on the chip itself. No hover dependency.
 *
 * Consumers can either render the full picker or just the explanation panel
 * (`LayerUnlockPanel`) under their existing chips — both paths share the
 * exact same copy from LAYER_REQUIREMENTS.
 */

import { useState } from "react";
import { Lock, ChevronDown, Info, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHART_LAYERS, LAYER_REQUIREMENTS, type ChartLayerId, type ChartLayerDef } from "./chart-layers";

export interface LayerPickerProps {
    /** Current on/off state per layer id. */
    layers: Record<ChartLayerId, boolean>;
    /** Resolved availability per layer id (per-symbol for GEX, else static). */
    availability: Record<ChartLayerId, boolean>;
    onToggle: (id: ChartLayerId) => void;
    /** Chip size variant for compact toolbars. */
    compact?: boolean;
}

export function LayerPicker({ layers, availability, onToggle, compact = false }: LayerPickerProps) {
    const [expandedId, setExpandedId] = useState<ChartLayerId | null>(null);
    const info = expandedId !== null ? LAYER_REQUIREMENTS[expandedId] : undefined;

    // Group layers by category for cleaner display
    const categories: Record<string, ChartLayerDef[]> = {
        "Candles": CHART_LAYERS.filter(l => ["volume", "vwap"].includes(l.id)),
        "Smart Money": CHART_LAYERS.filter(l => ["fvg", "orderBlocks", "bosChoch", "liquidityLevels", "equalHighsLows", "supportResistance", "sessionLevels", "prevDayHighLow"].includes(l.id)),
        "Trend": CHART_LAYERS.filter(l => ["ema9", "ema20", "ema50", "ema200", "sma20", "sma50", "sma200", "supertrend", "parabolicSar"].includes(l.id)),
        "Volatility": CHART_LAYERS.filter(l => ["bollingerBands", "keltnerChannels", "donchianChannels", "atrPane"].includes(l.id)),
        "Momentum": CHART_LAYERS.filter(l => ["rsiPane", "macdPane", "stochasticPane"].includes(l.id)),
        "Volume Profile": CHART_LAYERS.filter(l => ["volumeProfile", "poc", "valueArea", "hvnLvn", "delta", "cumulativeDelta"].includes(l.id)),
        "Special": CHART_LAYERS.filter(l => ["heikinAshi", "dailyPivots", "ichimokuCloud", "gex"].includes(l.id)),
        "Unavailable": CHART_LAYERS.filter(l => !l.available),
    };

    return (
        <div className="flex flex-col gap-4">
            {Object.entries(categories).map(([category, layerList]) => {
                const visibleLayers = layerList.filter(l => availability[l.id] || expandedId === l.id);
                if (visibleLayers.length === 0) return null;
                return (
                    <div key={category}>
                        <div className="mb-1.5 flex items-center">
                            <span className={cn(
                                "text-[10px] font-semibold uppercase tracking-wider",
                                category === "Unavailable" ? "text-muted-foreground" : "text-foreground/60"
                            )}>
                                {category}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {visibleLayers.map((l) => {
                                const available = availability[l.id];
                                const req = LAYER_REQUIREMENTS[l.id];
                                const isEstimatedChip = available && req?.estimated === true;
                                return (
                                    <button
                                        key={l.id}
                                        type="button"
                                        onClick={() => {
                                            if (available) {
                                                onToggle(l.id);
                                            } else {
                                                setExpandedId((cur) => (cur === l.id ? null : l.id));
                                            }
                                        }}
                                        aria-pressed={available ? layers[l.id] : undefined}
                                        aria-expanded={!available && expandedId === l.id}
                                        title={available ? l.label : `${l.label} — click for details`}
                                        className={cn(
                                            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition",
                                            compact ? "text-[11px] px-2 py-1" : "",
                                            available
                                                ? layers[l.id]
                                                    ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                                                    : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground"
                                                : expandedId === l.id
                                                    ? "border-dashed border-border bg-muted/60 text-muted-foreground"
                                                    : "border-dashed border-border/60 text-muted-foreground/70 hover:text-muted-foreground hover:border-border"
                                        )}
                                    >
                                        {!available ? <Lock className="size-3" /> : layers[l.id] ? <Check className="size-3" /> : null}
                                        <span className="flex-1 text-left">{l.label}</span>
                                        {!available && req ? <ChevronDown className={cn("size-3 transition", expandedId === l.id && "rotate-180")} /> : null}
                                        {isEstimatedChip ? <span aria-hidden className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-500">EST</span> : null}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
            {expandedId !== null && info ? (
                <LayerUnlockPanel
                    layerId={expandedId}
                    reason={info.reason}
                    unlock={info.unlock}
                    sources={info.sources}
                    onDismiss={() => setExpandedId(null)}
                />
            ) : null}
        </div>
    );
}

/**
 * Inline explanation panel for one degraded layer: why it's off, what data
 * would unlock it, and which concrete sources supply that data class.
 */
export function LayerUnlockPanel({
    layerId,
    reason,
    unlock,
    sources,
    onDismiss,
}: {
    layerId: ChartLayerId;
    reason: string;
    unlock: string;
    sources: string;
    onDismiss?: () => void;
}) {
    return (
        <div
            className="rounded-lg border border-dashed border-border bg-muted/40 p-2.5 text-[11px] leading-4"
            data-layer-unlock={layerId}
        >
            <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
                    <Info className="size-3 shrink-0" />
                    Why is this off?
                </p>
                {onDismiss ? (
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label="Dismiss explanation"
                        className="rounded px-1 text-[10px] text-muted-foreground transition hover:text-foreground"
                    >
                        ✕
                    </button>
                ) : null}
            </div>
            <p className="mt-1 text-muted-foreground">{reason}</p>
            <p className="mt-1.5 text-foreground">
                <span className="font-semibold">Unlock:</span> {unlock}
            </p>
            <p className="mt-0.5 text-muted-foreground">
                <span className="font-medium text-foreground/80">Sources:</span> {sources}
            </p>
        </div>
    );
}
