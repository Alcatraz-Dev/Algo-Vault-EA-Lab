/**
 * Pro Terminal chart settings — theming, display flags and drawing-tool style.
 *
 * Every value here is a *view preference* chosen by the user (or a preset).
 * Nothing in this module invents market data: bid/ask/position/level prices
 * always arrive from real feeds or the caller's own execution data.
 *
 * Presets:
 *   • midnight  — the Pro Terminal dark theme (deep navy-black, soft grid)
 *   • graphite  — MT5-style dark workstation (charcoal panels, classic green/red)
 *   • light     — TradingView-style light workspace
 *
 * Also home to the trade-view contracts the chart renders on the price pane:
 * open positions (entry/SL/TP), pending orders (buy/sell limit & stop), and
 * historical fills (entry/exit markers) — plus the pure helpers used by the
 * UI (partial-close lot math, execution-log mapping) so they stay testable.
 */

// ── settings model ─────────────────────────────────────────────────────────

export type ChartPresetId = "midnight" | "graphite" | "light";

export interface ChartSettingsColors {
    /** Chart pane background. */
    background: string;
    /** Grid lines. */
    grid: string;
    /** Price/time scale + HUD text drawn by the chart library. */
    text: string;
    /** Crosshair. */
    crosshair: string;
    /** Bullish candle body/wick. */
    bull: string;
    /** Bearish candle body/wick. */
    bear: string;
    /** Bullish candle upper/lower wick or fill. */
    bullFill: string;
    /** Bearish candle upper/lower wick or fill. */
    bearFill: string;
    /** Bid line (real-time quote / last price). */
    bidLine: string;
    /** Ask line (only drawn when a real ask is known). */
    askLine: string;
    /** Open BUY position entry line. */
    buyEntry: string;
    /** Open SELL position entry line. */
    sellEntry: string;
    /** Stop-loss level line. */
    slLine: string;
    /** Take-profit level line. */
    tpLine: string;
    /** Pending order line (buy/sell limit & stop). */
    pendingLine: string;
    /** AI-drawn plan lines. */
    aiLine: string;
    /** Bar-close countdown line + its price-axis tag. */
    countdownLine: string;
}

export interface ChartDisplaySettings {
    /** Show the chart grid. */
    grid: boolean;
    /** Show the volume histogram pane strip. */
    volume: boolean;
    /** Show BID/ASK lines from the live quote. */
    bidAsk: boolean;
    /** Show open-position and pending-order lines (entry / SL / TP). */
    tradeLevels: boolean;
    /** Show historical entry/exit fills as chart markers. */
    historyMarkers: boolean;
    /** Keep the price axis auto-fitting the visible range. */
    autoScale: boolean;
    /** Free movement: allow dragging the chart in every direction + zooming. */
    freeMove: boolean;
    /** Magnet: snap drawing prices to the nearest candle open/high/low/close. */
    magnet: boolean;
    /** Show the countdown timer: the closing time of the current bar while the
     *  market trades, or the time to the next weekly open while it is closed.
     *  false = hidden (the open/closed badge itself always shows). */
    showBarCloseCountdown: boolean;
}

export interface ChartToolSettings {
    /** Color applied to the next drawing the user places. */
    color: string;
    /** Stroke width (1–4 px) applied to the next drawing. */
    lineWidth: number;
    /** Font size for text/ruler/fib labels. */
    fontSize: number;
    /** Line style for the next drawing: solid, dashed, or dotted. */
    lineStyle: "solid" | "dashed" | "dotted";
    /** Fibonacci levels (fractions, ascending). Editable "values". */
    fiboLevels: number[];
    /** Bar width for candles/bars (px). 0 = auto-width (traditional candle look). */
    candleWidth: number;
}

export interface ChartSettings {
    preset: ChartPresetId;
    colors: ChartSettingsColors;
    display: ChartDisplaySettings;
    tools: ChartToolSettings;
}

// ── presets ────────────────────────────────────────────────────────────────

/** Default drawing color (matches the chart's line/area accent). */
export const DEFAULT_TOOL_COLOR = "#38bdf8";
export const DEFAULT_FIBO_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Swatches offered in the tool color picker. */
export const TOOL_COLOR_SWATCHES = [
    "#38bdf8",
    "#22d3ee",
    "#34d399",
    "#f59e0b",
    "#f43f5e",
    "#a78bfa",
    "#eab308",
    "#94a3b8",
] as const;

type PresetColors = Omit<ChartSettingsColors, never>;

