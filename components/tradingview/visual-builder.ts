/**
 * Visual strategy builder — leaf module with the node grammar and the
 * visual-graph → Pine generator.
 *
 * Everything a library node emits is real, runtime-executable Pine: every
 * `ta.*` call it generates exists in the Pine runtime (lib/pine-runtime), so
 * "Apply to Chart" always runs the actual user composition over the chart's
 * real candles. Pine v6 comment syntax (`//`) is used for hints so the
 * preview shows exactly what will execute.
 */

import type { PineExecutionResult } from "@/lib/pine-runtime";

export type VisualNodeKind =
    // ── Market data ──
    | "price"
    | "volume"
    // ── Studies ──
    | "moving_average"
    | "hma"
    | "rsi"
    | "macd"
    | "bollinger"
    | "keltner"
    | "donchian"
    | "supertrend"
    | "stochastic"
    | "adx"
    | "atr"
    | "cci"
    | "psar"
    | "vwap"
    | "ichimoku"
    | "mfi"
    | "williams_r"
    | "roc"
    | "ao"
    | "stddev"
    | "pivots"
    | "fisher"
    | "heikinashi"
    | "obv"
    | "cmf"
    // ── Conditions / signals ──
    | "crossover"
    | "rsi_oversold"
    | "rsi_overbought"
    | "macd_bullish"
    | "macd_bearish"
    | "stoch_oversold"
    | "stoch_overbought"
    | "stoch_cross"
    | "adx_strong"
    | "cci_oversold"
    | "cci_overbought"
    | "psar_bull"
    | "vwap_bull"
    | "ichimoku_bull"
    | "volume_surge"
    | "st_bull"
    | "kc_squeeze"
    | "dc_breakout"
    | "ha_bull"
    | "cmf_positive"
    | "willr_oversold"
    | "willr_overbought"
    | "mfi_oversold"
    | "mfi_overbought"
    | "atr_filter"
    // ── Logic / execution / output ──
    | "and"
    | "long_entry"
    | "short_entry"
    | "close_long"
    | "close_short"
    | "risk_manager"
    | "plot";

export type VisualNode = {
    id: string;
    kind: VisualNodeKind;
    x: number;
    y: number;
    label?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
};

export type VisualEdge = { from: string; to: string };

