"use client";

/**
 * ChartToolbar — chart type + drawing tools + view controls for the Pro
 * Terminal chart surfaces.
 *
 * Also hosts the chart **settings panel**:
 *   • Theme presets (Midnight dark / Graphite MT5-style dark / Light)
 *   • Per-element colors: candles, background, grid, crosshair, BID/ASK,
 *     buy/sell entry, SL, TP, pending orders, AI lines
 *   • Display toggles: grid, volume, bid/ask, trade levels, history markers,
 *     price auto-scale, free movement
 *   • Drawing-tool style: color swatches, line width, font size and
 *     editable Fibonacci level values — applied to the next drawing placed
 *
 * Settings are controlled (settings + onSettingsChange) so the parent can
 * pass them straight into ProTerminalChart and persist them.
 */

import { useState } from "react";
import {
    CandlestickChart,
    BarChart3,
    LineChart,
    TrendingUp,
    Activity,
    MousePointer,
    TrendingUp as TrendlineIcon,
    Minus,
    Split,
    Box,
    Type,
    Ruler,
    Trash2,
    Maximize2,
    Minimize2,
    Grid3x3,
    Sun,
    Moon,
    Settings2,
    Sparkles,
    Lock,
    Scan,
    Undo2,
    Magnet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChartType, DrawingTool } from "@/components/pro-scalping-terminal/ProTerminalChart";
import {
    TOOL_COLOR_SWATCHES,
    parseFiboLevels,
    withPreset,
    type ChartPresetId,
    type ChartSettings,
} from "@/components/pro-scalping-terminal/chart-settings";

export interface ChartToolbarProps {
    chartType: ChartType;
    onChartTypeChange: (type: ChartType) => void;
    activeDrawingTool: DrawingTool;
    onDrawingToolChange: (tool: DrawingTool) => void;
    onClearDrawings: () => void;
    drawingCount: number;
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
    /** Toggle the chart's grid lines on/off. */
    onToggleGrid?: () => void;
    gridVisible?: boolean;
    /** Toggle the chart theme (dark/light). */
    onToggleTheme?: () => void;
    currentTheme?: "light" | "dark";
    /** Chart settings (colors / display / tool style) — controlled. */
    settings?: ChartSettings;
    onSettingsChange?: (updater: (prev: ChartSettings) => ChartSettings) => void;
    /** Reset viewport: fit content + re-enable the price auto-scale. */
    onFitView?: () => void;
    /** Undo the last placed drawing (the chart also handles Ctrl+Z). */
    onUndoDrawing?: () => void;
    /** Magnet: snap drawing prices to the nearest candle open/high/low/close. */
    magnet?: boolean;
    onToggleMagnet?: () => void;
    /** AI Draw (Pro): draw entry/SL/TP plan levels from the chart's candles. */
    aiDraw?: boolean;
    onToggleAiDraw?: () => void;
    /** True when AI Draw requires a Pro plan the current session lacks. */
    aiDrawLocked?: boolean;
    /** Access-check in flight (shows a busy state on the AI Draw button). */
    aiDrawChecking?: boolean;
}

const CHART_TYPES: Array<{ id: ChartType; label: string; icon: LucideIcon }> = [
    { id: "candlestick", label: "Candlestick", icon: CandlestickChart },
    { id: "bar", label: "Bar Chart", icon: BarChart3 },
    { id: "line", label: "Line Chart", icon: LineChart },
    { id: "area", label: "Area Chart", icon: TrendingUp },
    { id: "baseline", label: "Baseline", icon: Activity },
];

const DRAWING_TOOLS: Array<{ id: DrawingTool; label: string; icon: LucideIcon }> = [
    { id: "select", label: "Pointer / Select", icon: MousePointer },
    { id: "trendline", label: "Trendline", icon: TrendlineIcon },
    { id: "horizontal", label: "Horizontal Line", icon: Minus },
    { id: "vertical", label: "Vertical Line", icon: Split },
    { id: "fibo", label: "Fibonacci Retracement", icon: Activity },
    { id: "rectangle", label: "Rectangle / Box", icon: Box },
    { id: "text", label: "Text Label", icon: Type },
    { id: "ruler", label: "Measure / Ruler", icon: Ruler },
];

const PRESETS: Array<{ id: ChartPresetId; label: string; title: string }> = [
    { id: "midnight", label: "Midnight", title: "Pro Terminal dark theme (deep navy)" },
    { id: "graphite", label: "Graphite", title: "MT5-style dark workstation (charcoal)" },
    { id: "light", label: "Light", title: "TradingView-style light workspace" },
];

