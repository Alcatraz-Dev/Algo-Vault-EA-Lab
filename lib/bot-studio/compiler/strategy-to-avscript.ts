/**
 * Bot Studio — Strategy → AvScript reverse generator.
 *
 * Produces deterministic AVS source from a canonical `Strategy` for the
 * supported subset. Unsupported constructs are reported via the returned
 * `unsupported` list instead of being silently dropped.
 */

import type { Strategy, StrategyRule } from "@/lib/strategy-lab/types";
import { isIndicatorKey } from "@/lib/strategy-lab/indicator-library";

export interface StrategyToAvScriptResult {
    ok: boolean;
    source: string;
    unsupported: string[];
    diagnostics: string[];
}

function slToAvs(sl: Strategy["stopLoss"]): string {
    if (sl.mode === "atr") {
        return `stopLoss: { type: "atr", period: 14, multiplier: ${sl.atrMultiple} }`;
    }
    return `stopLoss: { type: "fixed_pips", pips: ${sl.levelOffset} }`;
}

function tpToAvs(tp: Strategy["takeProfit"]): string {
    if (tp.mode === "fixed") {
        return `takeProfit: { type: "fixed_pips", pips: ${tp.fixedDistance} }`;
    }
    return `takeProfit: { type: "riskReward", ratio: ${tp.r1} }`;
}

/** Parse an EMA key like "ema_20" → { kind: "ema", period: 20 }. */
function parseIndicatorKey(key: string): { kind: string; period?: number } | null {
    const m = key.match(/^(ema|sma|wma)_(\d+)$/);
    if (m) return { kind: m[1], period: Number(m[2]) };
    const m2 = key.match(/^(rsi)_(\d+)$/);
    if (m2) return { kind: m2[1], period: Number(m2[2]) };
    return null;
}

/** Declare an indicator variable if needed, returning its AVS expression. */
function declareIndicator(indicator: string, declared: Set<string>, lines: string[]): string | null {
    if (declared.has(indicator)) return indicator;

    const parsed = parseIndicatorKey(indicator);
    if (!parsed) return null; // not a simple moving-average/oscillator key

    let expr: string;
    switch (parsed.kind) {
        case "ema":
            expr = `indicators.ema(close, ${parsed.period})`;
            break;
        case "sma":
            expr = `indicators.sma(close, ${parsed.period})`;
            break;
        case "wma":
            expr = `indicators.wma(close, ${parsed.period})`;
            break;
        case "rsi":
            expr = `indicators.rsi(close, ${parsed.period})`;
            break;
        default:
            return null;
    }

    const varName = `ind_${indicator.replace(/[^a-zA-Z0-9]/g, "_")}`;
    lines.push(`const ${varName} = ${expr};`);
    declared.add(indicator);
    return varName;
}

