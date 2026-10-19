/**
 * Engine-backed condition nodes for the Bot Studio visual builder.
 *
 * Every entry maps to a StrategyRule shape that `evaluateRule()`
 * (lib/strategy-engine/decisions.ts) evaluates against the candle features
 * from lib/strategy-lab/features.ts. Nothing here may reference a feature the
 * engine does not compute. Adding a node = adding one entry below.
 */

import type { StrategyRule, RuleGroup, RuleOperator } from "@/lib/strategy-lab/types";
import type { Timeframe } from "@/lib/market-data/types";

export type EngineNodeCategory =
    | "Trend"
    | "Indicators"
    | "Market structure"
    | "Liquidity & FVG"
    | "Smart money"
    | "Sessions"
    | "Price action & momentum"
    | "Volatility";

export interface EngineNodeDef {
    /** Node kind stored in the graph. Prefixed `engine_` so the compiler routes it here. */
    kind: `engine_${string}`;
    category: EngineNodeCategory;
    label: string;
    description: string;
    group: RuleGroup;
    operator: RuleOperator;
    editableOperator?: boolean;
    value: StrategyRule["value"];
    indicator?: StrategyRule["indicator"];
    negate?: boolean;
}

const ENGINE_NODE_DEFS: EngineNodeDef[] = [
    // ── Trend ──────────────────────────────────────────────────────────────
    { kind: "engine_trend_bullish", category: "Trend", label: "Trend is bullish", description: "Candle trend label is bullish.", group: "trend", operator: "eq", value: "bullish" },
    { kind: "engine_trend_bearish", category: "Trend", label: "Trend is bearish", description: "Candle trend label is bearish.", group: "trend", operator: "eq", value: "bearish" },
    { kind: "engine_trend_neutral", category: "Trend", label: "Trend is neutral (range)", description: "Candle trend label is neutral.", group: "trend", operator: "eq", value: "neutral" },

    // ── Indicators ─────────────────────────────────────────────────────────
    { kind: "engine_rsi_gt_70", category: "Indicators", label: "RSI(14) > 70", description: "RSI above 70 (overbought).", group: "indicator", operator: "gt", value: 70, indicator: "rsi" },
    { kind: "engine_rsi_gt_60", category: "Indicators", label: "RSI(14) > 60", description: "RSI above 60.", group: "indicator", operator: "gt", value: 60, indicator: "rsi" },
    { kind: "engine_rsi_gt_50", category: "Indicators", label: "RSI(14) > 50", description: "RSI above 50 (bullish momentum).", group: "indicator", operator: "gt", value: 50, indicator: "rsi" },
    { kind: "engine_rsi_lt_50", category: "Indicators", label: "RSI(14) < 50", description: "RSI below 50 (bearish momentum).", group: "indicator", operator: "lt", value: 50, indicator: "rsi" },
    { kind: "engine_rsi_lt_40", category: "Indicators", label: "RSI(14) < 40", description: "RSI below 40.", group: "indicator", operator: "lt", value: 40, indicator: "rsi" },
    { kind: "engine_rsi_lt_30", category: "Indicators", label: "RSI(14) < 30", description: "RSI below 30 (oversold).", group: "indicator", operator: "lt", value: 30, indicator: "rsi" },
    { kind: "engine_ema20_above_ema50", category: "Indicators", label: "EMA20 above EMA50", description: "Fast EMA above slow EMA.", group: "indicator", operator: "eq", value: "ema20_above_ema50", indicator: "ema_cross" },
    { kind: "engine_ema20_below_ema50", category: "Indicators", label: "EMA20 below EMA50", description: "Fast EMA below slow EMA.", group: "indicator", operator: "eq", value: "ema20_below_ema50", indicator: "ema_cross" },
    { kind: "engine_close_above_ema20", category: "Indicators", label: "Close above EMA20", description: "Last close above EMA20.", group: "indicator", operator: "eq", value: "above", indicator: "close_vs_ema20" },
    { kind: "engine_close_below_ema20", category: "Indicators", label: "Close below EMA20", description: "Last close below EMA20.", group: "indicator", operator: "eq", value: "below", indicator: "close_vs_ema20" },

    // ── Market structure ───────────────────────────────────────────────────
    { kind: "engine_choch_bullish", category: "Market structure", label: "CHoCH bullish", description: "Bullish change of character.", group: "structure", operator: "eq", value: "choch_bullish" },
    { kind: "engine_choch_bearish", category: "Market structure", label: "CHoCH bearish", description: "Bearish change of character.", group: "structure", operator: "eq", value: "choch_bearish" },
    { kind: "engine_bos_bullish", category: "Market structure", label: "BOS bullish", description: "Bullish break of structure.", group: "structure", operator: "eq", value: "bos_bullish" },
    { kind: "engine_bos_bearish", category: "Market structure", label: "BOS bearish", description: "Bearish break of structure.", group: "structure", operator: "eq", value: "bos_bearish" },
    { kind: "engine_higher_high", category: "Market structure", label: "Higher high (HH)", description: "Swing produced a higher high.", group: "structure", operator: "eq", value: "hh" },
    { kind: "engine_higher_low", category: "Market structure", label: "Higher low (HL)", description: "Swing produced a higher low.", group: "structure", operator: "eq", value: "hl" },
    { kind: "engine_lower_high", category: "Market structure", label: "Lower high (LH)", description: "Swing produced a lower high.", group: "structure", operator: "eq", value: "lh" },
    { kind: "engine_lower_low", category: "Market structure", label: "Lower low (LL)", description: "Swing produced a lower low.", group: "structure", operator: "eq", value: "ll" },

    // ── Structure breaks, liquidity & imbalances ──────────────────────────
    { kind: "engine_bos_close_above_swing", category: "Market structure", label: "Close breaks swing high", description: "Current candle closes above a previously confirmed swing high (3 bars left/right).", group: "structure", operator: "eq", value: "bos_break_up" },
    { kind: "engine_bos_close_below_swing", category: "Market structure", label: "Close breaks swing low", description: "Current candle closes below a previously confirmed swing low (3 bars left/right).", group: "structure", operator: "eq", value: "bos_break_down" },
    { kind: "engine_choch_close_bullish", category: "Market structure", label: "CHoCH close bullish", description: "Close breaks a confirmed swing high after the latest confirmed structure break was bearish.", group: "structure", operator: "eq", value: "choch_up" },
    { kind: "engine_choch_close_bearish", category: "Market structure", label: "CHoCH close bearish", description: "Close breaks a confirmed swing low after the latest confirmed structure break was bullish.", group: "structure", operator: "eq", value: "choch_down" },
    { kind: "engine_sweep_buy_side", category: "Liquidity & FVG", label: "Buy-side liquidity sweep", description: "Last liquidity sweep took buy-side liquidity.", group: "liquidity", operator: "eq", value: "buy_side" },
    { kind: "engine_sweep_sell_side", category: "Liquidity & FVG", label: "Sell-side liquidity sweep", description: "Last liquidity sweep took sell-side liquidity.", group: "liquidity", operator: "eq", value: "sell_side" },
    { kind: "engine_fvg_bullish", category: "Liquidity & FVG", label: "Bullish FVG", description: "Most recent fair value gap is bullish.", group: "fvg", operator: "eq", value: "bullish" },
    { kind: "engine_fvg_bearish", category: "Liquidity & FVG", label: "Bearish FVG", description: "Most recent three-candle fair value gap is bearish.", group: "fvg", operator: "eq", value: "bearish" },
    { kind: "engine_fvg_retest_bullish", category: "Liquidity & FVG", label: "Bullish FVG retest", description: "Price returns to overlap the most recent unfilled bullish three-candle FVG after formation.", group: "fvg", operator: "eq", value: "bullish_retest" },
    { kind: "engine_fvg_retest_bearish", category: "Liquidity & FVG", label: "Bearish FVG retest", description: "Price returns to overlap the most recent unfilled bearish three-candle FVG after formation.", group: "fvg", operator: "eq", value: "bearish_retest" },
    { kind: "engine_order_block_bullish", category: "Liquidity & FVG", label: "Bullish order block", description: "Last bearish candle within three bars before a bullish displacement (body ≥ 1 ATR and ≥70% of range).", group: "order_block", operator: "eq", value: "bullish" },
    { kind: "engine_order_block_bearish", category: "Liquidity & FVG", label: "Bearish order block", description: "Last bullish candle within three bars before a bearish displacement (body ≥ 1 ATR and ≥70% of range).", group: "order_block", operator: "eq", value: "bearish" },
    { kind: "engine_order_block_retest_bullish", category: "Liquidity & FVG", label: "Bullish order block retest", description: "Price overlaps the latest bullish block after formation; the block is invalidated if a candle closes below its low.", group: "order_block", operator: "eq", value: "bullish_retest" },
    { kind: "engine_order_block_retest_bearish", category: "Liquidity & FVG", label: "Bearish order block retest", description: "Price overlaps the latest bearish block after formation; the block is invalidated if a candle closes above its high.", group: "order_block", operator: "eq", value: "bearish_retest" },
    { kind: "engine_sweep_high20", category: "Liquidity & FVG", label: "Sweep above 20-bar high", description: "Current high trades above the previous 20-bar high then closes back below it.", group: "liquidity", operator: "eq", value: "buy_side_sweep_20" },
    { kind: "engine_sweep_low20", category: "Liquidity & FVG", label: "Sweep below 20-bar low", description: "Current low trades below the previous 20-bar low then closes back above it.", group: "liquidity", operator: "eq", value: "sell_side_sweep_20" },
    { kind: "engine_premium_20", category: "Smart money", label: "Premium of 20-bar range", description: "Close is in the upper half of the previous 20 completed candles' range.", group: "indicator", operator: "gte", value: 50, indicator: "premium_discount_20", editableOperator: true },
    { kind: "engine_discount_20", category: "Smart money", label: "Discount of 20-bar range", description: "Close is in the lower half of the previous 20 completed candles' range.", group: "indicator", operator: "lt", value: 50, indicator: "premium_discount_20", editableOperator: true },
    { kind: "engine_displacement_bullish", category: "Smart money", label: "Bullish displacement candle", description: "Bull candle body >= 1 ATR and >=70% of its range.", group: "indicator", operator: "gt", value: 0.5, indicator: "bullish_displacement_14", editableOperator: false },
    { kind: "engine_displacement_bearish", category: "Smart money", label: "Bearish displacement candle", description: "Bear candle body >= 1 ATR and >=70% of its range.", group: "indicator", operator: "gt", value: 0.5, indicator: "bearish_displacement_14", editableOperator: false },

    // ── Sessions ───────────────────────────────────────────────────────────
    { kind: "engine_session_asian", category: "Sessions", label: "Asian session", description: "Candle closes in the Asian session.", group: "session", operator: "eq", value: "asian" },
    { kind: "engine_session_london", category: "Sessions", label: "London session", description: "Candle closes in the London session.", group: "session", operator: "eq", value: "london" },
    { kind: "engine_session_new_york", category: "Sessions", label: "New York session", description: "Candle closes in the New York session.", group: "session", operator: "eq", value: "new_york" },
    { kind: "engine_session_overlap", category: "Sessions", label: "London/NY overlap", description: "Candle closes in the London/New York overlap.", group: "session", operator: "eq", value: "overlap" },

    // ── Price action & momentum ────────────────────────────────────────────
    { kind: "engine_breakout_high", category: "Price action & momentum", label: "Breakout above high", description: "Price breaks the recent high.", group: "price_action", operator: "eq", value: "breakout_high" },
    { kind: "engine_breakout_low", category: "Price action & momentum", label: "Breakout below low", description: "Price breaks the recent low.", group: "price_action", operator: "eq", value: "breakout_low" },
    { kind: "engine_momentum_positive", category: "Price action & momentum", label: "Momentum positive", description: "Momentum percentage above zero.", group: "confirmation", operator: "eq", value: "momentum_positive" },
    { kind: "engine_momentum_negative", category: "Price action & momentum", label: "Momentum negative", description: "Momentum percentage below zero.", group: "confirmation", operator: "eq", value: "momentum_negative" },
    { kind: "engine_close_above_ema_confirm", category: "Price action & momentum", label: "Close at/above EMA20", description: "Close is at or above EMA20.", group: "confirmation", operator: "eq", value: "close_above_ema" },
    { kind: "engine_close_below_ema_confirm", category: "Price action & momentum", label: "Close at/below EMA20", description: "Close is at or below EMA20.", group: "confirmation", operator: "eq", value: "close_below_ema" },

    // ── Volatility ─────────────────────────────────────────────────────────
    { kind: "engine_volatility_low", category: "Volatility", label: "Volatility low", description: "ATR volatility state is low.", group: "volatility", operator: "eq", value: "low" },
    { kind: "engine_volatility_normal", category: "Volatility", label: "Volatility normal", description: "ATR volatility state is normal.", group: "volatility", operator: "eq", value: "normal" },
    { kind: "engine_volatility_high", category: "Volatility", label: "Volatility high", description: "ATR volatility state is high.", group: "volatility", operator: "eq", value: "high" },
    { kind: "engine_volatility_extreme", category: "Volatility", label: "Volatility extreme", description: "ATR volatility state is extreme.", group: "volatility", operator: "eq", value: "extreme" },
];