/** Color rows in the settings panel: [label, key]. */
const COLOR_ROWS: Array<{ label: string; key: keyof ChartSettings["colors"] }> = [
    { label: "Bull candle", key: "bull" },
    { label: "Bear candle", key: "bear" },
    { label: "Background", key: "background" },
    { label: "Grid", key: "grid" },
    { label: "Scale text", key: "text" },
    { label: "Crosshair", key: "crosshair" },
    { label: "BID line", key: "bidLine" },
    { label: "ASK line", key: "askLine" },
    { label: "Buy entry", key: "buyEntry" },
    { label: "Sell entry", key: "sellEntry" },
    { label: "Stop loss", key: "slLine" },
    { label: "Take profit", key: "tpLine" },
    { label: "Pending order", key: "pendingLine" },
    { label: "AI draw", key: "aiLine" },
];

const DISPLAY_ROWS: Array<{ label: string; key: keyof ChartSettings["display"]; hint: string }> = [
    { label: "Grid", key: "grid", hint: "Chart grid lines" },
    { label: "Volume", key: "volume", hint: "Volume histogram strip" },
    { label: "BID / ASK", key: "bidAsk", hint: "Bid line (and ask when a real quote provides it)" },
    { label: "Trade levels", key: "tradeLevels", hint: "Position entry/SL/TP and pending-order lines" },
    { label: "Trade history", key: "historyMarkers", hint: "Markers for recorded entry/exit fills" },
    { label: "Auto-scale", key: "autoScale", hint: "Price axis keeps fitting the visible range" },
    { label: "Free movement", key: "freeMove", hint: "Drag the chart in any direction, wheel/pinch zoom" },
    { label: "Magnet", key: "magnet", hint: "Snap drawing prices to the candle under the cursor (open/high/low/close)" },
];

