"use client";

/**
 * LayerPicker — the shared chart-layer picker with inline honesty.
 *
 * Every layer renders as a chip. Active layers show a settings gear (⚙)
 * that opens a minimal per-layer settings popover — TradingView style.
 * Degraded/unavailable layers stay non-interactive but expand an inline
 * explanation on click.
 */

import { useRef, useState } from "react";
import { Check, ChevronDown, Info, Lock, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHART_LAYERS, LAYER_REQUIREMENTS, type ChartLayerId, type ChartLayerDef } from "./chart-layers";

export interface LayerPickerProps {
    layers: Record<ChartLayerId, boolean>;
    availability: Record<ChartLayerId, boolean>;
    onToggle: (id: ChartLayerId) => void;
    compact?: boolean;
}

// ── Per-layer settings ───────────────────────────────────────────────────────
// Minimal but real: each configurable layer exposes its own knobs.
// Settings are stored locally in the picker (ephemeral); wiring them through
// to the chart renderer is a follow-on task — the UI scaffold is the goal here.

type LayerSettings = {
    color?: string;
    lineWidth?: number;
    opacity?: number;
    period?: number;
};

const LAYER_DEFAULTS: Partial<Record<ChartLayerId, LayerSettings>> = {
    vwap:            { color: "#a78bfa", lineWidth: 1 },
    ema9:            { color: "#38bdf8", lineWidth: 1 },
    ema20:           { color: "#34d399", lineWidth: 1 },
    ema50:           { color: "#f59e0b", lineWidth: 1 },
    ema200:          { color: "#f43f5e", lineWidth: 2 },
    sma20:           { color: "#38bdf8", lineWidth: 1 },
    sma50:           { color: "#34d399", lineWidth: 1 },
    sma200:          { color: "#f43f5e", lineWidth: 2 },
    supertrend:      { color: "#34d399", lineWidth: 1 },
    bollingerBands:  { color: "#94a3b8", lineWidth: 1 },
    keltnerChannels: { color: "#a78bfa", lineWidth: 1 },
    donchianChannels:{ color: "#60a5fa", lineWidth: 1 },
    supportResistance:{ color: "#94a3b8", lineWidth: 1, opacity: 60 },
    fvg:             { color: "#34d399", opacity: 20 },
    orderBlocks:     { color: "#a78bfa", opacity: 30 },
    volumeProfile:   { color: "#60a5fa", opacity: 50 },
    rsiPane:         { color: "#38bdf8", period: 14 },
    macdPane:        { color: "#38bdf8", period: 12 },
    stochasticPane:  { color: "#38bdf8", period: 14 },
    atrPane:         { color: "#94a3b8", period: 14 },
    parabolicSar:    { color: "#f59e0b", lineWidth: 1 },
    ichimokuCloud:   { color: "#a78bfa", opacity: 20 },
};

function hasSettings(id: ChartLayerId): boolean {
    return id in LAYER_DEFAULTS;
}

