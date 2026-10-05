/**
 * Strategy decision trace (Phase 4).
 *
 * Every entry decision can produce a structured, inspectable record:
 *
 *   2026-10-05 14:35 · XAUUSD M5
 *   Conditions: EMA20 > EMA50 → TRUE · RSI > 50 → TRUE · Bullish BOS → TRUE
 *   Risk:      max_risk_per_trade PASS · max_open_positions PASS
 *   Decision:  LONG
 *   Order:     MARKET 0.05 → Execution: FILLED @ 4012.30
 *
 * Used by debug mode, the trade journal, AI inspection and user trust.
 * Traces never fabricate: every line derives from the actual evaluation.
 */

import type { Strategy } from "@/lib/strategy-lab/types";
import type { EntryEvaluation } from "./decisions";
import type {
    DecisionTrace,
    ExecutionEnvironment,
    OrderSide,
    OrderStatus,
    OrderType,
    RiskVerdict,
    Timeframe,
} from "./types";

export interface BuildTraceInput {
    environment: ExecutionEnvironment;
    symbol: string;
    timeframe: Timeframe;
    strategy: Strategy;
    timestamp: number;
    evaluation: EntryEvaluation | null;
    risk: RiskVerdict;
    decision: DecisionTrace["decision"];
    order?: { type: OrderType; side: OrderSide; quantity: number; price?: number };
    execution?: { status: OrderStatus; price?: number; message?: string };
    positionId?: string;
    note?: string;
}

let traceSeq = 0;

export function buildDecisionTrace(input: BuildTraceInput): DecisionTrace {
    traceSeq += 1;
    return {
        id: `trace-${input.timestamp.toString(36)}-${traceSeq}`,
        timestamp: input.timestamp,
        environment: input.environment,
        symbol: input.symbol,
        timeframe: input.timeframe,
        strategyId: input.strategy.id,
        strategyVersion: input.strategy.version,
        conditions: (input.evaluation?.conditionTrace ?? []).map((c) => ({
            label: c.label,
            detail: c.detail,
            passed: c.passed,
        })),
        risk: {
            checks: input.risk.checks.map((c) => ({ name: c.name, passed: c.passed, detail: c.detail })),
            allowed: input.risk.allowed,
        },
        decision: input.decision,
        order: input.order,
        execution: input.execution,
        positionId: input.positionId,
        note: input.note,
    };
}

/** Human-readable rendering (debug panel / journal / AI prompt). */
export function formatTrace(trace: DecisionTrace): string {
    const when = new Date(trace.timestamp).toISOString().replace("T", " ").slice(0, 16);
    const lines: string[] = [];
    lines.push(`${when} · ${trace.symbol} ${trace.timeframe} · ${trace.strategyId} v${trace.strategyVersion}`);
    lines.push(`Environment: ${trace.environment}`);
    lines.push("Conditions:");
    if (trace.conditions.length === 0) lines.push("  (none evaluated)");
    for (const c of trace.conditions) {
        lines.push(`  ${c.label}${c.detail ? ` [${c.detail}]` : ""} → ${c.passed ? "TRUE" : "FALSE"}`);
    }
    lines.push("Risk:");
    if (trace.risk.checks.length === 0) lines.push("  (no checks)");
    for (const c of trace.risk.checks) {
        lines.push(`  ${c.name}${c.detail ? ` [${c.detail}]` : ""} → ${c.passed ? "PASS" : "FAIL"}`);
    }
    lines.push(`Decision: ${trace.decision}`);
    if (trace.order) {
        lines.push(`Order: ${trace.order.type} ${trace.order.side} ${trace.order.quantity}${trace.order.price ? ` @ ${trace.order.price}` : ""}`);
    }
    if (trace.execution) {
        lines.push(`Execution: ${trace.execution.status}${trace.execution.price ? ` @ ${trace.execution.price}` : ""}${trace.execution.message ? ` (${trace.execution.message})` : ""}`);
    }
    if (trace.note) lines.push(`Note: ${trace.note}`);
    return lines.join("\n");
}

/** Bounded FIFO buffer of traces (keeps memory flat on long runs). */
export class TraceBuffer {
    private readonly items: DecisionTrace[] = [];

    constructor(private readonly limit: number = 200) {}

    push(trace: DecisionTrace): void {
        this.items.push(trace);
        if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
    }

    all(): DecisionTrace[] {
        return [...this.items];
    }

    last(): DecisionTrace | null {
        return this.items.length > 0 ? this.items[this.items.length - 1] : null;
    }

    clear(): void {
        this.items.length = 0;
    }
}
