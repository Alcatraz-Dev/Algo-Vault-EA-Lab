// ─────────────────────────────────────────────────────────────────────────────
// Strategy → MT5 EA Generator — entry logic translation.
//
// Translates each structured rule into a deterministic MQL5 boolean expression
// that mirrors backtest.ts evaluateRule() exactly (same field semantics, same
// operator mapping, same negation). Rule features are read from per-timeframe
// FeatureState structs (f_M5, f_H1, … ) that the EA template maintains, so
// multi-timeframe rules resolve like getFeaturesAt() in the backtest.
//
// Only literal MQL5 is emitted — the output is validated by a real MetaEditor
// compile during generation.
// ─────────────────────────────────────────────────────────────────────────────

import { ASTCondition } from "./ast";

export type EntryExpr = {
    code: string;
    usesIndicators: string[];
};

export const RULE_GROUPS = new Set([
    "trend",
    "liquidity",
    "structure",
    "fvg",
    "order_block",
    "session",
    "volatility",
    "price_action",
    "confirmation",
]);

/**
 * Mirrors compareStrings() in the backtest.
 */
function stringOp(op: string, actual: string, value: string): string {
    switch (op) {
        case "eq": return `${actual} == "${value}"`;
        case "neq": return `${actual} != "${value}"`;
        case "in": return `${actual} == "${value}"`;
        case "contains": return `StringFind(${actual}, "${value}") >= 0`;
        case "not_in": return `${actual} != "${value}"`;
        default: return "false";
    }
}

/**
 * Mirrors compareStringsArray() in the backtest.
 */
function stringArrayOp(op: string, actual: string, values: string[]): string {
    const list = values.map((v) => `"${v}"`).join(",");
    if (op === "in") return `StrIn(${actual},"${list}")`;
    if (op === "not_in") return `!StrIn(${actual},"${list}")`;
    return "false";
}

/**
 * Mirrors compareNumeric() in the backtest (eq/neq are epsilon comparisons).
 */
function numericOp(op: string, actual: string, value: number): string {
    switch (op) {
        case "gte": return `${actual} >= ${value}`;
        case "lte": return `${actual} <= ${value}`;
        case "gt": return `${actual} > ${value}`;
        case "lt": return `${actual} < ${value}`;
        case "eq": return `MathAbs(${actual} - ${value}) < 0.0001`;
        case "neq": return `MathAbs(${actual} - ${value}) >= 0.0001`;
        default: return "false";
    }
}

/**
 * Translates a single structured rule into an MQL5 boolean expression.
 * `tfVar` maps a rule to its FeatureState variable (per-rule timeframe).
 * Returns null when the rule cannot be deterministically compiled.
 */