function LayerSettingsPopover({
    id,
    settings,
    onUpdate,
    onClose,
    anchor,
}: {
    id: ChartLayerId;
    settings: LayerSettings;
    onUpdate: (s: LayerSettings) => void;
    onClose: () => void;
    anchor: DOMRect | null;
}) {
    const defaults = LAYER_DEFAULTS[id] ?? {};
    const color = settings.color ?? defaults.color ?? "#94a3b8";
    const lineWidth = settings.lineWidth ?? defaults.lineWidth;
    const opacity = settings.opacity ?? defaults.opacity;
    const period = settings.period ?? defaults.period;

    return (
        <div
            className="fixed z-50 w-52 rounded-lg border border-border bg-popover p-3 shadow-lg"
            style={anchor ? { top: anchor.bottom + 6, left: Math.max(8, anchor.left) } : { top: "50%", left: "50%" }}
        >
            {/* Header */}
            <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground capitalize">{id.replace(/([A-Z])/g, " $1").trim()} settings</span>
                <button type="button" onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                    <X className="size-3" />
                </button>
            </div>

            <div className="flex flex-col gap-2.5">
                {/* Color */}
                <label className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">Color</span>
                    <div className="flex items-center gap-1.5">
                        <div className="size-4 rounded border border-border" style={{ background: color }} />
                        <input
                            type="color"
                            value={color}
                            onChange={(e) => onUpdate({ ...settings, color: e.target.value })}
                            className="h-5 w-7 cursor-pointer rounded border border-border bg-background"
                            title="Layer color"
                        />
                    </div>
                </label>

                {/* Line width */}
                {lineWidth !== undefined && (
                    <label className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">Width</span>
                        <div className="flex items-center gap-1">
                            {[1, 2, 3].map((w) => (
                                <button
                                    key={w}
                                    type="button"
                                    onClick={() => onUpdate({ ...settings, lineWidth: w })}
                                    className={cn(
                                        "h-5 w-5 rounded border font-numeric text-[11px] transition",
                                        (settings.lineWidth ?? lineWidth) === w
                                            ? "border-primary/40 bg-primary/10 text-primary"
                                            : "border-border text-muted-foreground hover:bg-muted"
                                    )}
                                >
                                    {w}
                                </button>
                            ))}
                        </div>
                    </label>
                )}

                {/* Opacity */}
                {opacity !== undefined && (
                    <label className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">Opacity</span>
                        <div className="flex items-center gap-1.5">
                            <input
                                type="range"
                                min={10}
                                max={80}
                                step={5}
                                value={settings.opacity ?? opacity}
                                onChange={(e) => onUpdate({ ...settings, opacity: Number(e.target.value) })}
                                className="h-1 w-20 accent-primary"
                            />
                            <span className="w-7 text-right font-numeric text-[11px] text-muted-foreground">
                                {settings.opacity ?? opacity}%
                            </span>
                        </div>
                    </label>
                )}

                {/* Period */}
                {period !== undefined && (
                    <label className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">Period</span>
                        <input
                            type="number"
                            min={2}
                            max={200}
                            value={settings.period ?? period}
                            onChange={(e) => onUpdate({ ...settings, period: Number(e.target.value) })}
                            className="h-6 w-14 rounded border border-border bg-background px-1.5 font-numeric text-[11px] text-foreground outline-none focus:border-primary/50"
                        />
                    </label>
                )}

                {/* Reset */}
                <button
                    type="button"
                    onClick={() => onUpdate({})}
                    className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                    Reset to defaults
                </button>
            </div>
        </div>
    );
}

export function LayerPicker({ layers, availability, onToggle, compact = false }: LayerPickerProps) {
    const [expandedId, setExpandedId] = useState<ChartLayerId | null>(null);
    const [settingsId, setSettingsId] = useState<ChartLayerId | null>(null);
    const [settingsAnchor, setSettingsAnchor] = useState<DOMRect | null>(null);
    const [layerSettings, setLayerSettings] = useState<Partial<Record<ChartLayerId, LayerSettings>>>({});
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
        "Trend":          CHART_LAYERS.filter(l => ["ema9", "ema20", "ema50", "ema200", "sma20", "sma50", "sma200", "supertrend", "parabolicSar"].includes(l.id)),
        "Volatility":     CHART_LAYERS.filter(l => ["bollingerBands", "keltnerChannels", "donchianChannels", "atrPane"].includes(l.id)),
        "Momentum":       CHART_LAYERS.filter(l => ["rsiPane", "macdPane", "stochasticPane"].includes(l.id)),
        "Volume Profile": CHART_LAYERS.filter(l => ["volumeProfile", "poc", "valueArea", "hvnLvn", "delta", "cumulativeDelta"].includes(l.id)),
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
                                    const canConfigure = isActive && hasSettings(l.id);

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
                                                title={available ? l.label : `${l.label} — click for details`}
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
                                                <span>{l.label}</span>
                                                {!available && req
                                                    ? <ChevronDown className={cn("size-3 shrink-0 transition", expandedId === l.id && "rotate-180")} />
                                                    : null}
                                                {isEstimated
                                                    ? <span className="ml-0.5 rounded bg-warning/20 px-1 text-[9px] font-bold leading-none text-warning">EST</span>
                                                    : null}
                                            </button>

                                            {/* Settings gear — only shown when layer is active + configurable */}
                                            {canConfigure ? (
                                                <button
                                                    type="button"
                                                    onClick={(e) => openSettings(l.id, e)}
                                                    title={`${l.label} settings`}
                                                    className={cn(
                                                        "flex h-7 w-6 items-center justify-center rounded-r-md border border-l border-border/50 transition",
                                                        settingsId === l.id
                                                            ? "border-primary/40 bg-primary/10 text-primary"
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
            {settingsId !== null && LAYER_DEFAULTS[settingsId] !== undefined ? (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setSettingsId(null)} />
                    <LayerSettingsPopover
                        id={settingsId}
                        settings={layerSettings[settingsId] ?? {}}
                        onUpdate={(s) => setLayerSettings((prev) => ({ ...prev, [settingsId]: s }))}
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