function presetColors(preset: ChartPresetId): PresetColors {
    switch (preset) {
        case "graphite":
            // MT5-style workstation: charcoal chrome, classic saturated
            // green/red candles, high-contrast level lines.
            return {
                background: "#1b1f27",
                grid: "rgba(255, 255, 255, 0.07)",
                text: "#a8b0bd",
                crosshair: "rgba(255, 255, 255, 0.45)",
                bull: "#26a69a",
                bear: "#ef5350",
                bullFill: "rgba(38, 166, 154, 0.15)",
                bearFill: "rgba(239, 83, 80, 0.15)",
                bidLine: "#42a5f5",
                askLine: "#ffb74d",
                buyEntry: "#29b6f6",
                sellEntry: "#ec407a",
                slLine: "#ef5350",
                tpLine: "#66bb6a",
                pendingLine: "#ab47bc",
                aiLine: "#7e57c2",
                countdownLine: "#00bcd4",
            };
        case "light":
            return {
                background: "#ffffff",
                grid: "rgba(148, 163, 184, 0.22)",
                text: "#546a82",
                crosshair: "rgba(234, 123, 74, 0.55)",
                bull: "#26a69a",
                bear: "#ef5350",
                bullFill: "rgba(38, 166, 154, 0.15)",
                bearFill: "rgba(239, 83, 80, 0.15)",
                bidLine: "#1976d2",
                askLine: "#ef6c00",
                buyEntry: "#1565c0",
                sellEntry: "#c2185b",
                slLine: "#d32f2f",
                tpLine: "#2e7d32",
                pendingLine: "#7b1fa2",
                aiLine: "#5e35b1",
                countdownLine: "#00838f",
            };
        case "midnight":
        default:
            // Pro Terminal default: deep navy-black with softened grid.
            return {
                background: "#0b0f17",
                grid: "rgba(148, 163, 184, 0.08)",
                text: "#8b98ad",
                crosshair: "rgba(255, 255, 255, 0.35)",
                bull: "#26a69a",
                bear: "#ef5350",
                bullFill: "rgba(38, 166, 154, 0.15)",
                bearFill: "rgba(239, 83, 80, 0.15)",
                bidLine: "#38bdf8",
                askLine: "#f59e0b",
                buyEntry: "#2196f3",
                sellEntry: "#ec407a",
                slLine: "#ef4444",
                tpLine: "#22c55e",
                pendingLine: "#a78bfa",
                aiLine: "#8b5cf6",
                countdownLine: "#22d3ee",
            };
    }
}

/** The dark theme baseline used when no persisted settings exist. */
export const DARK_PRESET: ChartPresetId = "midnight";

export function defaultChartSettings(preset: ChartPresetId = DARK_PRESET): ChartSettings {
    return {
        preset,
        colors: presetColors(preset),
        display: {
            grid: true,
            volume: true,
            bidAsk: true,
            tradeLevels: true,
            historyMarkers: true,
            autoScale: true,
            freeMove: true,
            magnet: true,
            showBarCloseCountdown: true,
        },
        tools: {
            color: DEFAULT_TOOL_COLOR,
            lineWidth: 1,
            fontSize: 12,
            lineStyle: "dashed" as const,
            fiboLevels: [...DEFAULT_FIBO_LEVELS],
            candleWidth: 0, // 0 = auto-width (traditional candle look)
        },
    };
}

/** Apply a preset's colors while keeping the user's display/tool choices. */
export function withPreset(settings: ChartSettings, preset: ChartPresetId): ChartSettings {
    return { ...settings, preset, colors: presetColors(preset) };
}

// ── persistence ────────────────────────────────────────────────────────────

export const CHART_SETTINGS_STORAGE_KEY = "pro_terminal_chart_settings_v1";

function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

function mergeColors(base: ChartSettingsColors, input: unknown): ChartSettingsColors {
    if (!input || typeof input !== "object") return base;
    const out = { ...base };
    for (const key of Object.keys(base) as Array<keyof ChartSettingsColors>) {
        const v = (input as Record<string, unknown>)[key];
        if (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v)) out[key] = v;
        else if (typeof v === "string" && v.startsWith("rgba(")) out[key] = v;
    }
    return out;
}

/**
 * Deep-merge arbitrary (possibly corrupt) persisted input onto the defaults.
 * Unknown values fall back to the preset — settings can never put the chart
 * into an unrenderable state.
 */