export function translateCondition(c: ASTCondition, tfVar: (c: ASTCondition) => string): EntryExpr | null {
    const v = c.value;
    const fx = tfVar(c);
    const negate = (s: string) => (c.negate ? `!(${s})` : s);

    switch (c.group) {
        case "trend": {
            const val = String(v);
            const expr = stringOp(c.operator, `${fx}.trend`, val);
            return { code: negate(expr), usesIndicators: [] };
        }
        case "volatility": {
            if (typeof v === "string" && (v === "high" || v === "low" || v === "normal")) {
                const expr = stringOp(c.operator, `${fx}.volState`, v);
                return { code: negate(expr), usesIndicators: [] };
            }
            if (typeof v === "number") {
                const expr = numericOp(c.operator, `${fx}.atrPct`, v);
                return { code: negate(expr), usesIndicators: [] };
            }
            return null;
        }
        case "liquidity": {
            if (typeof v === "number") {
                const expr = numericOp(c.operator, `${fx}.lastSweepBarsAgo`, v);
                return { code: negate(expr), usesIndicators: [] };
            }
            if (Array.isArray(v)) {
                const expr = stringArrayOp(c.operator, `${fx}.lastSweepSide`, v.map(String));
                return { code: negate(expr), usesIndicators: [] };
            }
            const expr = stringOp(c.operator, `${fx}.lastSweepSide`, String(v));
            return { code: negate(expr), usesIndicators: [] };
        }
        case "structure": {
            const val = String(v);
            const map: Record<string, string> = {
                "choch_bullish": `${fx}.chochDirection == "bullish"`,
                "choch_bearish": `${fx}.chochDirection == "bearish"`,
                "bos_bullish": `${fx}.bosDirection == "bullish"`,
                "bos_bearish": `${fx}.bosDirection == "bearish"`,
                "hh": `${fx}.higherHigh == true`,
                "hl": `${fx}.higherLow == true`,
                "lh": `${fx}.lowerHigh == true`,
                "ll": `${fx}.lowerLow == true`,
            };
            const expr = map[val];
            // Mirrors evaluateRule(): structure values outside the known set
            // never match and are NOT negatable in the backtest.
            if (!expr) return { code: "false", usesIndicators: [] };
            return { code: negate(expr), usesIndicators: [] };
        }
        case "fvg": {
            if (typeof v === "number") {
                const expr = numericOp(c.operator, `${fx}.fvgBarsAgo`, v);
                return { code: negate(expr), usesIndicators: [] };
            }
            if (Array.isArray(v)) {
                const expr = stringArrayOp(c.operator, `${fx}.fvgDirection`, v.map(String));
                return { code: negate(expr), usesIndicators: [] };
            }
            const expr = stringOp(c.operator, `${fx}.fvgDirection`, String(v));
            return { code: negate(expr), usesIndicators: [] };
        }
        case "order_block": {
            const expr = stringOp(c.operator, `${fx}.obDirection`, String(v));
            return { code: negate(expr), usesIndicators: [] };
        }
        case "session": {
            if (Array.isArray(v)) {
                const expr = stringArrayOp(c.operator, `${fx}.session`, v.map(String));
                return { code: negate(expr), usesIndicators: [] };
            }
            const expr = stringOp(c.operator, `${fx}.session`, String(v));
            return { code: negate(expr), usesIndicators: [] };
        }
        case "price_action": {
            const val = String(v);
            if (val === "breakout_high") return { code: negate(`${fx}.breakoutHigh == true`), usesIndicators: [] };
            if (val === "breakout_low") return { code: negate(`${fx}.breakoutLow == true`), usesIndicators: [] };
            return { code: "false", usesIndicators: [] };
        }
        case "confirmation": {
            const val = String(v);
            if (val === "momentum_positive") return { code: negate(`${fx}.momentumPct > 0`), usesIndicators: [] };
            if (val === "momentum_negative") return { code: negate(`${fx}.momentumPct < 0`), usesIndicators: [] };
            if (val === "close_above_ema") return { code: negate(`${fx}.close >= ${fx}.ema20`), usesIndicators: [] };
            if (val === "close_below_ema") return { code: negate(`${fx}.close <= ${fx}.ema20`), usesIndicators: [] };
            return { code: "false", usesIndicators: [] };
        }
        default:
            return null;
    }
}

/**
 * Builds the full entry expression from a list of conditions, mirroring the
 * backtest's evaluateRules(): AND across groups, OR within a group when any
 * member uses groupLogic "OR". Unsupported rules become a hard "false" so the
 * EA is honest instead of silently weakening the signal.
 */
export function buildEntryExpression(
    conditions: ASTCondition[],
    tfVar: (c: ASTCondition) => string
): { code: string; usesIndicators: string[] } | null {
    const enabled = conditions.filter((c) => c.id);
    if (enabled.length === 0) return { code: "true", usesIndicators: [] };

    const groups = new Map<string, ASTCondition[]>();
    for (const r of enabled) {
        if (!groups.has(r.group)) groups.set(r.group, []);
        groups.get(r.group)!.push(r);
    }

    const groupExprs: string[] = [];
    const allIndicators = new Set<string>();

    for (const [, groupRules] of groups) {
        const parts: string[] = [];
        for (const r of groupRules) {
            const expr = translateCondition(r, tfVar);
            if (!expr) {
                parts.push("false /* untranslatable rule */");
                continue;
            }
            parts.push(expr.code);
            expr.usesIndicators.forEach((i) => allIndicators.add(i));
        }
        const anyOr = groupRules.some((r) => r.groupLogic === "OR");
        const joined = anyOr ? `(${parts.join(" || ")})` : `(${parts.join(" && ")})`;
        groupExprs.push(joined);
    }

    return { code: groupExprs.join(" && "), usesIndicators: [...allIndicators] };
}