export const ENGINE_NODE_CATALOG: readonly EngineNodeDef[] = ENGINE_NODE_DEFS;

export type EngineNodeKind = (typeof ENGINE_NODE_DEFS)[number]["kind"];

const BY_KIND = new Map<string, EngineNodeDef>(ENGINE_NODE_DEFS.map((d) => [d.kind, d]));

export function findEngineNode(kind: string): EngineNodeDef | undefined {
    return BY_KIND.get(kind);
}

/** Build the StrategyRule the engine evaluates for a catalog node. */
export function engineNodeToRule(
    id: string,
    kind: string,
    timeframe: Timeframe,
    overrides: Partial<Pick<StrategyRule, "label" | "operator" | "value" | "negate" | "groupLogic">> = {},
): StrategyRule | null {
    const def = BY_KIND.get(kind);
    if (!def) return null;
    return {
        id: `${def.kind}_${id}`,
        enabled: true,
        group: def.group,
        label: overrides.label ?? def.label,
        operator: def.editableOperator ? overrides.operator ?? def.operator : def.operator,
        timeframe,
        value: overrides.value ?? def.value,
        negate: overrides.negate ?? def.negate ?? false,
        groupLogic: overrides.groupLogic ?? "AND",
        ...(def.indicator ? { indicator: def.indicator } : {}),
    };
}
