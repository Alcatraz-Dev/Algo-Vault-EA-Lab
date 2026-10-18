"use client";

/**
 * LayerPicker — the shared chart-layer picker with inline honesty.
 *
 * Every layer renders as a chip. Active layers whose appearance/inputs are
 * user-editable (see `indicator-params.ts`) show a settings gear (⚙) that
 * opens a schema-generated settings popover — TradingView style. The popover
 * is fully controlled: values live in the parent's persisted chart settings
 * (`ChartSettings.indicators`) and every change flows back through
 * `onParamsChange`, so what the settings say is exactly what the chart draws.
 * Degraded/unavailable layers stay non-interactive but expand an inline
 * explanation on click.
 */

import { useState } from "react";
import { Check, ChevronDown, Info, Lock, RotateCcw, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHART_LAYERS, LAYER_REQUIREMENTS, type ChartLayerId, type ChartLayerDef } from "./chart-layers";
import {
    hasIndicatorParams,
    indicatorLabel,
    indicatorParamSpecs,
    isIndicatorCustomised,
    resolveIndicatorParams,
    type IndicatorParamSpec,
    type IndicatorSettings,
} from "./indicator-params";

export interface LayerPickerProps {
    layers: Record<ChartLayerId, boolean>;
    availability: Record<ChartLayerId, boolean>;
    onToggle: (id: ChartLayerId) => void;
    /** The persisted per-indicator parameters the settings popover edits. */
    params: IndicatorSettings;
    onParamsChange: (id: ChartLayerId, key: string, value: number | string) => void;
    onParamsReset: (id: ChartLayerId) => void;
}

// ── settings popover (schema-generated, never hand-coded per layer) ─────────

/**
 * Numeric input with a local draft, so clearing the box to retype it does not
 * slam the indicator back to its default mid-edit. Valid edits commit as you
 * type (the schema clamps them onto the spec); the resolved value takes over
 * again on blur.
 */
function NumberField({
    spec,
    value,
    onCommit,
}: {
    spec: IndicatorParamSpec;
    value: number;
    onCommit: (v: number) => void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <input
            type="number"
            inputMode="decimal"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={draft ?? String(value)}
            onChange={(e) => {
                const raw = e.target.value;
                setDraft(raw);
                const n = Number(raw);
                if (raw.trim() !== "" && Number.isFinite(n)) onCommit(n);
            }}
            onBlur={() => setDraft(null)}
            className="h-6 w-16 rounded border border-border bg-background px-1.5 text-right font-numeric text-[11px] text-foreground outline-none transition focus:border-primary/50"
        />
    );
}