export function mergeChartSettings(input: unknown): ChartSettings {
    const raw = (input ?? {}) as Record<string, unknown>;
    const preset: ChartPresetId =
        raw.preset === "graphite" || raw.preset === "light" || raw.preset === "midnight"
            ? raw.preset
            : DARK_PRESET;
    const base = defaultChartSettings(preset);

    const d = (raw.display ?? {}) as Record<string, unknown>;
    const display: ChartDisplaySettings = {
        grid: typeof d.grid === "boolean" ? d.grid : base.display.grid,
        volume: typeof d.volume === "boolean" ? d.volume : base.display.volume,
        bidAsk: typeof d.bidAsk === "boolean" ? d.bidAsk : base.display.bidAsk,
        tradeLevels: typeof d.tradeLevels === "boolean" ? d.tradeLevels : base.display.tradeLevels,
        historyMarkers: typeof d.historyMarkers === "boolean" ? d.historyMarkers : base.display.historyMarkers,
        autoScale: typeof d.autoScale === "boolean" ? d.autoScale : base.display.autoScale,
        freeMove: typeof d.freeMove === "boolean" ? d.freeMove : base.display.freeMove,
        magnet: typeof d.magnet === "boolean" ? d.magnet : base.display.magnet,
        showBarCloseCountdown: typeof d.showBarCloseCountdown === "boolean" ? d.showBarCloseCountdown : base.display.showBarCloseCountdown,
    };

    const t = (raw.tools ?? {}) as Record<string, unknown>;
    const tools: ChartToolSettings = {
        color:
            typeof t.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(t.color)
                ? t.color
                : base.tools.color,
        lineWidth: isFiniteNumber(t.lineWidth)
            ? Math.min(4, Math.max(1, Math.round(t.lineWidth)))
            : base.tools.lineWidth,
        fontSize: isFiniteNumber(t.fontSize)
            ? Math.min(18, Math.max(8, Math.round(t.fontSize)))
            : base.tools.fontSize,
        lineStyle:
            t.lineStyle === "solid" || t.lineStyle === "dashed" || t.lineStyle === "dotted"
                ? t.lineStyle
                : base.tools.lineStyle,
        fiboLevels: Array.isArray(t.fiboLevels) && t.fiboLevels.length >= 2
            ? t.fiboLevels.filter(isFiniteNumber).slice(0, 12)
            : base.tools.fiboLevels,
        candleWidth: isFiniteNumber(t.candleWidth)
            ? Math.min(10, Math.max(0, Math.round(t.candleWidth)))
            : base.tools.candleWidth,
    };

    // Preset wins for colors unless the stored copy carries custom colors.
    const colors = raw.colors ? mergeColors(base.colors, raw.colors) : base.colors;

    return { preset, colors, display, tools };
}

export function loadChartSettings(): ChartSettings {
    if (typeof window === "undefined") return defaultChartSettings();
    try {
        const raw = window.localStorage.getItem(CHART_SETTINGS_STORAGE_KEY);
        if (!raw) return defaultChartSettings();
        return mergeChartSettings(JSON.parse(raw));
    } catch {
        return defaultChartSettings();
    }
}

export function saveChartSettings(settings: ChartSettings): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(CHART_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // private mode / quota — preferences simply do not persist
    }
}

/** Parse the Fibonacci "values" input ("0, 0.236, 0.5, 1"). null → invalid. */
export function parseFiboLevels(raw: string): number[] | null {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const nums: number[] = [];
    for (const p of parts) {
        const n = Number(p);
        if (!Number.isFinite(n)) return null;
        nums.push(n);
    }
    return nums.slice(0, 12);
}

// ── trade views rendered on the chart ──────────────────────────────────────

export interface ChartPositionView {
    ticket: string;
    symbol: string;
    side: "BUY" | "SELL";
    volume: number;
    entry: number;
    /** Broker current price when known (real-time mark). */
    current?: number;
    sl?: number | null;
    tp?: number | null;
    /** Real broker P/L in account currency when known. */
    profit?: number;
    openedAt?: number;
}

export type ChartPendingOrderType = "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP";

export interface ChartPendingOrderView {
    ticket: string;
    symbol: string;
    type: ChartPendingOrderType;
    volume: number;
    price: number;
    sl?: number | null;
    tp?: number | null;
    status?: string;
}

/** One historical execution placed on the chart (entry or exit). */
export interface ChartTradeFill {
    id: string;
    /** Symbol the fill belongs to — the chart only draws the active one. */
    symbol?: string;
    /** Market time in ms. */
    time: number;
    price: number;
    side: "buy" | "sell" | "unknown";
    kind: "entry" | "exit" | "partial";
    volume?: number;
    /** Real P/L when the execution reports one. */
    profit?: number | null;
    /** Label shown next to the marker (defaults from action/volume). */
    label?: string;
}