/** `type="color"` needs a #hex value; presets may hold rgba() strings. */
function colorInputValue(v: string): string {
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    if (/^#[0-9a-fA-F]{3}$/.test(v)) {
        const h = v.slice(1);
        return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    return "#000000";
}

function FiboLevelsInput({
    value,
    onCommit,
    disabled,
}: {
    value: number[];
    onCommit: (levels: number[]) => void;
    disabled: boolean;
}) {
    const [draft, setDraft] = useState(value.join(", "));
    const [invalid, setInvalid] = useState(false);
    // Re-sync when the stored levels change externally (preset/reset).
    const [lastValue, setLastValue] = useState(value.join(", "));
    if (lastValue !== value.join(", ")) {
        setLastValue(value.join(", "));
        setDraft(value.join(", "));
        setInvalid(false);
    }
    return (
        <div className="flex items-center gap-1.5">
            <input
                type="text"
                value={draft}
                disabled={disabled}
                onChange={(e) => {
                    setDraft(e.target.value);
                    setInvalid(false);
                }}
                onBlur={() => {
                    const parsed = parseFiboLevels(draft);
                    if (parsed) {
                        onCommit(parsed);
                        setInvalid(false);
                    } else {
                        setDraft(value.join(", "));
                        setInvalid(false);
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className={cn(
                    "h-6 w-40 rounded border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none",
                    invalid ? "border-rose-500" : "border-border focus:border-primary"
                )}
                title="Comma-separated Fibonacci levels (values), e.g. 0, 0.382, 0.5, 0.618, 1"
            />
            <span className="text-[9px] text-muted-foreground">values</span>
        </div>
    );
}

function ChartToolbar({
    chartType,
    onChartTypeChange,
    activeDrawingTool,
    onDrawingToolChange,
    onClearDrawings,
    drawingCount,
    isFullscreen = false,
    onToggleFullscreen,
    onToggleGrid,
    gridVisible = true,
    onToggleTheme,
    currentTheme = "dark",
    settings,
    onSettingsChange,
    onFitView,
    onUndoDrawing,
    magnet = false,
    onToggleMagnet,
    aiDraw = false,
    onToggleAiDraw,
    aiDrawLocked = false,
    aiDrawChecking = false,
}: ChartToolbarProps) {
    const ActiveTypeIcon = CHART_TYPES.find((t) => t.id === chartType)?.icon || CandlestickChart;
    const [panelOpen, setPanelOpen] = useState(false);
    const [showToolStyle, setShowToolStyle] = useState(false);

    const update = (updater: (prev: ChartSettings) => ChartSettings) => onSettingsChange?.(updater);

    const setColor = (key: keyof ChartSettings["colors"], value: string) =>
        update((prev) => ({ ...prev, colors: { ...prev.colors, [key]: value } }));
    const setDisplay = (key: keyof ChartSettings["display"], value: boolean) =>
        update((prev) => ({ ...prev, display: { ...prev.display, [key]: value } }));
    const setTool = <K extends keyof ChartSettings["tools"]>(key: K, value: ChartSettings["tools"][K]) =>
        update((prev) => ({ ...prev, tools: { ...prev.tools, [key]: value } }));

    const display = settings?.display;
    const tools = settings?.tools;

    return (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Chart Types & Drawing Tools */}
                <div className="flex flex-wrap items-center gap-1">
                    {/* Chart Type Selector Dropdown */}
                    <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1 font-mono text-xs font-semibold text-foreground transition hover:bg-muted">
                            <ActiveTypeIcon className="size-3.5 text-primary" />
                            <span className="capitalize">{chartType}</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-40">
                            {CHART_TYPES.map((t) => {
                                const Icon = t.icon;
                                return (
                                    <DropdownMenuItem
                                        key={t.id}
                                        onClick={() => onChartTypeChange(t.id)}
                                        className={cn(
                                            "flex items-center gap-2 font-mono text-xs font-medium cursor-pointer",
                                            chartType === t.id && "bg-primary/10 font-bold text-primary"
                                        )}
                                    >
                                        <Icon className="size-3.5" />
                                        <span>{t.label}</span>
                                    </DropdownMenuItem>
                                );
                            })}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="mx-1 h-5 w-px bg-border" />

                    {/* Drawing Tools Buttons */}
                    <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
                        {DRAWING_TOOLS.map((t) => {
                            const Icon = t.icon;
                            const isActive = activeDrawingTool === t.id;
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    title={t.label}
                                    onClick={() => onDrawingToolChange(t.id)}
                                    className={cn(
                                        "flex size-7 items-center justify-center rounded-md text-xs transition-colors",
                                        isActive
                                            ? "bg-primary text-primary-foreground font-bold shadow-sm"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                >
                                    <Icon className="size-3.5" />
                                </button>
                            );
                        })}
                    </div>

                    {/* Active tool style: color + width shortcut */}
                    {settings && tools ? (
                        <button
                            type="button"
                            onClick={() => setShowToolStyle((s) => !s)}
                            aria-expanded={showToolStyle}
                            title="Tool style — color, width, font size, Fibonacci values"
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-1.5 transition hover:bg-muted"
                        >
                            <span
                                className="size-4 rounded border border-border"
                                style={{ background: tools.color }}
                                aria-hidden
                            />
                            <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                                {tools.lineWidth}px
                            </span>
                        </button>
                    ) : null}

                    {/* Undo the last placed object — quick reverse without
                        clearing everything (Ctrl+Z works on the chart too). */}
                    {drawingCount > 0 && onUndoDrawing ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onUndoDrawing}
                            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                            title="Undo last drawing (Ctrl+Z)"
                        >
                            <Undo2 className="size-3.5 mr-1" />
                            Undo
                        </Button>
                    ) : null}

                    {/* Clear Drawings Button */}
                    {drawingCount > 0 && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onClearDrawings}
                            className="h-7 px-2 text-[11px] text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
                            title="Clear all drawings on chart"
                        >
                            <Trash2 className="size-3.5 mr-1" />
                            Clear ({drawingCount})
                        </Button>
                    )}
                </div>

                {/* Right: AI draw / fit / grid / theme / settings / fullscreen */}
                <div className="flex items-center gap-1">
                    {onToggleAiDraw ? (
                        <Button
                            size="sm"
                            variant={aiDraw ? "default" : "ghost"}
                            onClick={onToggleAiDraw}
                            aria-pressed={aiDraw}
                            disabled={aiDrawChecking}
                            className={cn(
                                "h-8 gap-1 px-2 text-[11px]",
                                aiDraw
                                    ? "bg-violet-600 text-white hover:bg-violet-600/90"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                            title={
                                aiDrawLocked
                                    ? "AI Draw requires the Pro plan"
                                    : "AI Draw — derive entry/SL/TP levels from this chart's own candles"
                            }
                        >
                            {aiDrawLocked ? <Lock className="size-3.5" /> : <Sparkles className="size-3.5" />}
                            <span>AI Draw</span>
                            <span
                                className={cn(
                                    "rounded px-1 font-mono text-[9px] font-bold",
                                    aiDraw ? "bg-white/20 text-white" : "bg-violet-500/15 text-violet-400"
                                )}
                            >
                                PRO
                            </span>
                        </Button>
                    ) : null}

                    {onFitView ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onFitView}
                            className="h-8 px-2 text-muted-foreground hover:text-foreground"
                            title="Fit chart to data (resets zoom, re-enables auto-scale)"
                        >
                            <Scan className="size-4" />
                        </Button>
                    ) : null}

                    {onToggleMagnet ? (
                        <Button
                            size="sm"
                            variant={magnet ? "secondary" : "ghost"}
                            onClick={onToggleMagnet}
                            aria-pressed={magnet}
                            className={cn(
                                "h-8 px-2",
                                magnet ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                            title={
                                magnet
                                    ? "Magnet on — drawing prices snap to candle open/high/low/close"
                                    : "Magnet off — drawing prices follow the cursor exactly"
                            }
                        >
                            <Magnet className="size-4" />
                        </Button>
                    ) : null}

                    {onToggleGrid && (
                        <Button
                            size="sm"
                            variant={gridVisible ? "secondary" : "ghost"}
                            onClick={onToggleGrid}
                            aria-pressed={gridVisible}
                            className={cn(
                                "h-8 px-2",
                                gridVisible ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                            title={gridVisible ? "Hide grid lines" : "Show grid lines"}
                        >
                            <Grid3x3 className="size-4" />
                        </Button>
                    )}
                    {onToggleTheme && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onToggleTheme}
                            className="h-8 px-2 text-muted-foreground hover:text-foreground"
                            title={currentTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                        >
                            {currentTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                        </Button>
                    )}
                    {settings && onSettingsChange ? (
                        <Button
                            size="sm"
                            variant={panelOpen ? "secondary" : "ghost"}
                            onClick={() => setPanelOpen((o) => !o)}
                            aria-expanded={panelOpen}
                            className={cn(
                                "h-8 gap-1 px-2",
                                panelOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                            title="Chart settings — theme, colors, display, tool style"
                        >
                            <Settings2 className="size-4" />
                            <span className="hidden text-[11px] sm:inline">Settings</span>
                        </Button>
                    ) : null}
                    {onToggleFullscreen && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onToggleFullscreen}
                            className="h-8 px-2 text-muted-foreground hover:text-foreground"
                            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Chart"}
                        >
                            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                        </Button>
                    )}
                </div>
            </div>

            {/* ── Inline tool-style strip (quick access) ─────────────────── */}
            {showToolStyle && settings && tools && onSettingsChange ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-background px-2.5 py-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Tool style
                    </span>
                    <div className="flex items-center gap-1">
                        {TOOL_COLOR_SWATCHES.map((c) => (
                            <button
                                key={c}
                                type="button"
                                title={c}
                                onClick={() => setTool("color", c)}
                                className={cn(
                                    "size-5 rounded border-2 transition",
                                    tools.color.toLowerCase() === c.toLowerCase()
                                        ? "border-foreground scale-110"
                                        : "border-border hover:border-muted-foreground"
                                )}
                                style={{ background: c }}
                            />
                        ))}
                        <input
                            type="color"
                            value={colorInputValue(tools.color)}
                            onChange={(e) => setTool("color", e.target.value)}
                            className="h-5 w-7 cursor-pointer rounded border border-border bg-background"
                            title="Custom tool color"
                        />
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] text-muted-foreground">Width</span>
                        {[1, 2, 3, 4].map((w) => (
                            <button
                                key={w}
                                type="button"
                                onClick={() => setTool("lineWidth", w)}
                                aria-pressed={tools.lineWidth === w}
                                className={cn(
                                    "h-5 w-5 rounded border font-mono text-[10px] transition",
                                    tools.lineWidth === w
                                        ? "border-primary bg-primary/10 font-bold text-primary"
                                        : "border-border text-muted-foreground hover:bg-muted"
                                )}
                                title={`${w}px line width`}
                            >
                                {w}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] text-muted-foreground">Font</span>
                        {[9, 11, 13, 16].map((fs) => (
                            <button
                                key={fs}
                                type="button"
                                onClick={() => setTool("fontSize", fs)}
                                aria-pressed={tools.fontSize === fs}
                                className={cn(
                                    "h-5 rounded border px-1.5 font-mono text-[10px] transition",
                                    tools.fontSize === fs
                                        ? "border-primary bg-primary/10 font-bold text-primary"
                                        : "border-border text-muted-foreground hover:bg-muted"
                                )}
                                title={`${fs}px label font`}
                            >
                                {fs}
                            </button>
                        ))}
                    </div>
                    <FiboLevelsInput
                        value={tools.fiboLevels}
                        onCommit={(levels) => setTool("fiboLevels", levels)}
                        disabled={false}
                    />
                </div>
            ) : null}

            {/* ── Settings panel ─────────────────────────────────────────── */}
            {panelOpen && settings && onSettingsChange ? (
                <div className="grid gap-3 rounded-lg border border-border bg-background px-3 py-2.5 lg:grid-cols-3">
                    {/* Theme presets */}
                    <div className="flex flex-col gap-2">
                        <SectionTitle>Theme preset</SectionTitle>
                        <div className="flex gap-1">
                            {PRESETS.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    title={p.title}
                                    onClick={() => update((prev) => withPreset(prev, p.id))}
                                    className={cn(
                                        "rounded-md border px-2 py-1 font-mono text-[10px] font-semibold transition",
                                        settings.preset === p.id
                                            ? "border-primary bg-primary/10 text-primary"
                                            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        <SectionTitle>Display</SectionTitle>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                            {DISPLAY_ROWS.map((row) => (
                                <label
                                    key={row.key}
                                    className="flex cursor-pointer items-center justify-between gap-2 text-[10px] text-muted-foreground"
                                    title={row.hint}
                                >
                                    <span>{row.label}</span>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(display?.[row.key])}
                                        onChange={(e) => setDisplay(row.key, e.target.checked)}
                                        className="size-3.5 cursor-pointer accent-primary"
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Colors */}
                    <div className="flex flex-col gap-2">
                        <SectionTitle>Colors</SectionTitle>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                            {COLOR_ROWS.map((row) => (
                                <label
                                    key={row.key}
                                    className="flex cursor-pointer items-center justify-between gap-2 text-[10px] text-muted-foreground"
                                >
                                    <span>{row.label}</span>
                                    <input
                                        type="color"
                                        value={colorInputValue(settings.colors[row.key])}
                                        onChange={(e) => setColor(row.key, e.target.value)}
                                        className="h-5 w-7 cursor-pointer rounded border border-border bg-background"
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Drawing tool defaults */}
                    <div className="flex flex-col gap-2">
                        <SectionTitle>Next drawing</SectionTitle>
                        <div className="flex flex-wrap items-center gap-1">
                            {TOOL_COLOR_SWATCHES.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    title={c}
                                    onClick={() => setTool("color", c)}
                                    className={cn(
                                        "size-5 rounded border-2 transition",
                                        tools?.color.toLowerCase() === c.toLowerCase()
                                            ? "border-foreground scale-110"
                                            : "border-border hover:border-muted-foreground"
                                    )}
                                    style={{ background: c }}
                                />
                            ))}
                            <input
                                type="color"
                                value={colorInputValue(tools?.color ?? "#38bdf8")}
                                onChange={(e) => setTool("color", e.target.value)}
                                className="h-5 w-7 cursor-pointer rounded border border-border bg-background"
                                title="Custom tool color"
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                                Width
                                {[1, 2, 3, 4].map((w) => (
                                    <button
                                        key={w}
                                        type="button"
                                        onClick={() => setTool("lineWidth", w)}
                                        aria-pressed={tools?.lineWidth === w}
                                        className={cn(
                                            "h-5 w-5 rounded border font-mono transition",
                                            tools?.lineWidth === w
                                                ? "border-primary bg-primary/10 font-bold text-primary"
                                                : "border-border hover:bg-muted"
                                        )}
                                    >
                                        {w}
                                    </button>
                                ))}
                            </span>
                            <span className="inline-flex items-center gap-1">
                                Font
                                {[9, 11, 13, 16].map((fs) => (
                                    <button
                                        key={fs}
                                        type="button"
                                        onClick={() => setTool("fontSize", fs)}
                                        aria-pressed={tools?.fontSize === fs}
                                        className={cn(
                                            "h-5 rounded border px-1.5 font-mono transition",
                                            tools?.fontSize === fs
                                                ? "border-primary bg-primary/10 font-bold text-primary"
                                                : "border-border hover:bg-muted"
                                        )}
                                    >
                                        {fs}
                                    </button>
                                ))}
                            </span>
                        </div>
                        {tools ? (
                            <FiboLevelsInput
                                value={tools.fiboLevels}
                                onCommit={(levels) => setTool("fiboLevels", levels)}
                                disabled={false}
                            />
                        ) : null}
                        <p className="text-[9px] leading-3 text-muted-foreground/70">
                            Style applies to the next drawing placed; existing drawings keep their own
                            color and width. Fibonacci values accept a comma-separated list.
                        </p>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h4 className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {children}
        </h4>
    );
}

export default ChartToolbar;
