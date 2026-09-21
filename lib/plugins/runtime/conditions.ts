import { DeclarativeCondition, ConditionSource, ConditionOperator } from "../types";
import { RuntimeMarketSnapshot } from "./market";

/**
 * Declarative condition evaluator.
 *
 * Generated plugins (AI Plugin Studio) express their runtime logic as a tree
 * of declarative conditions over typed data sources. The evaluator resolves
 * each `source` path against the runtime context. There is NO arbitrary code
 * execution — this is the sandbox boundary for generated plugins.
 */

export type ConditionContext = {
    market?: Record<string, RuntimeMarketSnapshot>;
    risk?: {
        drawdownPercent: number;
        exposure: number;
        positionCount: number;
        correlatedExposure: number;
    };
    news?: {
        incomingEvents: number;
        recentImpact: number;
    };
};

type NumericValue = number | null;

function getNumeric(context: ConditionContext, source: ConditionSource): NumericValue {
    const parts = source.split(".");
    if (parts[0] === "market") {
        // First market snapshot available (conditions are evaluated per selected symbol
        // by the engine, so the context carries one snapshot keyed by symbol).
        const snapshots = context.market || {};
        const first = Object.values(snapshots)[0];
        if (!first) return null;
        return resolveMarketPart(first, parts.slice(1));
    }
    if (parts[0] === "risk") {
        const risk = context.risk;
        if (!risk) return null;
        switch (parts[1]) {
            case "drawdownPercent": return risk.drawdownPercent;
            case "exposure": return risk.exposure;
            case "positionCount": return risk.positionCount;
            case "correlatedExposure": return risk.correlatedExposure;
        }
        return null;
    }
    if (parts[0] === "news") {
        const news = context.news;
        if (!news) return null;
        switch (parts[1]) {
            case "incomingEvents": return news.incomingEvents;
            case "recentImpact": return news.recentImpact;
        }
        return null;
    }
    return null;
}

function resolveMarketPart(snapshot: RuntimeMarketSnapshot, parts: string[]): NumericValue {
    const [a, b] = parts;
    if (a === "volatility" && b) {
        const v = snapshot.volatility as Record<string, unknown>;
        return finite(v[b]);
    }
    if (a === "regime") {
        if (b === "confidence") return finite((snapshot.regime as Record<string, unknown>).confidence);
        return null; // regime regime handled via string comparison
    }
    if (a === "score") {
        return null; // market score is computed client-side and is not part of the declarative runtime contract
    }
    if (a === "quote") {
        const q = snapshot.quote as Record<string, unknown>;
        return finite(q[b]);
    }
    if (a === "structure") {
        if (b === "count") return snapshot.structure.length;
        return null;
    }
    if (a === "liquidity") {
        if (b === "count") return snapshot.liquidity.length;
        return null;
    }
    if (a === "session") return null;
    if (a === "multiTimeframe") return null;
    return null;
}

function finite(value: unknown): NumericValue {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function getString(context: ConditionContext, source: ConditionSource): string | null {
    const parts = source.split(".");
    if (parts[0] === "market") {
        const snapshots = context.market || {};
        const first = Object.values(snapshots)[0];
        if (!first) return null;
        if (parts[1] === "volatility" && parts[2] === "state") return String(first.volatility.state || "");
        if (parts[1] === "regime" && parts[2] === "regime") return String(first.regime.regime || "");
        if (parts[1] === "session" && parts[2] === "current") return String(first.session.current || "");
        if (parts[1] === "multiTimeframe" && parts[2] === "bias") {
            const mtf = first.multiTimeframe || [];
            const bias = mtf.length > 0 ? String((mtf[mtf.length - 1] as { bias?: string }).bias || "") : "";
            return bias;
        }
        return null;
    }
    return null;
}

function compareNumeric(operator: ConditionOperator, actual: NumericValue, expected: number): boolean {
    if (actual === null) return false;
    switch (operator) {
        case "gt": return actual > expected;
        case "gte": return actual >= expected;
        case "lt": return actual < expected;
        case "lte": return actual <= expected;
        case "eq": return actual === expected;
        case "neq": return actual !== expected;
        default: return false;
    }
}

/**
 * Evaluates a condition tree. When the source is numeric, compares with the
 * configured value. When the source is textual, `value` must match exactly.
 * `crossed_above` / `crossed_below` require the runtime to pass a signed
 * "currentChange" numeric — they act on quote.changePercent.
 */
export function evaluateCondition(
    condition: DeclarativeCondition,
    context: ConditionContext,
    currentChange?: number
): { matched: boolean; reason: string } {
    const numericValue = getNumeric(context, condition.source);
    const stringValue = getString(context, condition.source);
    const op = condition.operator;

    if (op === "crossed_above" || op === "crossed_below") {
        const change = typeof currentChange === "number" ? currentChange : null;
        if (change === null) return { matched: false, reason: "No price-change signal available." };
        const expected = Number(condition.value);
        const matched = op === "crossed_above" ? change > expected : change < -Math.abs(expected);
        return { matched, reason: `${condition.source} ${op} ${condition.value} (actual change ${change.toFixed(3)}%)` };
    }

    if (numericValue !== null) {
        const expected = Number(condition.value);
        const matched = compareNumeric(op, numericValue, expected);
        return { matched, reason: `${condition.source} ${op} ${expected} (actual ${numericValue})` };
    }

    if (stringValue !== null) {
        const expected = String(condition.value);
        // Textual sources are enums (sessions, regimes, volatility states) — compare
        // case-insensitively so model conventions like "New York" match runtime
        // codes like "newyork".
        const matched = op === "eq" ? stringValue.trim().toLowerCase() === expected.trim().toLowerCase() : op === "neq" ? stringValue.trim().toLowerCase() !== expected.trim().toLowerCase() : false;
        return { matched, reason: `${condition.source} ${op} "${expected}" (actual "${stringValue}")` };
    }

    return { matched: false, reason: `${condition.source} could not be resolved in this context.` };
}

export function evaluateConditionTree(
    condition: DeclarativeCondition,
    context: ConditionContext
): { matched: boolean; reasons: string[] } {
    const primary = evaluateCondition(condition, context);
    if (!condition.and || condition.and.length === 0) {
        return { matched: primary.matched, reasons: primary.matched ? [primary.reason] : [] };
    }
    const subResults = condition.and.map((c) => evaluateCondition(c, context));
    const allMatched = primary.matched && subResults.every((r) => r.matched);
    if (allMatched) {
        return { matched: true, reasons: [primary.reason, ...subResults.map((r) => r.reason)] };
    }
    return { matched: false, reasons: [] };
}