function LayerSettingsPopover({
    id,
    label,
    params,
    onParamsChange,
    onParamsReset,
    onClose,
    anchor,
}: {
    id: ChartLayerId;
    label: string;
    params: IndicatorSettings;
    onParamsChange: (id: ChartLayerId, key: string, value: number | string) => void;
    onParamsReset: (id: ChartLayerId) => void;
    onClose: () => void;
    anchor: DOMRect | null;
}) {
    const specs = indicatorParamSpecs(id);
    const values = resolveIndicatorParams(id, params);

    return (
        <div
            className="fixed z-50 max-h-[70vh] w-56 overflow-y-auto rounded-lg border border-border bg-popover p-3 shadow-lg"
            style={anchor ? { top: anchor.bottom + 6, left: Math.max(8, Math.min(anchor.left, window.innerWidth - 240)) } : { top: "50%", left: "50%" }}
        >
            {/* Header */}
            <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">{label} settings</span>
                <button type="button" onClick={onClose} aria-label="Close settings" className="rounded p-0.5 text-muted-foreground transition hover:text-foreground">
                    <X className="size-3" />
                </button>
            </div>

            <div className="flex flex-col gap-2.5">
                {specs.map((spec) => {
                    const value = values[spec.key];

                    if (spec.kind === "color") {
                        const hex = typeof value === "string" ? value : String(spec.default);
                        return (
                            <div key={spec.key} className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-muted-foreground">{spec.label}</span>
                                <div className="flex items-center gap-1.5">
                                    <div className="size-4 rounded border border-border" style={{ background: hex }} />
                                    <input
                                        type="color"
                                        value={hex}
                                        onChange={(e) => onParamsChange(id, spec.key, e.target.value)}
                                        className="h-5 w-7 cursor-pointer rounded border border-border bg-background"
                                        title={spec.label}
                                        aria-label={spec.label}
                                    />
                                </div>
                            </div>
                        );
                    }

                    if (spec.kind === "width") {
                        return (
                            <div key={spec.key} className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-muted-foreground">{spec.label}</span>
                                <div className="flex items-center gap-1">
                                    {[1, 2, 3].map((w) => (
                                        <button
                                            key={w}
                                            type="button"
                                            onClick={() => onParamsChange(id, spec.key, w)}
                                            aria-pressed={value === w}
                                            className={cn(
                                                "h-5 w-5 rounded border font-numeric text-[11px] transition",
                                                value === w
                                                    ? "border-primary/40 bg-primary/10 text-primary"
                                                    : "border-border text-muted-foreground hover:bg-muted"
                                            )}
                                        >
                                            {w}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div key={spec.key} className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-muted-foreground">{spec.label}</span>
                            <span className="flex items-center gap-1">
                                <NumberField
                                    spec={spec}
                                    value={typeof value === "number" ? value : Number(spec.default)}
                                    onCommit={(v) => onParamsChange(id, spec.key, v)}
                                />
                                {spec.unit ? <span className="text-[10px] text-muted-foreground">{spec.unit}</span> : null}
                            </span>
                        </div>
                    );
                })}

                {/* Reset — forgets this layer's overrides, back to the schema defaults */}
                <button
                    type="button"
                    onClick={() => onParamsReset(id)}
                    className="mt-0.5 flex w-full items-center justify-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                    <RotateCcw className="size-3" />
                    Reset to defaults
                </button>
            </div>
        </div>
    );
}

export function LayerPicker({
    layers,
    availability,
    onToggle,
    params,
    onParamsChange,
    onParamsReset,
}: LayerPickerProps) {
    const [expandedId, setExpandedId] = useState<ChartLayerId | null>(null);
    const [settingsId, setSettingsId] = useState<ChartLayerId | null>(null);
    const [settingsAnchor, setSettingsAnchor] = useState<DOMRect | null>(null);
    const info = expandedId !== null ? LAYER_REQUIREMENTS[expandedId] : undefined;

    const openSettings = (id: ChartLayerId, e: React.MouseEvent) => {
        e.stopPropagation();
        if (settingsId === id) {
            setSettingsId(null);
            return;
        }
        setSettingsAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
        setSettingsId(id);
    };

    const categories: Record<string, ChartLayerDef[]> = {
        "Candles":        CHART_LAYERS.filter(l => ["volume", "vwap"].includes(l.id)),
        "Smart Money":    CHART_LAYERS.filter(l => ["fvg", "orderBlocks", "bosChoch", "liquidityLevels", "equalHighsLows", "supportResistance", "sessionLevels", "prevDayHighLow"].includes(l.id)),
        "Trend":          CHART_LAYERS.filter(l => ["ema9", "ema20", "ema50", "ema200", "sma20", "sma50", "sma200", "wma", "supertrend", "parabolicSar", "adxPane"].includes(l.id)),
        "Volatility":     CHART_LAYERS.filter(l => ["bollingerBands", "keltnerChannels", "donchianChannels", "atrPane"].includes(l.id)),
        "Momentum":       CHART_LAYERS.filter(l => ["rsiPane", "macdPane", "stochasticPane", "awesomeOscillator"].includes(l.id)),
        "Volume Profile": CHART_LAYERS.filter(l => ["volumeProfile", "poc", "valueArea", "hvnLvn", "delta", "cumulativeDelta", "obvPane"].includes(l.id)),
        "Special":        CHART_LAYERS.filter(l => ["heikinAshi", "dailyPivots", "ichimokuCloud", "gex"].includes(l.id)),
    };

    return (
        <>
            <div className="flex flex-col gap-4">
                {Object.entries(categories).map(([category, layerList]) => {
                    const visibleLayers = layerList.filter(l => availability[l.id] || expandedId === l.id);
                    if (visibleLayers.length === 0) return null;
                    return (
                        <div key={category}>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/50">
                                {category}
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {visibleLayers.map((l) => {
                                    const available = availability[l.id];
                                    const req = LAYER_REQUIREMENTS[l.id];
                                    const isActive = available && layers[l.id];
                                    const isEstimated = available && req?.estimated === true;
                                    const canConfigure = isActive && hasIndicatorParams(l.id);
                                    const customised = canConfigure && isIndicatorCustomised(l.id, params);

                                    return (
                                        <div key={l.id} className="relative flex items-stretch">
                                            {/* Main toggle button */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (available) {
                                                        onToggle(l.id);
                                                        if (settingsId === l.id) setSettingsId(null);
                                                    } else {
                                                        setExpandedId((cur) => (cur === l.id ? null : l.id));
                                                    }
                                                }}
                                                aria-pressed={available ? layers[l.id] : undefined}
                                                aria-expanded={!available && expandedId === l.id}
                                                title={available ? indicatorLabel(l.id, l.label, params) : `${l.label} — click for details`}
                                                className={cn(
                                                    "inline-flex h-7 items-center gap-1 border pl-2 text-xs transition",
                                                    canConfigure ? "rounded-l-md rounded-r-none border-r-0 pr-2" : "rounded-md pr-2",
                                                    available
                                                        ? isActive
                                                            ? "border-primary/40 bg-primary/10 text-primary"
                                                            : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground"
                                                        : expandedId === l.id
                                                            ? "border-dashed border-border bg-muted/60 text-muted-foreground"
                                                            : "border-dashed border-border/60 text-muted-foreground/60 hover:border-border hover:text-muted-foreground"
                                                )}
                                            >
                                                {!available
                                                    ? <Lock className="size-3 shrink-0" />
                                                    : isActive
                                                        ? <Check className="size-3 shrink-0" />
                                                        : null}
                                                {/* Label carries an edited length, so the chip can never
                                                    advertise a period the chart is not drawing. */}
                                                <span>{indicatorLabel(l.id, l.label, params)}</span>
                                                {!available && req
                                                    ? <ChevronDown className={cn("size-3 shrink-0 transition", expandedId === l.id && "rotate-180")} />
                                                    : null}
                                                {isEstimated
                                                    ? <span className="ml-0.5 rounded bg-warning/20 px-1 text-[9px] font-bold leading-none text-warning">EST</span>
                                                    : null}
                                            </button>

                                            {/* Settings gear — only shown when the layer is active and
                                                actually has editable inputs (schema-driven). A tinted
                                                gear marks non-default values at a glance. */}
                                            {canConfigure ? (
                                                <button
                                                    type="button"
                                                    onClick={(e) => openSettings(l.id, e)}
                                                    title={`${l.label} settings${customised ? " (customised)" : ""}`}
                                                    data-customised={customised || undefined}
                                                    className={cn(
                                                        "flex h-7 w-6 items-center justify-center rounded-r-md border border-l border-border/50 transition",
                                                        settingsId === l.id
                                                            ? "border-primary/40 bg-primary/10 text-primary"
                                                            : customised
                                                                ? "border-border bg-background text-primary/90"
                                                                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                                                    )}
                                                >
                                                    <Settings2 className="size-3" />
                                                </button>
                                            ) : null}
                                        </div>
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

            {/* Settings popover — rendered outside the scroll container via fixed positioning */}
            {settingsId !== null && hasIndicatorParams(settingsId) ? (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setSettingsId(null)} />
                    <LayerSettingsPopover
                        id={settingsId}
                        label={CHART_LAYERS.find((l) => l.id === settingsId)?.label ?? settingsId}
                        params={params}
                        onParamsChange={onParamsChange}
                        onParamsReset={onParamsReset}
                        onClose={() => setSettingsId(null)}
                        anchor={settingsAnchor}
                    />
                </>
            ) : null}
        </>
    );
}

export function LayerUnlockPanel({
    layerId, reason, unlock, sources, onDismiss,
}: {
    layerId: ChartLayerId;
    reason: string;
    unlock: string;
    sources: string;
    onDismiss?: () => void;
}) {
    return (
        <div className="rounded-lg border border-dashed border-border bg-muted/40 p-2.5 text-[11px] leading-4" data-layer-unlock={layerId}>
            <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
                    <Info className="size-3 shrink-0" />
                    Why is this off?
                </p>
                {onDismiss ? (
                    <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded px-1 text-muted-foreground transition hover:text-foreground">
                        <X className="size-3" />
                    </button>
                ) : null}
            </div>
            <p className="mt-1 text-muted-foreground">{reason}</p>
            <p className="mt-1.5 text-foreground"><span className="font-semibold">Unlock:</span> {unlock}</p>
            <p className="mt-0.5 text-muted-foreground"><span className="font-medium text-foreground/80">Sources:</span> {sources}</p>
        </div>
    );
}