function ruleToCondition(rule: StrategyRule, unsupported: string[], declared: Set<string>, lines: string[]): string | null {
    // ── Legacy cross / oscillator rules ──
    if (rule.indicator === "ema_cross") {
        if (rule.operator === "eq" || rule.operator === "gt") {
            const above = rule.value === "ema20_above_ema50";
            return above ? "crossesAbove(fast, slow)" : "crossesBelow(fast, slow)";
        }
        unsupported.push(`rule ${rule.id}: ema_cross operator ${rule.operator} not expressible in AVS`);
        return null;
    }
    if (rule.indicator === "rsi") {
        const v = rule.value;
        if (rule.operator === "lt") return `rsiValue < ${v}`;
        if (rule.operator === "gt") return `rsiValue > ${v}`;
        unsupported.push(`rule ${rule.id}: rsi operator ${rule.operator} not expressible in AVS`);
        return null;
    }
    if (rule.indicator === "close_vs_ema20") {
        if (rule.operator === "eq") {
            return rule.value === "above" ? "close >= ema20" : "close <= ema20";
        }
        unsupported.push(`rule ${rule.id}: close_vs_ema20 operator ${rule.operator} not expressible in AVS`);
        return null;
    }
    if (rule.indicator === "atr") {
        unsupported.push(`rule ${rule.id}: atr indicator not expressible in AVS`);
        return null;
    }

    // ── Library indicator keys (ema_N, sma_N, rsi_N, wma_N) ──
    if (rule.group === "indicator" && rule.indicator && isIndicatorKey(rule.indicator)) {
        const expr = declareIndicator(rule.indicator, declared, lines);
        if (!expr) {
            unsupported.push(`rule ${rule.id}: indicator ${rule.indicator} not expressible in AVS`);
            return null;
        }
        const compareTo = rule.compareTo ? declareIndicator(rule.compareTo, declared, lines) : null;
        const rhs = compareTo ?? String(rule.value);
        const opMap: Record<string, string> = {
            gt: ">",
            lt: "<",
            gte: ">=",
            lte: "<=",
            eq: "==",
            crosses_above: "crossesAbove",
            crosses_below: "crossesBelow",
        };
        const op = opMap[rule.operator] ?? rule.operator;
        if (rule.operator === "crosses_above" || rule.operator === "crosses_below") {
            return `${op}(${expr}, ${rhs})`;
        }
        return `${expr} ${op} ${rhs}`;
    }

    // ── Engine node groups ──
    if (rule.group === "trend") {
        unsupported.push(`rule ${rule.id}: trend group "${rule.value}" not expressible in AVS`);
        return null;
    }
    if (rule.group === "structure") {
        unsupported.push(`rule ${rule.id}: structure group "${rule.value}" not expressible in AVS`);
        return null;
    }
    if (rule.group === "liquidity") {
        unsupported.push(`rule ${rule.id}: liquidity group "${rule.value}" not expressible in AVS`);
        return null;
    }
    if (rule.group === "fvg") {
        unsupported.push(`rule ${rule.id}: fvg group "${rule.value}" not expressible in AVS`);
        return null;
    }
    if (rule.group === "order_block") {
        unsupported.push(`rule ${rule.id}: order_block group "${rule.value}" not expressible in AVS`);
        return null;
    }
    if (rule.group === "session") {
        unsupported.push(`rule ${rule.id}: session group "${rule.value}" not expressible in AVS`);
        return null;
    }
    if (rule.group === "confirmation") {
        unsupported.push(`rule ${rule.id}: confirmation group "${rule.value}" not expressible in AVS`);
        return null;
    }
    if (rule.group === "volatility") {
        unsupported.push(`rule ${rule.id}: volatility group "${rule.value}" not expressible in AVS`);
        return null;
    }
    if (rule.group === "price_action") {
        unsupported.push(`rule ${rule.id}: price_action group not expressible in AVS`);
        return null;
    }
    if (rule.group === "custom") {
        unsupported.push(`rule ${rule.id}: custom group not expressible in AVS`);
        return null;
    }

    unsupported.push(`rule ${rule.id}: unsupported group/indicator`);
    return null;
}

export function strategyToAvScript(strategy: Strategy): StrategyToAvScriptResult {
    const unsupported: string[] = [];
    const diagnostics: string[] = [];
    const declared: Set<string> = new Set();

    const direction = strategy.direction === "long" ? "long" : "short";
    const entryFn = strategy.direction === "long" ? "enterLong" : "enterShort";

    const lines: string[] = [];
    lines.push(`strategy({`);
    lines.push(`    name: "${strategy.name.replace(/"/g, '\\"')}",`);
    lines.push(`    symbol: "${strategy.asset}",`);
    lines.push(`    timeframe: "${strategy.timeframes.entry}",`);
    lines.push(`    direction: "${direction}",`);
    if (strategy.description) {
        lines.push(`    description: "${strategy.description.replace(/"/g, '\\"')}"`);
    }
    lines.push(`});`);
    lines.push("");
    lines.push("// 1. Indicators");
    lines.push("const fast = indicators.ema(close, 20);");
    lines.push("const slow = indicators.ema(close, 50);");
    if (strategy.entryRules.some((r) => r.indicator === "rsi")) {
        lines.push("const rsiValue = indicators.rsi(close, 14);");
    }
    lines.push("");
    lines.push("// 2. Conditions & Entry Rules");

    const conditions: string[] = [];
    for (const rule of strategy.entryRules) {
        if (!rule.enabled) continue;
        const cond = ruleToCondition(rule, unsupported, declared, lines);
        if (cond) conditions.push(cond);
    }
    for (const c of conditions) lines.push(c + ";");

    lines.push("");
    lines.push("// 3. Execution & Risk Parameters");
    lines.push(`${entryFn}({`);
    lines.push(`    riskPercent: ${strategy.risk.riskPercent},`);
    lines.push(`    ${slToAvs(strategy.stopLoss)},`);
    lines.push(`    ${tpToAvs(strategy.takeProfit)}`);
    lines.push(`});`);

    if (unsupported.length > 0) {
        diagnostics.push(`${unsupported.length} construct(s) could not be expressed in AVS.`);
    }

    return {
        ok: unsupported.length === 0,
        source: lines.join("\n"),
        unsupported,
        diagnostics,
    };
}