const num = (config: Record<string, unknown> | undefined, key: string, fallback: number): number => {
    const v = config?.[key];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Study declarations for the node kinds that introduce an indicator series.
 * Returns Pine lines and a map from kind → primary series variable, plus the
 * secondary series (e.g. signal line) where a study has one.
 */
export function visualStudyLines(nodes: VisualNode[]): {
    lines: string[];
    primary: Map<string, string>;
    secondary: Map<string, string>;
    isStrategy: boolean;
} {
    const kinds = new Set(nodes.map((n) => n.kind));
    const enabled = (kind: VisualNodeKind) => {
        if (!kinds.has(kind)) return false;
        return nodes.some((n) => n.kind === kind && n.enabled !== false);
    };
    const cfg = (kind: VisualNodeKind): Record<string, unknown> | undefined =>
        nodes.find((n) => n.kind === kind)?.config;

    const lines: string[] = [];
    const primary = new Map<string, string>();
    const secondary = new Map<string, string>();
    const isStrategy = ["long_entry", "short_entry", "close_long", "close_short", "risk_manager"].some((k) =>
        kinds.has(k as VisualNodeKind)
    );

    const def = (kind: VisualNodeKind, varName: string, expr: string) => {
        if (enabled(kind)) {
            lines.push(`${varName} = ${expr}`);
            primary.set(kind, varName);
        }
    };

    def("moving_average", "fastMa", "ta.ema(close, 20)");
    if (enabled("moving_average")) lines.push("slowMa = ta.ema(close, 50)");
    if (enabled("moving_average")) secondary.set("moving_average", "slowMa");
    def("hma", "hmaValue", `ta.hma(close, ${num(cfg("hma"), "length", 9)})`);
    def("rsi", "rsiValue", `ta.rsi(close, ${num(cfg("rsi"), "length", 14)})`);
    if (enabled("macd")) lines.push("[macdLine, macdSignal, macdHist] = ta.macd(close, 12, 26, 9)");
    if (enabled("macd")) {
        primary.set("macd", "macdLine");
        secondary.set("macd", "macdSignal");
    }
    if (enabled("bollinger")) lines.push("[bbBasis, bbUpper, bbLower] = ta.bb(close, 20, 2)");
    if (enabled("bollinger")) {
        primary.set("bollinger", "bbUpper");
        secondary.set("bollinger", "bbLower");
    }
    if (enabled("keltner")) lines.push("[kcMid, kcUpper, kcLower] = ta.keltner(high, low, close, 20, 2)");
    if (enabled("keltner")) {
        primary.set("keltner", "kcUpper");
        secondary.set("keltner", "kcLower");
    }
    if (enabled("donchian")) lines.push("[dcUpper, dcLower, dcMid] = ta.donchian(high, low, 20)");
    if (enabled("donchian")) {
        primary.set("donchian", "dcUpper");
        secondary.set("donchian", "dcLower");
    }
    if (enabled("supertrend")) lines.push("[stLine, stDir] = ta.supertrend(high, low, close, 10, 3)");
    if (enabled("supertrend")) {
        primary.set("supertrend", "stLine");
        secondary.set("supertrend", "stDir");
    }
    if (enabled("stochastic")) lines.push("[stochK, stochD] = ta.stoch(close, high, low, 14)");
    if (enabled("stochastic")) {
        primary.set("stochastic", "stochK");
        secondary.set("stochastic", "stochD");
    }
    def("adx", "adxValue", "ta.adx(high, low, close, 14)");
    def("atr", "atrValue", "ta.atr(14)");
    def("cci", "cciValue", `ta.cci(high, low, close, ${num(cfg("cci"), "length", 14)})`);
    def("psar", "psarValue", "ta.psar(0.02, 0.2)");
    def("vwap", "vwapValue", "ta.vwap(hlc3)");
    if (enabled("ichimoku"))
        lines.push(
            "ichimokuConv = (ta.highest(high, 9) + ta.lowest(low, 9)) / 2",
            "ichimokuBase = (ta.highest(high, 26) + ta.lowest(low, 26)) / 2",
            "ichimokuSpanA = (ichimokuConv + ichimokuBase) / 2",
            "ichimokuSpanB = (ta.highest(high, 52) + ta.lowest(low, 52)) / 2"
        );
    if (enabled("ichimoku")) {
        primary.set("ichimoku", "ichimokuSpanA");
        secondary.set("ichimoku", "ichimokuSpanB");
    }
    def("mfi", "mfiValue", `ta.mfi(high, low, close, volume, ${num(cfg("mfi"), "length", 14)})`);
    def("williams_r", "willrValue", `ta.willr(high, low, close, ${num(cfg("williams_r"), "length", 14)})`);
    def("roc", "rocValue", `ta.roc(close, ${num(cfg("roc"), "length", 12)})`);
    // Awesome Oscillator: SMA(median price, 5) − SMA(median price, 34) — Bill Williams' market-momentum gauge.
    def("ao", "aoValue", "ta.sma(hl2, 5) - ta.sma(hl2, 34)");
    def("stddev", "stddevValue", `ta.stdev(close, ${num(cfg("stddev"), "length", 20)})`);
    if (enabled("volume")) lines.push("volumeValue = volume");
    def("obv", "obvValue", "ta.obv(close, volume)");
    if (enabled("cmf")) lines.push("cmfValue = ta.cmf(high, low, close, volume, 20)");
    if (enabled("fisher")) lines.push("[fisherValue, fisherTrigger] = ta.fisher(high, low, 9)");
    if (enabled("fisher")) {
        primary.set("fisher", "fisherValue");
        secondary.set("fisher", "fisherTrigger");
    }
    if (enabled("heikinashi")) lines.push("[haOpen, haHigh, haLow, haClose] = ta.heikinashi(open, high, low, close)");
    if (enabled("heikinashi")) {
        primary.set("heikinashi", "haClose");
        secondary.set("heikinashi", "haOpen");
    }
    // pivots node: classic daily pivot levels as a study pane
    if (enabled("pivots")) lines.push("[pivotP, pivotR1, pivotR2, pivotS1, pivotS2] = ta.pivots(high, low, close)");

    return { lines, primary, secondary, isStrategy };
}

/**
 * Boolean condition series emitted per node kind. `direction` selects the
 * bullish/bearish side where a condition has both. Conditions whose study
 * node is absent from the graph are skipped (return null).
 */
export function visualCondition(kind: VisualNodeKind, direction: "long" | "short", studies: ReturnType<typeof visualStudyLines>): string | null {
    const has = (k: VisualNodeKind) => studies.primary.has(k);
    switch (kind) {
        case "crossover":
            if (!has("moving_average")) return null;
            return direction === "long" ? "ta.crossover(fastMa, slowMa)" : "ta.crossunder(fastMa, slowMa)";
        case "rsi_oversold":
            return has("rsi") && direction === "long" ? "rsiValue < 30" : null;
        case "rsi_overbought":
            return has("rsi") && direction === "short" ? "rsiValue > 70" : null;
        case "macd_bullish":
            return has("macd") && direction === "long" ? "ta.crossover(macdLine, macdSignal)" : null;
        case "macd_bearish":
            return has("macd") && direction === "short" ? "ta.crossunder(macdLine, macdSignal)" : null;
        case "stoch_oversold":
            return has("stochastic") && direction === "long" ? "stochK < 20" : null;
        case "stoch_overbought":
            return has("stochastic") && direction === "short" ? "stochK > 80" : null;
        case "stoch_cross":
            return has("stochastic") ? (direction === "long" ? "ta.crossover(stochK, stochD)" : "ta.crossunder(stochK, stochD)") : null;
        case "adx_strong":
            return has("adx") ? "adxValue > 25" : null;
        case "cci_oversold":
            return has("cci") && direction === "long" ? "cciValue < -100" : null;
        case "cci_overbought":
            return has("cci") && direction === "short" ? "cciValue > 100" : null;
        case "psar_bull":
            return has("psar") ? (direction === "long" ? "close > psarValue" : "close < psarValue") : null;
        case "vwap_bull":
            return has("vwap") ? (direction === "long" ? "close > vwapValue" : "close < vwapValue") : null;
        case "ichimoku_bull":
            return has("ichimoku")
                ? direction === "long"
                    ? "close > ichimokuSpanA and close > ichimokuSpanB"
                    : "close < ichimokuSpanA and close < ichimokuSpanB"
                : null;
        case "volume_surge":
            return has("volume") ? "volume > ta.sma(volume, 20) * 1.5" : null;
        case "st_bull":
            return has("supertrend") ? (direction === "long" ? "stDir == 1" : "stDir == -1") : null;
        case "kc_squeeze":
            return has("keltner") && has("bollinger") ? "bbUpper < kcUpper and bbLower > kcLower" : null;
        case "dc_breakout":
            if (!has("donchian")) return null;
            return direction === "long" ? "close > dcUpper[1]" : "close < dcLower[1]";
        case "ha_bull":
            return has("heikinashi") ? "haClose > haOpen" : null;
        case "cmf_positive":
            return has("cmf") ? (direction === "long" ? "cmfValue > 0" : "cmfValue < 0") : null;
        case "willr_oversold":
            return has("williams_r") && direction === "long" ? "willrValue < -80" : null;
        case "willr_overbought":
            return has("williams_r") && direction === "short" ? "willrValue > -20" : null;
        case "mfi_oversold":
            return has("mfi") && direction === "long" ? "mfiValue < 20" : null;
        case "mfi_overbought":
            return has("mfi") && direction === "short" ? "mfiValue > 80" : null;
        case "atr_filter":
            return has("atr") ? "atrValue > ta.sma(atrValue, 14) * 0.8" : null;
        case "moving_average":
            if (!has("moving_average")) return null;
            return direction === "long" ? "fastMa > slowMa" : "fastMa < slowMa";
        case "bollinger":
            if (!has("bollinger")) return null;
            return direction === "long" ? "close < bbLower" : "close > bbUpper";
        case "supertrend":
            return has("supertrend") ? (direction === "long" ? "stDir == 1" : "stDir == -1") : null;
        default:
            return null;
    }
}

/**
 * Generate runtime-executable Pine from the visual graph. Conditions are
 * collected by walking upstream from each entry/output node, and every
 * condition references series that were actually declared — so the output
 * always compiles in the Pine runtime.
 */
export function createPineSource(nodes: VisualNode[], edges: VisualEdge[]): string {
    const studies = visualStudyLines(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const inputsOf = (id: string): VisualNode[] =>
        edges
            .map((e) => (e.to === id ? byId.get(e.from) : undefined))
            .filter((n): n is VisualNode => Boolean(n) && n!.enabled !== false);

    const condition = (node: VisualNode, direction: "long" | "short", visited = new Set<string>()): string | null => {
        if (visited.has(node.id)) return null;
        visited.add(node.id);
        const own = visualCondition(node.kind, direction, studies);
        if (own) return own;
        const childConditions = inputsOf(node.id)
            .map((input) => condition(input, direction, new Set(visited)))
            .filter((v): v is string => Boolean(v));
        if (childConditions.length > 1) return `(${childConditions.join(" and ")})`;
        return childConditions[0] ?? null;
    };

    const lines: string[] = [
        "//@version=6",
        studies.isStrategy ? 'strategy("Visual strategy", overlay=true, pyramiding=0)' : 'indicator("Visual indicator", overlay=true)',
        "",
        ...studies.lines,
    ];

    // Entries and exits.
    const emitEntries = (kind: VisualNodeKind, label: "Long" | "Short", direction: "long" | "short") => {
        for (const node of nodes.filter((n) => n.kind === kind && n.enabled !== false)) {
            const cond = condition(node, direction);
            if (cond) {
                lines.push("", `if ${cond}`, `    strategy.entry("${label}", strategy.${direction})`);
            }
        }
    };
    emitEntries("long_entry", "Long", "long");
    emitEntries("short_entry", "Short", "short");
    for (const node of nodes.filter((n) => n.kind === "close_long" && n.enabled !== false)) {
        const cond = condition(node, "short");
        if (cond) lines.push("", `if ${cond}`, '    strategy.close("Long")');
    }
    for (const node of nodes.filter((n) => n.kind === "close_short" && n.enabled !== false)) {
        const cond = condition(node, "long");
        if (cond) lines.push("", `if ${cond}`, '    strategy.close("Short")');
    }

    const kinds = new Set(nodes.map((n) => n.kind));
    if (studies.isStrategy && kinds.has("risk_manager")) {
        lines.push(
            "",
            "strategy.exit(\"Long risk\", \"Long\", stop=strategy.position_avg_price * (1 - stopPercent / 100), limit=strategy.position_avg_price * (1 + takeProfitPercent / 100))",
            "strategy.exit(\"Short risk\", \"Short\", stop=strategy.position_avg_price * (1 + stopPercent / 100), limit=strategy.position_avg_price * (1 - takeProfitPercent / 100))"
        );
    }

    // Study plots for every enabled study with a draw-able series.
    const plotLines: string[] = [];
    const pushPlot = (variable: string, color: string, title: string) => plotLines.push(`plot(${variable}, color=${color}, title="${title}")`);
    if (kinds.has("plot")) {
        for (const [kind, variable] of studies.primary) {
            if (kind === "moving_average") {
                pushPlot(variable, "color.aqua", "Fast MA");
                const slow = studies.secondary.get("moving_average");
                if (slow) pushPlot(slow, "color.orange", "Slow MA");
            } else if (kind === "macd") {
                pushPlot(variable, "color.aqua", "MACD");
                const sig = studies.secondary.get("macd");
                if (sig) pushPlot(sig, "color.orange", "Signal");
            } else if (kind === "bollinger" || kind === "keltner" || kind === "donchian") {
                pushPlot(variable, "color.blue", "Upper band");
                const lower = studies.secondary.get(kind);
                if (lower) pushPlot(lower, "color.blue", "Lower band");
            } else if (kind === "volume") {
                pushPlot(variable, "color.gray", "Volume");
            } else {
                pushPlot(variable, "color.aqua", kind.replace(/_/g, " "));
            }
        }
    }
    if (plotLines.length === 0 && kinds.has("plot")) {
        plotLines.push('plot(close, color=color.aqua, title="Close")');
    }
    if (plotLines.length > 0) lines.push("", ...plotLines);

    return lines.join("\n");
}

/** ── Library catalogue shared by the workspace palette and the AI builder ── */

export type VisualNodeCategory = "Market Data" | "Technical" | "Volume" | "Condition" | "Signal" | "Logic" | "Execution" | "Risk" | "Output";

export const VISUAL_NODE_LIBRARY: Array<{ kind: VisualNodeKind; label: string; category: VisualNodeCategory; hint: string; color: string }> = [
    { kind: "price", label: "Price Quote", category: "Market Data", hint: "Live market price & OHLCV", color: "border-info/60 bg-info/10" },
    { kind: "volume", label: "Volume Flow", category: "Market Data", hint: "Bar volume flow", color: "border-border/60 bg-muted/10" },
    { kind: "moving_average", label: "EMA Trend", category: "Technical", hint: "20 / 50 EMA trend", color: "border-warning/60 bg-warning/10" },
    { kind: "hma", label: "Hull MA (HMA)", category: "Technical", hint: "9-period Hull moving average", color: "border-warning/60 bg-warning/10" },
    { kind: "rsi", label: "RSI Momentum", category: "Technical", hint: "14-period momentum oscillator", color: "border-warning/60 bg-warning/10" },
    { kind: "macd", label: "MACD Oscillator", category: "Technical", hint: "12 / 26 / 9 MACD oscillator", color: "border-warning/60 bg-warning/10" },
    { kind: "bollinger", label: "Bollinger Bands", category: "Technical", hint: "20-period ±2σ volatility bands", color: "border-warning/60 bg-warning/10" },
    { kind: "keltner", label: "Keltner Channels", category: "Technical", hint: "20-period EMA ± 2·ATR channels", color: "border-warning/60 bg-warning/10" },
    { kind: "donchian", label: "Donchian Channels", category: "Technical", hint: "20-period high/low breakout envelope", color: "border-warning/60 bg-warning/10" },
    { kind: "supertrend", label: "Supertrend", category: "Technical", hint: "10 / 3 ATR trailing trend line", color: "border-warning/60 bg-warning/10" },
    { kind: "stochastic", label: "Stochastic %K/%D", category: "Technical", hint: "14-period %K / %D momentum", color: "border-warning/60 bg-warning/10" },
    { kind: "adx", label: "ADX Trend Strength", category: "Technical", hint: "14-period trend strength", color: "border-warning/60 bg-warning/10" },
    { kind: "atr", label: "ATR Volatility", category: "Technical", hint: "14-period average true range", color: "border-warning/60 bg-warning/10" },
    { kind: "cci", label: "CCI Momentum", category: "Technical", hint: "14-period commodity channel index", color: "border-warning/60 bg-warning/10" },
    { kind: "psar", label: "Parabolic SAR", category: "Technical", hint: "0.02 / 0.2 trailing stop SAR", color: "border-warning/60 bg-warning/10" },
    { kind: "vwap", label: "VWAP Average", category: "Technical", hint: "Volume-weighted average price", color: "border-warning/60 bg-warning/10" },
    { kind: "ichimoku", label: "Ichimoku Cloud", category: "Technical", hint: "9 / 26 / 52 Ichimoku cloud", color: "border-warning/60 bg-warning/10" },
    { kind: "mfi", label: "Money Flow (MFI)", category: "Technical", hint: "14-period volume-weighted RSI", color: "border-warning/60 bg-warning/10" },
    { kind: "williams_r", label: "Williams %R", category: "Technical", hint: "14-period Williams %R", color: "border-warning/60 bg-warning/10" },
    { kind: "roc", label: "Rate of Change", category: "Technical", hint: "12-period rate of change", color: "border-warning/60 bg-warning/10" },
    { kind: "ao", label: "Awesome Oscillator", category: "Technical", hint: "5/34 median-price momentum (Bill Williams)", color: "border-warning/60 bg-warning/10" },
    { kind: "stddev", label: "Standard Deviation", category: "Technical", hint: "20-period standard deviation", color: "border-warning/60 bg-warning/10" },
    { kind: "pivots", label: "Daily Pivots", category: "Technical", hint: "Classic floor-trader pivot levels", color: "border-warning/60 bg-warning/10" },
    { kind: "fisher", label: "Fisher Transform", category: "Technical", hint: "Ehlers Gaussian-normalised turning points", color: "border-warning/60 bg-warning/10" },
    { kind: "heikinashi", label: "Heikin-Ashi", category: "Technical", hint: "Smoothed HA candles for trend clarity", color: "border-warning/60 bg-warning/10" },
    { kind: "obv", label: "On Balance Volume", category: "Volume", hint: "Cumulative signed volume flow", color: "border-border/60 bg-muted/10" },
    { kind: "cmf", label: "Chaikin Money Flow", category: "Volume", hint: "20-period accumulation / distribution", color: "border-border/60 bg-muted/10" },
    { kind: "crossover", label: "Cross Over", category: "Condition", hint: "Fast series crosses slow series", color: "border-warning/60 bg-warning/10" },
    { kind: "rsi_oversold", label: "RSI Oversold", category: "Condition", hint: "RSI below 30", color: "border-warning/60 bg-warning/10" },
    { kind: "rsi_overbought", label: "RSI Overbought", category: "Condition", hint: "RSI above 70", color: "border-warning/60 bg-warning/10" },
    { kind: "macd_bullish", label: "MACD Bullish", category: "Signal", hint: "MACD crosses above signal", color: "border-positive/60 bg-positive/10" },
    { kind: "macd_bearish", label: "MACD Bearish", category: "Signal", hint: "MACD crosses under signal", color: "border-negative/60 bg-negative/10" },
    { kind: "stoch_oversold", label: "Stoch Oversold", category: "Condition", hint: "%K below 20", color: "border-warning/60 bg-warning/10" },
    { kind: "stoch_overbought", label: "Stoch Overbought", category: "Condition", hint: "%K above 80", color: "border-warning/60 bg-warning/10" },
    { kind: "stoch_cross", label: "Stoch Cross", category: "Condition", hint: "%K crosses %D", color: "border-warning/60 bg-warning/10" },
    { kind: "adx_strong", label: "ADX Strong Trend", category: "Condition", hint: "ADX above 25", color: "border-warning/60 bg-warning/10" },
    { kind: "cci_oversold", label: "CCI Oversold", category: "Condition", hint: "CCI below −100", color: "border-warning/60 bg-warning/10" },
    { kind: "cci_overbought", label: "CCI Overbought", category: "Condition", hint: "CCI above +100", color: "border-warning/60 bg-warning/10" },
    { kind: "psar_bull", label: "SAR Uptrend", category: "Signal", hint: "Price above Parabolic SAR", color: "border-positive/60 bg-positive/10" },
    { kind: "vwap_bull", label: "VWAP Side", category: "Signal", hint: "Price above/below VWAP", color: "border-info/60 bg-info/10" },
    { kind: "ichimoku_bull", label: "Ichimoku Breakout", category: "Signal", hint: "Price outside the cloud", color: "border-info/60 bg-info/10" },
    { kind: "volume_surge", label: "Volume Surge", category: "Condition", hint: "Volume 1.5× its 20-bar average", color: "border-positive/60 bg-positive/10" },
    { kind: "st_bull", label: "Supertrend Direction", category: "Signal", hint: "Supertrend flip state", color: "border-positive/60 bg-positive/10" },
    { kind: "kc_squeeze", label: "Bollinger-in-Keltner Squeeze", category: "Condition", hint: "BB inside KC — volatility compression", color: "border-warning/60 bg-warning/10" },
    { kind: "dc_breakout", label: "Donchian Breakout", category: "Condition", hint: "Close breaks the prior channel", color: "border-warning/60 bg-warning/10" },
    { kind: "ha_bull", label: "Heikin-Ashi Bull", category: "Signal", hint: "HA close above HA open", color: "border-positive/60 bg-positive/10" },
    { kind: "cmf_positive", label: "CMF Positive", category: "Signal", hint: "Chaikin money flow above/below zero", color: "border-info/60 bg-info/10" },
    { kind: "willr_oversold", label: "Williams %R Oversold", category: "Condition", hint: "%R below −80", color: "border-warning/60 bg-warning/10" },
    { kind: "willr_overbought", label: "Williams %R Overbought", category: "Condition", hint: "%R above −20", color: "border-warning/60 bg-warning/10" },
    { kind: "mfi_oversold", label: "MFI Oversold", category: "Condition", hint: "MFI below 20", color: "border-warning/60 bg-warning/10" },
    { kind: "mfi_overbought", label: "MFI Overbought", category: "Condition", hint: "MFI above 80", color: "border-warning/60 bg-warning/10" },
    { kind: "atr_filter", label: "ATR Volatility Filter", category: "Condition", hint: "ATR above 0.8× its average", color: "border-warning/60 bg-warning/10" },
    { kind: "and", label: "Logical AND", category: "Logic", hint: "All input conditions agree", color: "border-primary/60 bg-primary/10" },
    { kind: "long_entry", label: "Enter Long", category: "Execution", hint: "Open a long position", color: "border-info/60 bg-info/10" },
    { kind: "short_entry", label: "Enter Short", category: "Execution", hint: "Open a short position", color: "border-negative/60 bg-negative/10" },
    { kind: "close_long", label: "Close Long", category: "Execution", hint: "Close an active long", color: "border-warning/60 bg-warning/10" },
    { kind: "close_short", label: "Close Short", category: "Execution", hint: "Close an active short", color: "border-warning/60 bg-warning/10" },
    { kind: "risk_manager", label: "Stop Loss & Take Profit", category: "Risk", hint: "Configurable stop loss & take profit", color: "border-negative/60 bg-negative/10" },
    { kind: "plot", label: "Draw Study Line", category: "Output", hint: "Plot every enabled study", color: "border-info/60 bg-info/10" },
];

export type VisualNodeInfo = { label: string; category: VisualNodeCategory; hint: string; color: string };

export const VISUAL_NODE_MAP: Record<VisualNodeKind, VisualNodeInfo> =
    Object.fromEntries(VISUAL_NODE_LIBRARY.map((n) => [n.kind, n])) as unknown as Record<VisualNodeKind, VisualNodeInfo>;

/**
 * Default visual graph — a deterministic EMA-crossover long strategy with a
 * risk manager and study plots, executed as-is by "Apply to Chart".
 */
export const DEFAULT_VISUAL_NODES: VisualNode[] = [
    { id: "price", kind: "price", x: 300, y: 35 },
    { id: "average", kind: "moving_average", x: 300, y: 155 },
    { id: "cross", kind: "crossover", x: 300, y: 275 },
    { id: "entry", kind: "long_entry", x: 160, y: 395 },
    { id: "risk", kind: "risk_manager", x: 160, y: 515 },
    { id: "plot", kind: "plot", x: 440, y: 395 },
];

export const DEFAULT_VISUAL_EDGES: VisualEdge[] = [
    { from: "price", to: "average" },
    { from: "average", to: "cross" },
    { from: "cross", to: "entry" },
    { from: "entry", to: "risk" },
    { from: "average", to: "plot" },
];

/**
 * Studies each condition kind requires in the graph before its condition is
 * meaningful. A condition whose prerequisites are absent is honestly omitted
 * from the generated Pine instead of referencing an undeclared series.
 * (Mirrored by the `has(...)` guards in visualCondition.)
 */
export const CONDITION_PREREQUISITES: Partial<Record<VisualNodeKind, VisualNodeKind[]>> = {
    crossover: ["moving_average"],
    rsi_oversold: ["rsi"],
    rsi_overbought: ["rsi"],
    macd_bullish: ["macd"],
    macd_bearish: ["macd"],
    stoch_oversold: ["stochastic"],
    stoch_overbought: ["stochastic"],
    stoch_cross: ["stochastic"],
    adx_strong: ["adx"],
    cci_oversold: ["cci"],
    cci_overbought: ["cci"],
    psar_bull: ["psar"],
    vwap_bull: ["vwap"],
    ichimoku_bull: ["ichimoku"],
    volume_surge: ["volume"],
    st_bull: ["supertrend"],
    kc_squeeze: ["keltner", "bollinger"],
    dc_breakout: ["donchian"],
    ha_bull: ["heikinashi"],
    cmf_positive: ["cmf"],
    willr_oversold: ["williams_r"],
    willr_overbought: ["williams_r"],
    mfi_oversold: ["mfi"],
    mfi_overbought: ["mfi"],
    atr_filter: ["atr"],
};

/**
 * Extract study metadata (plot titles + drawn value samples) from a runtime
 * result — used for the applied-study readout and AI builder summaries.
 */
export function summarizeStudyResult(result: PineExecutionResult): { titles: string[]; drawable: number } {
    const titles = result.plots.map((p) => p.title).filter(Boolean);
    const drawable =
        result.plots.filter((p) => p.values.some((v) => v !== null && Number.isFinite(v))).length +
        result.hlines.length +
        result.plotshapes.reduce((acc, s) => acc + s.values.filter(Boolean).length, 0);
    return { titles, drawable };
}
