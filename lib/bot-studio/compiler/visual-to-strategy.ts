/**
 * Bot Studio — Visual Builder compiler.
 *
 * Converts a ReactFlow node graph into a canonical `Strategy`
 * (lib/strategy-lab/types.ts). This is the ONLY path from node graph to
 * executable strategy — never write a Strategy directly from UI state.
 *
 * Compilation is purely deterministic: same graph → same Strategy.
 * No AI, no network, no side effects.
 */

import type { Strategy, StrategyRule, StrategySL, StrategyTP, StrategyRisk, StrategyFilters, TimeframeHierarchy } from "@/lib/strategy-lab/types";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
// Suppress unused-var on the type-only import used in TS generics below
/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
    NodeGraph,
    VisualNode,
    VisualEdge,
    RiskControlNodeData,
    CompilerDiagnostic,
    CompileResult,
} from "./types";
import { VISUAL_COMPILER_VERSION } from "./types";
import { engineNodeToRule, findEngineNode } from "./engine-nodes";

const VALID_TIMEFRAMES: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];
const DEFAULT_TF: Timeframe = "M5";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function err(msg: string, nodeId?: string): CompilerDiagnostic {
    return { severity: "error", message: msg, nodeId };
}

function warn(msg: string, nodeId?: string): CompilerDiagnostic {
    return { severity: "warning", message: msg, nodeId };
}

function normTf(tf: string | undefined): Timeframe {
    const upper = (tf ?? "").toUpperCase() as Timeframe;
    return VALID_TIMEFRAMES.includes(upper) ? upper : DEFAULT_TF;
}

function targetsOf(edges: VisualEdge[], sourceId: string): string[] {
    return edges.filter((e) => e.source === sourceId).map((e) => e.target);
}

function sourcesOf(edges: VisualEdge[], targetId: string): string[] {
    return edges.filter((e) => e.target === targetId).map((e) => e.source);
}

