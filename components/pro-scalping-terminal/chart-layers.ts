/**
 * Pro Scalping Terminal — chart layer vocabulary (leaf module).
 *
 * The layers are IDs, not arbitrary labels: the chart maps each id onto an
 * overlay it can actually draw from candle data. A layer the chart engine
 * cannot render is declared `available: false` so the UI marks it as such
 * instead of letting a toggle do nothing silently.
 *
 * Leaf module on purpose: the terminal imports this constant list, and the
 * only import is a market-data type, so nothing heavy joins the bundle.
 */

import type { Timeframe } from "@/lib/market-data/types";

export type ChartLayerId =
    | "volume"
    | "vwap"
    | "sessionLevels"
    | "prevDayHighLow"
    | "supportResistance"
    | "fvg"
    | "orderBlocks"
    | "bosChoch"
    | "liquidityLevels"
    | "equalHighsLows"
    // Math-grounded indicator overlays — each has a deterministic renderer in
    // ProTerminalChart that derives it from the displayed candles.
    | "bollingerBands"
    | "keltnerChannels"
    | "donchianChannels"
    | "supertrend"
    | "heikinAshi"
    | "dailyPivots"
    | "rsiPane"
    | "macdPane";

export type ChartLayerDef = {
    id: ChartLayerId;
    label: string;
    defaultOn: boolean;
    /** False when the chart engine has no renderer for this layer yet. */
    available: boolean;
};

export const CHART_LAYERS: ChartLayerDef[] = [
    { id: "volume", label: "Volume", defaultOn: true, available: true },
    { id: "vwap", label: "VWAP", defaultOn: true, available: true },
    { id: "sessionLevels", label: "Session H/L", defaultOn: true, available: true },
    { id: "prevDayHighLow", label: "Prev day H/L", defaultOn: true, available: true },
    { id: "supportResistance", label: "S/R", defaultOn: false, available: true },
    { id: "fvg", label: "FVG", defaultOn: true, available: true },
    { id: "orderBlocks", label: "Order blocks", defaultOn: false, available: true },
    { id: "bosChoch", label: "BOS / CHoCH", defaultOn: true, available: true },
    { id: "liquidityLevels", label: "Liquidity", defaultOn: false, available: true },
    { id: "equalHighsLows", label: "Equal H/L", defaultOn: false, available: true },
    // Indicator overlays (off by default so default charts stay uncluttered).
    { id: "bollingerBands", label: "Bollinger", defaultOn: false, available: true },
    { id: "keltnerChannels", label: "Keltner", defaultOn: false, available: true },
    { id: "donchianChannels", label: "Donchian", defaultOn: false, available: true },
    { id: "supertrend", label: "Supertrend", defaultOn: false, available: true },
    { id: "heikinAshi", label: "Heikin-Ashi", defaultOn: false, available: true },
    { id: "dailyPivots", label: "Pivots", defaultOn: false, available: true },
    { id: "rsiPane", label: "RSI pane", defaultOn: false, available: true },
    { id: "macdPane", label: "MACD pane", defaultOn: false, available: true },
];

export const CHART_LAYER_IDS = CHART_LAYERS.map((l) => l.id);

export function defaultLayerState(): Record<ChartLayerId, boolean> {
    return Object.fromEntries(CHART_LAYERS.map((l) => [l.id, l.defaultOn])) as Record<ChartLayerId, boolean>;
}

/** Execution timeframes offered in the terminal toolbar. */
export const TERMINAL_TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1"];

/** Timeframe → lightweight-charts interval used by the chart fetcher. */
export const TIMEFRAME_TO_INTERVAL: Record<Timeframe, string> = {
    M1: "1m",
    M3: "3m",
    M5: "5m",
    M15: "15m",
    M30: "30m",
    H1: "1h",
    H4: "4h",
    D1: "1D",
};
