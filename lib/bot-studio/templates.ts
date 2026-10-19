/**
 * Ready-made bot templates for the visual builder. Each template is a starting
 * graph: indicator conditions and engine conditions wired into one entry action.
 * Every condition is ANDed by the compiler, so a template is a complete bot.
 */

import type { EngineNodeKind } from "@/lib/bot-studio/compiler/engine-nodes";
import type { NodeKind } from "@/lib/bot-studio/compiler/types";

export interface BotTemplateNode {
    id: string;
    kind: NodeKind;
    position: { x: number; y: number };
    data: Record<string, unknown>;
}

export interface BotTemplateEdge {
    id: string;
    source: string;
    target: string;
}

export interface BotTemplate {
    id: string;
    name: string;
    description: string;
    direction: "long" | "short";
    nodes: BotTemplateNode[];
    edges: BotTemplateEdge[];
}

/** A library indicator condition, or a catalog engine condition. */
export type TemplateCondition =
    | { indicator: string; operator: string; value?: number; compareTo?: string }
    | { engine: EngineNodeKind; label: string };

interface TemplateSpec {
    id: string;
    name: string;
    description: string;
    direction: "long" | "short";
    conditions: TemplateCondition[];
    riskPercent?: number;
    slMultiplier?: number;
    tpRatio?: number;
}

function makeTemplate(spec: TemplateSpec): BotTemplate {
    const entryId = "entry";
    const entryKind: NodeKind = spec.direction === "short" ? "action_enter_short" : "action_enter_long";
    const nodes: BotTemplateNode[] = [];
    const edges: BotTemplateEdge[] = [];

    spec.conditions.forEach((c, i) => {
        const id = `cond_${i + 1}`;
        const position = { x: 80, y: 60 + i * 120 };
        if ("engine" in c) {
            nodes.push({ id, kind: c.engine, position, data: { kind: c.engine, label: c.label } });
        } else {
            const compare = c.compareTo ? { compareTo: c.compareTo } : { value: c.value ?? 0 };
            nodes.push({
                id,
                kind: "indicator_condition",
                position,
                data: { kind: "indicator_condition", indicator: c.indicator, operator: c.operator, ...compare },
            });
        }
        edges.push({ id: `e_${id}`, source: id, target: entryId });
    });

    nodes.push({
        id: entryId,
        kind: entryKind,
        position: { x: 420, y: 200 },
        data: {
            kind: entryKind,
            riskPercent: spec.riskPercent ?? 1,
            slType: "atr",
            slMultiplier: spec.slMultiplier ?? 2,
            tpType: "risk_reward",
            tpRatio: spec.tpRatio ?? 2,
        },
    });

    return { id: spec.id, name: spec.name, description: spec.description, direction: spec.direction, nodes, edges };
}

