import { StrategyNarrative, StrategyNarrativeInput, AnalysisSummary } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Safety sanitizers for provider output.
//
// * Guarantees every required field is a non-empty string.
// * Strips phrases that imply guaranteed outcomes (required by product policy).
// * Clamps lengths so backends can't flood the database.
// * Appends the mandated risk disclaimer to the risks field.
// ─────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_PHRASES: Array<{ match: RegExp; replace: string }> = [
    { match: /\bguaranteed\s+profit\b/gi, replace: "historically profitable in backtests" },
    { match: /\bguaranteed\s+win\s+rate\b/gi, replace: "demonstrated win rate in backtests" },
    { match: /\brisk["-]?free\b/gi, replace: "lower-risk" },
    { match: /\bguaranteed\b/gi, replace: "expected" },
    { match: /\bcertain\s+strategy\b/gi, replace: "candidate strategy" },
    { match: /\b100%\s+win\b/gi, replace: "high win" },
];

export function sanitizeNarrativeText(value: unknown, fallback: string): string {
    let text = typeof value === "string" ? value.trim() : "";
    if (!text) return fallback;
    for (const rule of FORBIDDEN_PHRASES) {
        text = text.replace(rule.match, rule.replace);
    }
    if (text.length > 1200) text = text.slice(0, 1200);
    return text;
}

const RISK_DISCLAIMER =
    "Past performance does not guarantee future results. This narrative is generated from historical analysis only and is not financial advice.";

export function normalizeNarrative(raw: Partial<StrategyNarrative>, fallback: StrategyNarrative): StrategyNarrative {
    return {
        name: sanitizeNarrativeText(raw.name, fallback.name).slice(0, 120),
        description: sanitizeNarrativeText(raw.description, fallback.description),
        why: sanitizeNarrativeText(raw.why, fallback.why),
        risks: sanitizeNarrativeText(raw.risks, fallback.risks) + "\n\n" + RISK_DISCLAIMER,
        bestRegimes: sanitizeNarrativeText(raw.bestRegimes, fallback.bestRegimes),
        weakRegimes: sanitizeNarrativeText(raw.weakRegimes, fallback.weakRegimes),
        generatedBy: typeof raw.generatedBy === "string" && raw.generatedBy ? raw.generatedBy : fallback.generatedBy,
    };
}

export function normalizeSummary(raw: Partial<AnalysisSummary>, fallback: string): AnalysisSummary {
    return {
        summary: sanitizeNarrativeText(raw.summary, fallback) + "\n\n" + RISK_DISCLAIMER,
        generatedBy: typeof raw.generatedBy === "string" && raw.generatedBy ? raw.generatedBy : "local",
    };
}

// Provide a safe object-has-property check for untrusted provider JSON.
export function hasOwn(obj: unknown, key: string): boolean {
    return typeof obj === "object" && obj !== null && Object.prototype.hasOwnProperty.call(obj, key);
}

export function buildFallbackNarrative(input: StrategyNarrativeInput): StrategyNarrative {
    const stats = input.stats;
    const dirLabel = input.direction === "long" ? "Buy" : "Sell";
    const statsLine = stats.occurrences
        ? `Over ${stats.occurrences} historical occurrences this setup produced a ${stats.winRate?.toFixed(1)}% win rate with an average R of ${stats.averageR?.toFixed(2)}R and a max drawdown of ${stats.maxDrawdownPct?.toFixed(1)}%.`
        : "This setup has not yet accumulated enough historical occurrences to report meaningful statistics.";

    return {
        name: `${input.asset} ${dirLabel} — ${input.patternName}`,
        description: `${dirLabel} strategy for ${input.asset} built around ${input.patternName.toLowerCase()} on the ${input.timeframe} timeframe, scoped to the ${input.period} history.`,
        why: `${input.patternName} was selected because it is the most frequent and statistically positive pattern identified during market analysis. ${statsLine}`,
        risks: `The strategy depends on ${input.conditions.slice(0, 3).join(", ") || "its defined entry conditions"}. It can underperform in low-volatility, choppy sessions and during unexpected macro events.`,
        bestRegimes: `${input.regime}`,
        weakRegimes: "Choppy/ranging conditions with ATR contraction, and high-impact news windows.",
        generatedBy: "local-heuristic",
    };
}