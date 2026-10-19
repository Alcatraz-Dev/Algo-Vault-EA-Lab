/**
 * Bot Studio — Strategy → AvScript reverse generator.
 *
 * Produces deterministic AVS source from a canonical `Strategy` for the
 * supported subset. Unsupported constructs are reported via the returned
 * `unsupported` list instead of being silently dropped.
 */

import type { Strategy, StrategyRule } from "@/lib/strategy-lab/types";

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

function ruleToCondition(rule: StrategyRule, unsupported: string[]): string | null {
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
    if (rule.indicator === "close_vs_ema20" || rule.indicator === "atr") {
        unsupported.push(`rule ${rule.id}: indicator ${rule.indicator} not expressible in AVS`);
        return null;
    }
    if (rule.group === "price_action") {
        unsupported.push(`rule ${rule.id}: price_action group not expressible in AVS`);
        return null;
    }
    unsupported.push(`rule ${rule.id}: unsupported group/indicator`);
    return null;
}

export function strategyToAvScript(strategy: Strategy): StrategyToAvScriptResult {
    const unsupported: string[] = [];
    const diagnostics: string[] = [];

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
        const cond = ruleToCondition(rule, unsupported);
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
