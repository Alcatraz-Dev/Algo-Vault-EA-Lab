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
import { Lock, ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHART_LAYERS, LAYER_REQUIREMENTS, type ChartLayerId } from "./chart-layers";

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

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-1.5">
                {CHART_LAYERS.map((l) => {
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
                                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition",
                                compact ? "text-[11px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
                                available
                                    ? layers[l.id]
                                        ? "border-primary/40 bg-primary/10 text-primary"
                                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                                    : expandedId === l.id
                                        ? "border-dashed border-border bg-muted/60 text-muted-foreground"
                                        : "border-dashed border-border/60 text-muted-foreground/70 hover:text-muted-foreground hover:border-border"
                            )}
                        >
                            {!available ? <Lock className="size-2.5" /> : null}
                            {l.label}
                            {!available && req ? <ChevronDown className={cn("size-2.5 transition", expandedId === l.id && "rotate-180")} /> : null}
                            {isEstimatedChip ? <span aria-hidden className="text-[9px] font-bold text-amber-500">EST</span> : null}
                        </button>
                    );
                })}
            </div>
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