/** Normalise a pending-order action/type string into the chart's union. */
export function normalisePendingOrderType(type: string): ChartPendingOrderType | null {
    const t = String(type ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    return t === "BUY_LIMIT" || t === "SELL_LIMIT" || t === "BUY_STOP" || t === "SELL_STOP"
        ? t
        : null;
}

/**
 * Partial-close lot math for "close 25% of this trade" style controls.
 *
 * Rounds DOWN to the broker lot step (default 0.01) so the requested
 * percentage is never oversold, with two edge cases:
 *   • slice below the minimum lot on a multi-lot position → close the
 *     smallest valid slice (nearest achievable amount);
 *   • remainder would be a dust lot → close the position in full.
 */
export function partialCloseVolume(
    volume: number,
    percent: number,
    step = 0.01
): { mode: "full" | "partial"; volume: number } {
    const v = Number(volume);
    const p = Number(percent);
    // The lot step is instrument-specific; a 0.001-step crypto pair must not be
    // clamped at 0.01 or the slice stops being tradable (and on a 0.003 lot it
    // would collapse to a full close).
    const lotStep = Number.isFinite(step) && step > 0 ? step : 0.01;
    if (!Number.isFinite(v) || v <= 0) return { mode: "full", volume: 0 };
    if (!Number.isFinite(p) || p >= 100) return { mode: "full", volume: v };
    if (p <= 0) return { mode: "partial", volume: 0 };

    // Snap to the instrument's grid without floating-point drift.
    const precision = Math.max(0, Math.min(8, Math.ceil(-Math.log10(lotStep))));
    const factor = 10 ** precision;
    const round = (value: number) => Math.round(value * factor) / factor;
    const closeLots = Math.floor((v * p) / 100 / lotStep) * lotStep;
    const rounded = round(closeLots);

    if (rounded < lotStep) {
        // Requested slice is under one lot step.
        if (round(v) <= lotStep) return { mode: "full", volume: v };
        return { mode: "partial", volume: lotStep };
    }

    // Compare the RAW remainder against one lot step. Rounding it first makes
    // a 0.005 dust remainder round *up* to exactly 0.01 and slip past the
    // check, stranding an untradeable sliver on the book (0.025 @ 90% → close
    // 0.02 and leave 0.005). Closing the position in full is the honest result.
    const remainingRaw = v - rounded;
    if (remainingRaw < lotStep) return { mode: "full", volume: v };
    return { mode: "partial", volume: rounded };
}

/**
 * Map one execution-log entry (MT5 gateway actions: BUY / SELL / CLOSE /
 * PARTIAL_CLOSE / …) onto a chart fill marker. Only real recorded fields are
 * used; side stays "unknown" when the log does not carry one (a close never
 * records which direction it flattened). Non-fill actions (CANCEL/MODIFY)
 * return null — they never render as trade history.
 */
export function tradeFillFromExecution(input: {
    id: string;
    action: string;
    executedAt: number;
    price: number;
    symbol?: string;
    volume?: number;
    profit?: number | null;
    label?: string;
}): ChartTradeFill | null {
    const action = String(input.action ?? "").trim().toUpperCase();
    if (!action) return null;
    if (action.includes("CANCEL") || action.includes("MODIFY")) return null;
    if (!Number.isFinite(input.price) || input.price <= 0) return null;
    if (!Number.isFinite(input.executedAt) || input.executedAt <= 0) return null;

    const isPartial = action.includes("PARTIAL");
    const isClose = action.includes("CLOSE");
    const side: ChartTradeFill["side"] = action.includes("BUY")
        ? "buy"
        : action.includes("SELL")
            ? "sell"
            : "unknown";
    const kind: ChartTradeFill["kind"] = isPartial
        ? "partial"
        : isClose
            ? "exit"
            : "entry";

    const volume = isFiniteNumber(input.volume) && input.volume > 0 ? input.volume : undefined;
    const label =
        input.label ??
        (kind === "entry"
            ? `${side === "unknown" ? action : side.toUpperCase()} ${volume ?? ""}`.trim()
            : kind === "partial"
                ? `PARTIAL ${volume ?? ""}`.trim()
                : `CLOSE ${volume ?? ""}`.trim());

    return {
        id: input.id,
        symbol: input.symbol,
        time: input.executedAt,
        price: input.price,
        side: kind === "entry" ? side : "unknown",
        kind,
        volume,
        profit: isFiniteNumber(input.profit ?? null) ? (input.profit as number) : null,
        label,
    };
}
