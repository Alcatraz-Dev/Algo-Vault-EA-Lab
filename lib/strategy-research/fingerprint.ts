// ─────────────────────────────────────────────────────────────────────────────
// Structural strategy fingerprint — deduplication.
//
// Two compiled strategies that share a fingerprint are substantially identical
// (same market, timeframe hierarchy, entry/confirmation primitives, filters,
// exits and risk model). The engine links them instead of running duplicate
// research, and surfaces the relationship through the Knowledge Graph
// (STRATEGY_SIMILAR_TO).
//
// The fingerprint is deterministic: labels, ids and free-text are excluded so
// cosmetic differences never hide structural duplicates.
// ─────────────────────────────────────────────────────────────────────────────

import type { Strategy, StrategyRule } from "@/lib/strategy-lab/types";

/** FNV-1a 32-bit → base64url. Deterministic across processes (no Math.random). */
export function stableHash(input: string): string {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    // Second pass over the reversed length distribution to reduce collisions.
    let h2 = 0x811c9dc5;
    for (let i = input.length - 1; i >= 0; i--) {
        h2 ^= input.charCodeAt(i);
        h2 = Math.imul(h2, 16777619);
    }
    const a = (h >>> 0).toString(36);
    const b = (h2 >>> 0).toString(36);
    return `${a}${b}`;
}

function canonicalRule(rule: StrategyRule): string {
    const value = Array.isArray(rule.value)
        ? [...rule.value].map(String).sort().join("|")
        : String(rule.value);
    return [
        rule.group,
        rule.operator,
        value,
        rule.timeframe ?? "-",
        rule.negate ? "!" : "",
        rule.groupLogic ?? "AND",
        rule.enabled === false ? "off" : "on",
    ].join("~");
}

/**
 * Canonical structural representation of a compiled strategy. Excludes name,
 * description, whyp text, ids and timestamps — only testable structure counts.
 */
export function canonicalStrategyStructure(strategy: Strategy): string {
    const entries = (strategy.entryRules ?? []).map(canonicalRule).sort();
    const confirmations = (strategy.confirmationRules ?? []).map(canonicalRule).sort();
    const regimes = [...(strategy.regimeFilter ?? [])].map(String).sort();
    const sessions = [...(strategy.filters?.sessions ?? [])].map(String).sort();
    const tf = strategy.timeframes;
    return [
        `asset=${strategy.asset}`,
        `dir=${strategy.direction}`,
        `tf=${tf.macro}/${tf.structure}/${tf.setup}/${tf.entry}`,
        `exec=${strategy.executionModel}`,
        `entry=[${entries.join(";")}]`,
        `confirm=[${confirmations.join(";")}]`,
        `sl=${strategy.stopLoss.mode}:${strategy.stopLoss.atrMultiple}:${strategy.stopLoss.levelOffset}`,
        `tp=${strategy.takeProfit.mode}:${strategy.takeProfit.r1}:${strategy.takeProfit.r2}:${strategy.takeProfit.r3}:${strategy.takeProfit.trailingEnabled ? "trail" : "-"}`,
        `risk=${strategy.risk.mode}:${strategy.risk.riskPercent}:${strategy.risk.maxPositions}:${strategy.risk.dailyLossLimitPct}:${strategy.risk.maxDrawdownPct}`,
        `filters=sessions[${sessions.join(",")}]:maxPerDay=${strategy.filters.maxTradesPerDay}:cooldown=${strategy.filters.cooldownCandles}`,
        `regimes=[${regimes.join(",")}]`,
    ].join("|");
}

/** Deterministic structural fingerprint of a compiled strategy. */
export function strategyFingerprint(strategy: Strategy): string {
    return `fp_${stableHash(canonicalStrategyStructure(strategy))}`;
}

/** True when two strategies are structurally identical (same fingerprint). */
export function isStructurallyIdentical(a: Strategy, b: Strategy): boolean {
    return strategyFingerprint(a) === strategyFingerprint(b);
}