export const BOT_TEMPLATES: readonly BotTemplate[] = [
    makeTemplate({
        id: "ema_trend_cross",
        name: "EMA 20/50 trend cross",
        description: "Long when EMA 20 crosses above EMA 50 and the trend is bullish.",
        direction: "long",
        conditions: [
            { indicator: "ema_20", operator: "crosses_above", compareTo: "ema_50" },
            { engine: "engine_trend_bullish", label: "Trend is bullish" },
        ],
    }),
    makeTemplate({
        id: "ema_trend_cross_short",
        name: "EMA 20/50 trend cross (short)",
        description: "Short when EMA 20 crosses below EMA 50 and the trend is bearish.",
        direction: "short",
        conditions: [
            { indicator: "ema_20", operator: "crosses_below", compareTo: "ema_50" },
            { engine: "engine_trend_bearish", label: "Trend is bearish" },
        ],
    }),
    makeTemplate({
        id: "rsi_pullback",
        name: "RSI 14 pullback",
        description: "Long when RSI 14 recovers above 30 while price holds above EMA 200.",
        direction: "long",
        conditions: [
            { indicator: "rsi_14", operator: "crosses_above", value: 30 },
            { indicator: "close", operator: "gt", compareTo: "ema_200" },
        ],
    }),
    makeTemplate({
        id: "macd_momentum",
        name: "MACD momentum",
        description: "Long when the MACD line crosses above its signal with positive histogram.",
        direction: "long",
        conditions: [
            { indicator: "macd_line", operator: "crosses_above", compareTo: "macd_signal" },
            { indicator: "macd_hist", operator: "gt", value: 0 },
        ],
    }),
    makeTemplate({
        id: "stochastic_cross",
        name: "Stochastic oversold cross",
        description: "Long when %K crosses above %D while still below 30.",
        direction: "long",
        conditions: [
            { indicator: "stoch_k_14", operator: "crosses_above", compareTo: "stoch_d_14" },
            { indicator: "stoch_k_14", operator: "lt", value: 30 },
        ],
    }),
    makeTemplate({
        id: "donchian_breakout",
        name: "Donchian 20 breakout",
        description: "Long on a close above the 20-bar high when ADX shows a trend.",
        direction: "long",
        conditions: [
            { indicator: "close", operator: "crosses_above", compareTo: "donchian_high_20" },
            { indicator: "adx_14", operator: "gt", value: 20 },
        ],
    }),
    makeTemplate({
        id: "adx_di_trend",
        name: "ADX directional trend",
        description: "Long when +DI crosses above -DI with ADX above 25.",
        direction: "long",
        conditions: [
            { indicator: "plus_di_14", operator: "crosses_above", compareTo: "minus_di_14" },
            { indicator: "adx_14", operator: "gt", value: 25 },
        ],
    }),
    makeTemplate({
        id: "bollinger_fade",
        name: "Bollinger upper fade",
        description: "Short when price closes back below the upper band with RSI overbought.",
        direction: "short",
        conditions: [
            { indicator: "close", operator: "crosses_below", compareTo: "bb_upper_20" },
            { indicator: "rsi_14", operator: "gt", value: 70 },
        ],
    }),
    makeTemplate({
        id: "london_breakout",
        name: "London session breakout",
        description: "Long on a 20-bar high breakout during the London session.",
        direction: "long",
        conditions: [
            { engine: "engine_session_london", label: "London session" },
            { indicator: "close", operator: "crosses_above", compareTo: "donchian_high_20" },
        ],
    }),
    makeTemplate({
        id: "williams_reversion",
        name: "Williams %R reversion",
        description: "Long when Williams %R leaves oversold while price holds above EMA 200.",
        direction: "long",
        conditions: [
            { indicator: "willr_14", operator: "crosses_above", value: -80 },
            { indicator: "close", operator: "gt", compareTo: "ema_200" },
        ],
    }),
    makeTemplate({
        id: "ema_9_21_cross",
        name: "EMA 9/21 fast cross",
        description: "Long when EMA 9 crosses above EMA 21 with price above EMA 200.",
        direction: "long",
        conditions: [
            { indicator: "ema_9", operator: "crosses_above", compareTo: "ema_21" },
            { indicator: "close", operator: "gt", compareTo: "ema_200" },
        ],
    }),
    makeTemplate({
        id: "ema_9_21_cross_short",
        name: "EMA 9/21 fast cross (short)",
        description: "Short when EMA 9 crosses below EMA 21 with price below EMA 200.",
        direction: "short",
        conditions: [
            { indicator: "ema_9", operator: "crosses_below", compareTo: "ema_21" },
            { indicator: "close", operator: "lt", compareTo: "ema_200" },
        ],
    }),
    makeTemplate({
        id: "golden_cross",
        name: "Golden cross 50/200",
        description: "Long when SMA 50 crosses above SMA 200.",
        direction: "long",
        conditions: [{ indicator: "sma_50", operator: "crosses_above", compareTo: "sma_200" }],
    }),
    makeTemplate({
        id: "death_cross",
        name: "Death cross 50/200 (short)",
        description: "Short when SMA 50 crosses below SMA 200.",
        direction: "short",
        conditions: [{ indicator: "sma_50", operator: "crosses_below", compareTo: "sma_200" }],
    }),
    makeTemplate({
        id: "triple_ema_stack",
        name: "Triple EMA stack",
        description: "Long when EMA 9 is above EMA 21, EMA 21 above EMA 50, and price above EMA 200.",
        direction: "long",
        conditions: [
            { indicator: "ema_9", operator: "gt", compareTo: "ema_21" },
            { indicator: "ema_21", operator: "gt", compareTo: "ema_50" },
            { indicator: "close", operator: "gt", compareTo: "ema_200" },
        ],
    }),
    makeTemplate({
        id: "ema_12_26_cross",
        name: "EMA 12/26 cross",
        description: "Long when EMA 12 crosses above EMA 26 with price above EMA 100.",
        direction: "long",
        conditions: [
            { indicator: "ema_12", operator: "crosses_above", compareTo: "ema_26" },
            { indicator: "close", operator: "gt", compareTo: "ema_100" },
        ],
    }),
    makeTemplate({
        id: "rsi2_pullback",
        name: "RSI 2 pullback",
        description: "Long when RSI 2 drops below 10 while price holds above EMA 200.",
        direction: "long",
        conditions: [
            { indicator: "rsi_2", operator: "lt", value: 10 },
            { indicator: "close", operator: "gt", compareTo: "ema_200" },
        ],
    }),
    makeTemplate({
        id: "rsi7_overbought_short",
        name: "RSI 7 overbought fade (short)",
        description: "Short when RSI 7 crosses below 70 after being overbought.",
        direction: "short",
        conditions: [{ indicator: "rsi_7", operator: "crosses_below", value: 70 }],
    }),
    makeTemplate({
        id: "macd_zero_cross",
        name: "MACD zero-line cross",
        description: "Long when the MACD line crosses above zero with price above EMA 100.",
        direction: "long",
        conditions: [
            { indicator: "macd_line", operator: "crosses_above", value: 0 },
            { indicator: "close", operator: "gt", compareTo: "ema_100" },
        ],
    }),
    makeTemplate({
        id: "cci_zero_cross",
        name: "CCI zero-line cross",
        description: "Long when CCI 20 crosses above zero.",
        direction: "long",
        conditions: [{ indicator: "cci_20", operator: "crosses_above", value: 0 }],
    }),
    makeTemplate({
        id: "roc_momentum",
        name: "Rate-of-change momentum",
        description: "Long when both 10 and 20 bar rate of change are positive.",
        direction: "long",
        conditions: [
            { indicator: "roc_10", operator: "gt", value: 0 },
            { indicator: "roc_20", operator: "gt", value: 0 },
        ],
    }),
    makeTemplate({
        id: "bollinger_lower_bounce",
        name: "Bollinger lower-band bounce",
        description: "Long when price closes back above the lower band with RSI 14 below 40.",
        direction: "long",
        conditions: [
            { indicator: "close", operator: "crosses_above", compareTo: "bb_lower_20" },
            { indicator: "rsi_14", operator: "lt", value: 40 },
        ],
    }),
    makeTemplate({
        id: "bollinger_squeeze",
        name: "Bollinger squeeze breakout",
        description: "Long on a close above the upper band after a tight squeeze.",
        direction: "long",
        conditions: [
            { indicator: "bb_width_20", operator: "lt", value: 1.5 },
            { indicator: "close", operator: "crosses_above", compareTo: "bb_upper_20" },
        ],
    }),
    makeTemplate({
        id: "turtle_55_breakout",
        name: "Turtle 55-bar breakout",
        description: "Long on a close above the 55-bar high with ADX above 20.",
        direction: "long",
        conditions: [
            { indicator: "close", operator: "crosses_above", compareTo: "donchian_high_55" },
            { indicator: "adx_14", operator: "gt", value: 20 },
        ],
    }),
    makeTemplate({
        id: "donchian_20_breakdown",
        name: "Donchian 20 breakdown (short)",
        description: "Short on a close below the 20-bar low.",
        direction: "short",
        conditions: [{ indicator: "close", operator: "crosses_below", compareTo: "donchian_low_20" }],
    }),
    makeTemplate({
        id: "adx_di_short",
        name: "ADX directional trend (short)",
        description: "Short when -DI crosses above +DI with ADX above 25.",
        direction: "short",
        conditions: [
            { indicator: "minus_di_14", operator: "crosses_above", compareTo: "plus_di_14" },
            { indicator: "adx_14", operator: "gt", value: 25 },
        ],
    }),
    makeTemplate({
        id: "stochastic_overbought_short",
        name: "Stochastic overbought cross (short)",
        description: "Short when %K crosses below %D while above 70.",
        direction: "short",
        conditions: [
            { indicator: "stoch_k_14", operator: "crosses_below", compareTo: "stoch_d_14" },
            { indicator: "stoch_k_14", operator: "gt", value: 70 },
        ],
    }),
    makeTemplate({
        id: "williams_overbought_short",
        name: "Williams %R overbought (short)",
        description: "Short when Williams %R crosses below -20.",
        direction: "short",
        conditions: [{ indicator: "willr_14", operator: "crosses_below", value: -20 }],
    }),
    makeTemplate({
        id: "london_ema_pullback",
        name: "London EMA 20 pullback",
        description: "Long when price crosses above EMA 20 during the London session.",
        direction: "long",
        conditions: [
            { engine: "engine_session_london", label: "London session" },
            { indicator: "close", operator: "crosses_above", compareTo: "ema_20" },
        ],
    }),
    makeTemplate({
        id: "trend_rsi_continuation",
        name: "Bullish trend + RSI continuation",
        description: "Long when the trend is bullish and RSI 14 is above 50.",
        direction: "long",
        conditions: [
            { engine: "engine_trend_bullish", label: "Trend is bullish" },
            { indicator: "rsi_14", operator: "gt", value: 50 },
        ],
    }),
];

export function findBotTemplate(id: string): BotTemplate | undefined {
    return BOT_TEMPLATES.find((t) => t.id === id);
}
