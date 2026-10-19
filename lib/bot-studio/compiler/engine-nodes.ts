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
    value: StrategyRule["value"];
    indicator?: StrategyRule["indicator"];
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

    // ── Liquidity & FVG & order blocks ─────────────────────────────────────
    { kind: "engine_sweep_buy_side", category: "Liquidity & FVG", label: "Buy-side liquidity sweep", description: "Last liquidity sweep took buy-side liquidity.", group: "liquidity", operator: "eq", value: "buy_side" },
    { kind: "engine_sweep_sell_side", category: "Liquidity & FVG", label: "Sell-side liquidity sweep", description: "Last liquidity sweep took sell-side liquidity.", group: "liquidity", operator: "eq", value: "sell_side" },
    { kind: "engine_fvg_bullish", category: "Liquidity & FVG", label: "Bullish FVG", description: "Most recent fair value gap is bullish.", group: "fvg", operator: "eq", value: "bullish" },
    { kind: "engine_fvg_bearish", category: "Liquidity & FVG", label: "Bearish FVG", description: "Most recent fair value gap is bearish.", group: "fvg", operator: "eq", value: "bearish" },
    { kind: "engine_order_block_bullish", category: "Liquidity & FVG", label: "Bullish order block", description: "Most recent order block is bullish.", group: "order_block", operator: "eq", value: "bullish" },
    { kind: "engine_order_block_bearish", category: "Liquidity & FVG", label: "Bearish order block", description: "Most recent order block is bearish.", group: "order_block", operator: "eq", value: "bearish" },

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
export function engineNodeToRule(id: string, kind: string, timeframe: Timeframe): StrategyRule | null {
    const def = BY_KIND.get(kind);
    if (!def) return null;
    return {
        id: `${def.kind}_${id}`,
        enabled: true,
        group: def.group,
        label: def.label,
        operator: def.operator,
        timeframe,
        value: def.value,
        negate: false,
        groupLogic: "AND",
        ...(def.indicator ? { indicator: def.indicator } : {}),
    };
}