function nodeById(nodes: VisualNode[], id: string): VisualNode | undefined {
    return nodes.find((n) => n.id === id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Map indicator node → StrategyRule
// ─────────────────────────────────────────────────────────────────────────────

function indicatorNodeToRule(
    node: VisualNode,
    graph: NodeGraph,
    diag: CompilerDiagnostic[],
): StrategyRule | null {
    const { kind, data, id } = node;

    // EMA cross is the most common composite: cross_above(ema_fast, ema_slow)
    // We handle cross nodes separately (see below). Here we handle single
    // indicator nodes that represent threshold conditions.

    switch (kind) {
        case "indicator_rsi": {
            const d = data as { period?: number; timeframe?: string };
            const tf = normTf(d.timeframe);
            return {
                id: `rsi_${id}`,
                enabled: true,
                group: "indicator" as const,
                label: `RSI(${d.period ?? 14}) filter`,
                operator: "lt" as const,
                timeframe: tf,
                value: 70,
                negate: false,
                groupLogic: "AND" as const,
                indicator: "rsi" as const,
            };
        }
        case "indicator_ema": {
            diag.push(warn(`EMA node ${id} should be connected to a cross or comparison condition node for entry rules. It will be treated as a trend filter.`, id));
            return null;
        }
        case "indicator_atr":
            return null;
        default:
            return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Map condition/cross nodes → StrategyRule
// ─────────────────────────────────────────────────────────────────────────────

function conditionNodeToRule(
    node: VisualNode,
    nodes: VisualNode[],
    edges: VisualEdge[],
    diag: CompilerDiagnostic[],
): StrategyRule | null {
    const { kind, id, data } = node;
    const srcs = sourcesOf(edges, id);

    switch (kind) {
        case "condition_cross_above": {
            const [src1, src2] = srcs;
            const n1 = src1 ? nodeById(nodes, src1) : undefined;
            const n2 = src2 ? nodeById(nodes, src2) : undefined;

            if (n1?.kind === "indicator_ema" && n2?.kind === "indicator_ema") {
                const d1 = n1.data as { period?: number; timeframe?: string };
                const d2 = n2.data as { period?: number; timeframe?: string };
                return {
                    id: `cross_above_${id}`,
                    enabled: true,
                    group: "indicator" as const,
                    label: `EMA(${d1.period ?? 9}) crosses above EMA(${d2.period ?? 21})`,
                    operator: "gt" as const,
                    timeframe: normTf(d1.timeframe),
                    value: [String(d1.period ?? 9), String(d2.period ?? 21)],
                    negate: false,
                    groupLogic: "AND" as const,
                    indicator: "ema_cross" as const,
                };
            }

            return {
                id: `cross_above_${id}`,
                enabled: true,
                group: "price_action" as const,
                label: "Cross above",
                operator: "gt" as const,
                timeframe: DEFAULT_TF,
                value: 0,
                negate: false,
                groupLogic: "AND" as const,
            };
        }

        case "condition_cross_below": {
            const [src1, src2] = srcs;
            const n1 = src1 ? nodeById(nodes, src1) : undefined;
            const n2 = src2 ? nodeById(nodes, src2) : undefined;

            if (n1?.kind === "indicator_ema" && n2?.kind === "indicator_ema") {
                const d1 = n1.data as { period?: number; timeframe?: string };
                const d2 = n2.data as { period?: number; timeframe?: string };
                return {
                    id: `cross_below_${id}`,
                    enabled: true,
                    group: "indicator" as const,
                    label: `EMA(${d1.period ?? 9}) crosses below EMA(${d2.period ?? 21})`,
                    operator: "lt" as const,
                    timeframe: normTf(d1.timeframe),
                    value: [String(d1.period ?? 9), String(d2.period ?? 21)],
                    negate: true,
                    groupLogic: "AND" as const,
                    indicator: "ema_cross" as const,
                };
            }

            return {
                id: `cross_below_${id}`,
                enabled: true,
                group: "price_action" as const,
                label: "Cross below",
                operator: "lt" as const,
                timeframe: DEFAULT_TF,
                value: 0,
                negate: false,
                groupLogic: "AND" as const,
            };
        }

        case "condition_gt": {
            const d = data as { threshold?: number };
            const srcNode = srcs[0] ? nodeById(nodes, srcs[0]) : undefined;
            if (srcNode?.kind === "indicator_rsi") {
                const rd = srcNode.data as { period?: number; timeframe?: string };
                return {
                    id: `rsi_gt_${id}`,
                    enabled: true,
                    group: "indicator" as const,
                    label: `RSI(${rd.period ?? 14}) > ${d.threshold ?? 50}`,
                    operator: "gt" as const,
                    timeframe: normTf(rd.timeframe),
                    value: d.threshold ?? 50,
                    negate: false,
                    groupLogic: "AND" as const,
                    indicator: "rsi" as const,
                };
            }
            return {
                id: `gt_${id}`,
                enabled: true,
                group: "indicator" as const,
                label: `Value > ${d.threshold ?? 0}`,
                operator: "gt" as const,
                timeframe: DEFAULT_TF,
                value: d.threshold ?? 0,
                negate: false,
                groupLogic: "AND" as const,
            };
        }

        case "condition_lt": {
            const d = data as { threshold?: number };
            const srcNode = srcs[0] ? nodeById(nodes, srcs[0]) : undefined;
            if (srcNode?.kind === "indicator_rsi") {
                const rd = srcNode.data as { period?: number; timeframe?: string };
                return {
                    id: `rsi_lt_${id}`,
                    enabled: true,
                    group: "indicator" as const,
                    label: `RSI(${rd.period ?? 14}) < ${d.threshold ?? 70}`,
                    operator: "lt" as const,
                    timeframe: normTf(rd.timeframe),
                    value: d.threshold ?? 70,
                    negate: false,
                    groupLogic: "AND" as const,
                    indicator: "rsi" as const,
                };
            }
            return {
                id: `lt_${id}`,
                enabled: true,
                group: "indicator" as const,
                label: `Value < ${d.threshold ?? 100}`,
                operator: "lt" as const,
                timeframe: DEFAULT_TF,
                value: d.threshold ?? 100,
                negate: false,
                groupLogic: "AND" as const,
            };
        }

        default:
            diag.push(warn(`Condition node ${kind} (id=${id}) produces no entry rule — skipped.`, id));
            return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract SL/TP/Risk from RiskControl node
// ─────────────────────────────────────────────────────────────────────────────

function extractRisk(
    riskNode: VisualNode | undefined,
    actionNode: VisualNode | undefined,
    diag: CompilerDiagnostic[],
): { sl: StrategySL; tp: StrategyTP; risk: StrategyRisk; filters: StrategyFilters } {
    const rd = (riskNode?.data ?? {}) as Partial<RiskControlNodeData>;
    const ad = (actionNode?.data ?? {}) as Record<string, any>;
    const d: any = { ...ad, ...rd };

    const sl: StrategySL = {
        mode: d.slType === "atr" ? "atr" : "level",
        atrMultiple: d.slAtrMultiplier ?? 2.0,
        levelOffset: d.slPips ?? 30,
        useSwing: false,
    };

    const tp: StrategyTP = {
        mode: d.tpType === "fixed_pips" ? "fixed" : "r",
        r1: d.tpRatio ?? 2.0,
        r2: (d.tpRatio ?? 2.0) * 1.5,
        r3: (d.tpRatio ?? 2.0) * 2.0,
        fixedDistance: d.tpPips ?? 60,
        partialCloses: [],
        moveBeAfterTp1: false,
        lockAfterTp2: false,
        trailingEnabled: false,
        trailingStopAtr: 1.0,
    };

    const risk: StrategyRisk = {
        mode: d.riskMode ?? "percent",
        riskPercent: d.riskPercent ?? 1.0,
        fixedLot: d.fixedLot ?? 0.01,
        maxPositions: d.maxOpenPositions ?? 1,
        dailyLossLimitPct: d.maxDailyLossPct ?? 3.0,
        maxDrawdownPct: 20,
    };

    const filters: StrategyFilters = {
        sessions: d.allowedSessions ?? [],
        daysOfWeek: [1, 2, 3, 4, 5],
        volatilityMinAtrPct: 0,
        volatilityMaxAtrPct: 999,
        maxTradesPerDay: d.maxOpenPositions ?? 3,
        cooldownCandles: d.cooldownMs ? Math.round(d.cooldownMs / 60000) : 0,
    };

    if (!riskNode) {
        diag.push(warn("No Risk Control node found. Using safe defaults: 1% risk, 2.0 ATR SL, 2:1 R:R."));
    }

    return { sl, tp, risk, filters };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main compiler
// ─────────────────────────────────────────────────────────────────────────────

export function compileNodeGraph(
    graph: NodeGraph,
    strategyId = "STRAT_PREVIEW",
): CompileResult<Strategy> {
    const diag: CompilerDiagnostic[] = [];
    const { nodes, edges, meta } = graph;

    // ── Validate meta ──
    const symbol = meta.symbol as SupportedSymbol;
    if (!([...SUPPORTED_SYMBOLS] as string[]).includes(meta.symbol)) {
        diag.push(err(`Unsupported symbol: "${meta.symbol}". Check the market data node.`));
    }
    const entryTf = normTf(meta.timeframe);
    if (!meta.name?.trim()) {
        diag.push(err("Strategy name is required (set it in the node graph metadata)."));
    }

    // ── Find action nodes ──
    const enterLongNodes = nodes.filter((n) => n.kind === "action_enter_long");
    const enterShortNodes = nodes.filter((n) => n.kind === "action_enter_short");

    if (enterLongNodes.length === 0 && enterShortNodes.length === 0) {
        diag.push(err("The strategy has no entry action. Add an Enter Long or Enter Short node."));
    }

    const direction: "long" | "short" =
        enterLongNodes.length > 0 && enterShortNodes.length === 0
            ? "long"
            : enterLongNodes.length === 0 && enterShortNodes.length > 0
            ? "short"
            : "long"; // both → treat as long for the canonical definition

    if (enterLongNodes.length > 0 && enterShortNodes.length > 0) {
        diag.push(warn("Both Enter Long and Enter Short nodes present. The canonical definition will use 'long'. Use separate strategies for long and short."));
    }

    // ── Build entry rules & extract risk ──
    const actionNode = enterLongNodes[0] ?? enterShortNodes[0];
    const riskNode = nodes.find((n) => n.kind === "risk_control");
    const { sl, tp, risk, filters } = extractRisk(riskNode, actionNode, diag);
    const entryRules: StrategyRule[] = [];

    if (actionNode) {
        // Find all condition/cross nodes feeding into the action node (directly or via AND/OR).
        const queue: string[] = sourcesOf(edges, actionNode.id);
        const visited = new Set<string>();

        while (queue.length > 0) {
            const nodeId = queue.shift()!;
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);

            const node = nodeById(nodes, nodeId);
            if (!node) continue;

            if (node.kind === "condition_and" || node.kind === "condition_or") {
                // Recurse into combinator inputs
                for (const src of sourcesOf(edges, node.id)) {
                    if (!visited.has(src)) queue.push(src);
                }
                continue;
            }

            if (findEngineNode(node.kind)) {
                const rule = engineNodeToRule(node.id, node.kind, entryTf);
                if (rule) entryRules.push(rule);
                continue;
            }

            if (node.kind.startsWith("condition_") || node.kind.startsWith("indicator_")) {
                const rule = node.kind.startsWith("condition_")
                    ? conditionNodeToRule(node, nodes, edges, diag)
                    : indicatorNodeToRule(node, graph, diag);
                if (rule) entryRules.push(rule);
            }
        }
    }

    if (entryRules.length === 0) {
        diag.push(err("No entry conditions found. Connect condition nodes to the Enter action node."));
    }

    // ── Timeframe hierarchy ──
    const timeframes: TimeframeHierarchy = {
        macro: "H4",
        structure: "H1",
        setup: "M15",
        entry: entryTf,
    };

    // ── Build canonical Strategy ──
    const hasErrors = diag.some((d) => d.severity === "error");
    if (hasErrors) {
        return { ok: false, diagnostics: diag };
    }

    const now = Date.now();
    const strategy: Strategy = {
        id: strategyId,
        name: meta.name.trim(),
        description: meta.description?.trim() ?? "",
        asset: symbol,
        direction,
        timeframes,
        regimeFilter: [],
        entryRules,
        confirmationRules: [],
        stopLoss: sl,
        takeProfit: tp,
        risk,
        filters,
        executionModel: "next_bar_open",
        costs: {
            spreadPips: 2,
            commissionPerLot: 7,
            slippagePips: 1,
        },
        sourcePatternId: null,
        whyp: {
            discovered: `Visual builder (${VISUAL_COMPILER_VERSION})`,
            conditionsSelected: entryRules.map((r) => r.label).join("; "),
            occurrenceFrequency: "Not specified",
            historicalPerformance: "Not yet backtested",
            weaknesses: "Not yet analysed",
            poorRegimes: "Not yet analysed",
            generatedByProvider: "visual_builder",
        },
        version: "1.0.0",
        created: now,
        updated: now,
    };

    return { ok: true, value: strategy, diagnostics: diag };
}
