/**
 * Bot Studio — Visual Builder node types.
 *
 * These are the serialization types for the ReactFlow node graph. The compiler
 * (`visual-to-strategy.ts`) converts a graph of these nodes into a canonical
 * `Strategy` (lib/strategy-lab/types.ts).
 *
 * Design rules:
 *   - Every node has a `kind` discriminant and a `data` payload.
 *   - Nodes reference each other only by `id` (graph edges).
 *   - No circular references in the data payload.
 *   - No runtime state in node data — purely declarative.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Node kinds
// ─────────────────────────────────────────────────────────────────────────────

import type { EngineNodeKind } from "./engine-nodes";

export type NodeKind =
    | EngineNodeKind
    | "market_data"
    | "indicator_ema"
    | "indicator_sma"
    | "indicator_rsi"
    | "indicator_macd"
    | "indicator_atr"
    | "indicator_bb"
    | "indicator_stochastic"
    | "condition_gt"
    | "condition_lt"
    | "condition_eq"
    | "condition_cross_above"
    | "condition_cross_below"
    | "condition_and"
    | "condition_or"
    | "action_enter_long"
    | "action_enter_short"
    | "action_close_long"
    | "action_close_short"
    | "risk_control";

// ─────────────────────────────────────────────────────────────────────────────
// Node data payloads
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketDataNodeData {
    symbol: string;
    timeframe: string;
    priceField: "close" | "open" | "high" | "low" | "hl2" | "hlc3" | "ohlc4";
}

export interface EMANodeData {
    period: number;
    source: "close" | "open" | "high" | "low";
    timeframe?: string;
}

export interface SMANodeData {
    period: number;
    source: "close" | "open" | "high" | "low";
    timeframe?: string;
}

export interface RSINodeData {
    period: number;
    source: "close";
    timeframe?: string;
}

export interface MACDNodeData {
    fastPeriod: number;
    slowPeriod: number;
    signalPeriod: number;
    output: "macd" | "signal" | "histogram";
    timeframe?: string;
}

export interface ATRNodeData {
    period: number;
    timeframe?: string;
}

export interface BBNodeData {
    period: number;
    stdDev: number;
    output: "upper" | "middle" | "lower";
    timeframe?: string;
}

export interface StochasticNodeData {
    kPeriod: number;
    dPeriod: number;
    smooth: number;
    output: "k" | "d";
    timeframe?: string;
}

export interface ComparisonNodeData {
    leftInput: "price" | "indicator";
    rightInput: "price" | "indicator" | "value";
    /** Literal threshold value when rightInput === "value". */
    threshold?: number;
}

export interface CrossNodeData {
    /** No additional config — edges define which series cross. */
    label?: string;
}

export interface LogicNodeData {
    /** AND / OR combinator. No additional config. */
    label?: string;
}

export interface EnterLongNodeData {
    label?: string;
    riskPercent?: number;
    slType?: "fixed_pips" | "atr" | "none";
    slPips?: number;
    slAtrMultiplier?: number;
    slMultiplier?: number;
    tpType?: "risk_reward" | "fixed_pips" | "none";
    tpRatio?: number;
    tpPips?: number;
}

export interface EnterShortNodeData {
    label?: string;
    riskPercent?: number;
    slType?: "fixed_pips" | "atr" | "none";
    slPips?: number;
    slAtrMultiplier?: number;
    slMultiplier?: number;
    tpType?: "risk_reward" | "fixed_pips" | "none";
    tpRatio?: number;
    tpPips?: number;
}

export interface CloseLongNodeData {
    label?: string;
}

export interface CloseShortNodeData {
    label?: string;
}

export interface RiskControlNodeData {
    riskMode: "percent" | "fixed_lot";
    riskPercent?: number;
    fixedLot?: number;
    /** ATR-based SL: SL = ATR * multiplier */
    slType: "fixed_pips" | "atr" | "none";
    slPips?: number;
    slAtrMultiplier?: number;
    slAtrPeriod?: number;
    /** TP as a risk:reward ratio or fixed pips */
    tpType: "risk_reward" | "fixed_pips" | "none";
    tpRatio?: number;
    tpPips?: number;
    /** Max risk controls */
    maxOpenPositions?: number;
    maxRiskPercent?: number;
    maxDailyLossPct?: number;
    maxTradesPerDay?: number;
    /** Cooldown between entries (ms) */
    cooldownMs?: number;
    /** Max spread in pips to allow entry */
    maxSpreadPips?: number;
    /** Trading session restriction */
    allowedSessions?: Array<"asian" | "london" | "new_york" | "overlap">;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic node wrapper (compatible with ReactFlow serialization)
// ─────────────────────────────────────────────────────────────────────────────

export type AnyNodeData =
    | MarketDataNodeData
    | EMANodeData
    | SMANodeData
    | RSINodeData
    | MACDNodeData
    | ATRNodeData
    | BBNodeData
    | StochasticNodeData
    | ComparisonNodeData
    | CrossNodeData
    | LogicNodeData
    | EnterLongNodeData
    | EnterShortNodeData
    | CloseLongNodeData
    | CloseShortNodeData
    | RiskControlNodeData;

export interface VisualNode {
    id: string;
    kind: NodeKind;
    data: AnyNodeData;
    /** Position in the canvas (not used by compiler). */
    position?: { x: number; y: number };
}

export interface VisualEdge {
    id: string;
    /** Source node id. */
    source: string;
    /** Source handle (port). */
    sourceHandle?: string;
    /** Target node id. */
    target: string;
    /** Target handle (port). */
    targetHandle?: string;
}

/** Serialized node graph (what ReactFlow produces and what we persist). */
export interface NodeGraph {
    nodes: VisualNode[];
    edges: VisualEdge[];
    /** Strategy-level metadata, edited in the sidebar. */
    meta: {
        name: string;
        description?: string;
        symbol: string;
        timeframe: string;
        direction: "long" | "short" | "both";
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compiler result
// ─────────────────────────────────────────────────────────────────────────────

export interface CompilerDiagnostic {
    nodeId?: string;
    message: string;
    severity: "error" | "warning";
}

export interface CompileResult<T> {
    ok: boolean;
    value?: T;
    diagnostics: CompilerDiagnostic[];
}

/** Version of the visual compiler — bump when compilation semantics change. */
export const VISUAL_COMPILER_VERSION = "1.0.0";
/** Version of the AvScript compiler. */
export const AVSCRIPT_COMPILER_VERSION = "1.0.0";
