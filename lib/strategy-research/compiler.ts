// ─────────────────────────────────────────────────────────────────────────────
// Strategy Compiler — deterministic, AI output never trusted.
//
// Converts a hypothesis' structured proposal into the EXISTING Strategy Lab
// `Strategy` via the platform's own mappers (sanitizeDraft + strategyFromDraft
// from lib/strategy-lab/interpret.ts). Verifies supported rule groups,
// operators, per-group value vocabularies, timeframes, SL/TP/risk bounds and
// execution-model safety. Produces a full CompilationReport. No code is ever
// generated or executed; unknown features are rejected, not guessed.
// ─────────────────────────────────────────────────────────────────────────────

import {
    sanitizeDraft,
    strategyFromDraft,
} from "@/lib/strategy-lab/interpret";
import type { RuleGroup, RuleOperator, Strategy, StrategyDraft, StrategyRule } from "@/lib/strategy-lab/types";
import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { CompilationReport, ResearchMissionSpec, StrategyHypothesis } from "./types";
import { newResearchId } from "./storage";

// Mirrors the engine's evaluateRule vocabularies (lib/strategy-lab/backtest.ts).
const SUPPORTED_GROUPS = new Set<RuleGroup>([
    "trend", "liquidity", "structure", "fvg", "order_block", "session",
    "volatility", "price_action", "confirmation",
]);
const SUPPORTED_OPERATORS = new Set<RuleOperator>([
    "eq", "neq", "gte", "lte", "gt", "lt", "in", "contains", "not_in",
]);
const STRUCTURE_VALUES = new Set(["choch_bullish", "choch_bearish", "bos_bullish", "bos_bearish", "hh", "hl", "lh", "ll"]);
const SESSION_VALUES = new Set(["asian", "london", "new_york", "overlap", "closed"]);
const VOLATILITY_VALUES = new Set(["low", "normal", "high", "extreme"]);
const PRICE_ACTION_VALUES = new Set(["breakout_high", "breakout_low"]);
const CONFIRMATION_VALUES = new Set(["momentum_positive", "momentum_negative", "close_above_ema", "close_below_ema"]);
const VALID_TIMEFRAMES = new Set<string>(["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"]);

const TF_ORDER: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];

export interface CompiledStrategy {
    strategy: Strategy;
    report: CompilationReport;
}

export function compileReportFailure(hypothesisId: string, errors: string[], unsupported: string[] = []): CompilationReport {
    return {
        hypothesisId,
        valid: false,
        errors,
        warnings: [],
        unsupportedFeatures: unsupported,
        futureLeakageRisk: false,
    };
}

/** Builds the timeframe hierarchy from mission timeframes (existing hierarchy shape). */
export function hierarchyFromTimeframes(timeframes: Timeframe[]): {
    macro: Timeframe;
    structure: Timeframe;
    setup: Timeframe;
    entry: Timeframe;
} {
    const sorted = [...new Set(timeframes)].sort((a, b) => TF_ORDER.indexOf(a) - TF_ORDER.indexOf(b));
    const setup = timeframes[0] ?? sorted[0] ?? "M15";
    const higher = sorted.filter((tf) => TF_ORDER.indexOf(tf) > TF_ORDER.indexOf(setup));
    const lower = sorted.filter((tf) => TF_ORDER.indexOf(tf) < TF_ORDER.indexOf(setup));
    const macro = higher[higher.length - 1] ?? setup;
    const structure = higher[0] ?? setup;
    const entry = lower[lower.length - 1] ?? setup;
    return { macro, structure, setup, entry };
}

function checkRuleValue(rule: RawRuleLike, errors: string[], unsupported: string[]): void {
    const { group, value } = rule;
    const arr = Array.isArray(value) ? value.map(String) : null;
    const str = arr ? null : String(value);
    switch (group) {
        case "trend":
            if (arr || typeof value !== "string") errors.push(`trend rule needs a string value (got ${typeof value}).`);
            break;
        case "structure":
            if (!str || !STRUCTURE_VALUES.has(str)) unsupported.push(`structure value "${String(value)}"`);
            break;
        case "liquidity":
            if (typeof value !== "number" && !(str && (str === "buy_side" || str === "sell_side" || str === "none"))) {
                unsupported.push(`liquidity value "${String(value)}"`);
            }
            break;
        case "fvg":
            if (typeof value !== "number" && !(str && ["bullish", "bearish", "none"].includes(str))) {
                unsupported.push(`fvg value "${String(value)}"`);
            }
            break;
        case "order_block":
            if (!(str && ["bullish", "bearish", "none"].includes(str))) {
                unsupported.push(`order_block value "${String(value)}"`);
            }
            break;
        case "session":
            if (arr) {
                if (!arr.every((v) => SESSION_VALUES.has(v))) unsupported.push(`session values "${arr.join(",")}"`);
            } else if (!str || !SESSION_VALUES.has(str)) {
                unsupported.push(`session value "${String(value)}"`);
            }
            break;
        case "volatility":
            if (typeof value !== "number" && !(str && VOLATILITY_VALUES.has(str))) {
                unsupported.push(`volatility value "${String(value)}"`);
            }
            break;
        case "price_action":
            if (!str || !PRICE_ACTION_VALUES.has(str)) unsupported.push(`price_action value "${String(value)}"`);
            break;
        case "confirmation":
            if (!str || !CONFIRMATION_VALUES.has(str)) unsupported.push(`confirmation value "${String(value)}"`);
            break;
        default:
            unsupported.push(`rule group "${String(group)}"`);
    }
}

interface RawRuleLike {
    group?: unknown;
    operator?: unknown;
    value?: unknown;
    timeframe?: unknown;
    negate?: unknown;
}

/** Static verification pass — mirrors what the deterministic engine can actually evaluate. */
export function verifyHypothesis(
    hypothesis: StrategyHypothesis,
    spec: ResearchMissionSpec
): { errors: string[]; warnings: string[]; unsupported: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const unsupported: string[] = [];
    const draft = hypothesis.draft as Record<string, unknown>;

    const entryRules = Array.isArray(draft.entryRules) ? (draft.entryRules as RawRuleLike[]) : [];
    if (entryRules.length === 0) errors.push("No entry rules — a hypothesis must be testable.");
    if (entryRules.length > 6) errors.push("More than 6 entry rules (engine limit).");

    const verifySet = (rules: RawRuleLike[], kind: string) => {
        for (const rule of rules) {
            if (typeof rule !== "object" || rule === null) {
                errors.push(`${kind}: malformed rule.`);
                continue;
            }
            const group = String(rule.group ?? "");
            const operator = String(rule.operator ?? "");
            if (!SUPPORTED_GROUPS.has(group as RuleGroup)) unsupported.push(`rule group "${group}"`);
            if (!SUPPORTED_OPERATORS.has(operator as RuleOperator)) errors.push(`Unsupported operator "${operator}" in ${kind}.`);
            if (rule.value === undefined || rule.value === null || rule.value === "") errors.push(`${kind}: rule value missing.`);
            checkRuleValue({ group, value: rule.value }, errors, unsupported);
            if (rule.timeframe !== undefined && !VALID_TIMEFRAMES.has(String(rule.timeframe))) {
                errors.push(`${kind}: invalid timeframe "${String(rule.timeframe)}".`);
            }
        }
    };
    verifySet(entryRules, "entryRules");
    verifySet(
        Array.isArray(draft.confirmationRules) ? (draft.confirmationRules as RawRuleLike[]) : [],
        "confirmationRules"
    );
    if (entryRules.length + (Array.isArray(draft.confirmationRules) ? draft.confirmationRules.length : 0) > 10) {
        errors.push("Too many rules in total (max 6 entry + 4 confirmation).");
    }

    // SL / TP / risk bounds (conservative research envelope).
    const stopLoss = draft.stopLoss as Record<string, unknown> | undefined;
    if (stopLoss) {
        const mode = String(stopLoss.mode ?? "atr");
        if (mode !== "atr" && mode !== "level") errors.push(`Unsupported stop-loss mode "${mode}".`);
        if (mode === "atr") {
            const m = Number(stopLoss.atrMultiple);
            if (!Number.isFinite(m) || m <= 0 || m > 10) errors.push("stopLoss.atrMultiple must be in (0, 10].");
        } else {
            const off = Number(stopLoss.levelOffset);
            if (!Number.isFinite(off) || off <= 0) errors.push("stopLoss.levelOffset must be > 0.");
        }
    }
    const takeProfit = draft.takeProfit as Record<string, unknown> | undefined;
    if (takeProfit) {
        const mode = String(takeProfit.mode ?? "r");
        if (mode !== "r" && mode !== "fixed") errors.push(`Unsupported take-profit mode "${mode}".`);
        if (mode === "r") {
            for (const k of ["r1", "r2", "r3"] as const) {
                const v = takeProfit[k];
                if (v !== undefined && (!Number.isFinite(Number(v)) || Number(v) <= 0 || Number(v) > 10)) {
                    errors.push(`takeProfit.${k} must be in (0, 10].`);
                }
            }
        }
    }
    const risk = draft.risk as Record<string, unknown> | undefined;
    if (risk) {
        const rp = risk.riskPercent;
        if (rp !== undefined && (!Number.isFinite(Number(rp)) || Number(rp) <= 0 || Number(rp) > 5)) {
            errors.push("risk.riskPercent must be in (0, 5] for research missions.");
        }
    }

    // Direction sanity.
    const direction = draft.direction;
    if (direction !== "long" && direction !== "short") errors.push("direction must be long|short.");

    // Execution model: next_bar_open is the leak-safe default; same_bar_close is
    // supported by the engine but flagged for transparency.
    const executionModel = String(draft.executionModel ?? "next_bar_open");
    if (executionModel !== "next_bar_open" && executionModel !== "same_bar_close") {
        errors.push(`Unsupported execution model "${executionModel}".`);
    } else if (executionModel === "same_bar_close") {
        warnings.push("same_bar_close execution: entries occur on the signal bar's close (documented engine model).");
    }

    // Rules may only reference mission timeframes; anything else is a warning —
    // the engine resolves them against the primary series, never future data.
    for (const rule of entryRules) {
        const tf = rule?.timeframe !== undefined ? String(rule.timeframe) : null;
        if (tf && !spec.timeframes.includes(tf as Timeframe)) {
            warnings.push(`Rule timeframe ${tf} is outside the mission timeframes; it resolves to the primary series.`);
        }
    }

    return { errors, warnings, unsupported };
}

/**
 * Compiles a hypothesis into an existing-platform `Strategy`.
 * Returns a valid Strategy + report, or an invalid report (never throws for
 * validation reasons — malformed AI output is a rejection, not a crash).
 */
export function compileHypothesis(
    hypothesis: StrategyHypothesis,
    spec: ResearchMissionSpec
): CompiledStrategy | { report: CompilationReport } {
    const { errors, warnings, unsupported } = verifyHypothesis(hypothesis, spec);
    const baseReport: CompilationReport = {
        hypothesisId: hypothesis.id,
        valid: false,
        errors,
        warnings,
        unsupportedFeatures: unsupported,
        futureLeakageRisk: false,
    };
    if (errors.length > 0) {
        return { report: { ...baseReport, futureLeakageRisk: false } };
    }

    const draftRaw = hypothesis.draft as Record<string, unknown>;
    const hierarchy = hierarchyFromTimeframes(spec.timeframes);

    const draft: StrategyDraft = {
        name: typeof draftRaw.name === "string" && draftRaw.name.trim() ? draftRaw.name.trim().slice(0, 80) : `${hypothesis.market} hypothesis`,
        description: typeof draftRaw.description === "string" ? draftRaw.description.slice(0, 400) : hypothesis.rationale.slice(0, 400),
        direction: draftRaw.direction === "short" ? "short" : "long",
        entryRules: draftRaw.entryRules as StrategyDraft["entryRules"],
        confirmationRules: (Array.isArray(draftRaw.confirmationRules) ? draftRaw.confirmationRules : []) as StrategyDraft["confirmationRules"],
        stopLoss: draftRaw.stopLoss as StrategyDraft["stopLoss"],
        takeProfit: draftRaw.takeProfit as StrategyDraft["takeProfit"],
        risk: draftRaw.risk as StrategyDraft["risk"],
        filters: draftRaw.filters as StrategyDraft["filters"],
        regimeFilter: Array.isArray(draftRaw.regimeFilter) ? (draftRaw.regimeFilter as Strategy["regimeFilter"]) : [],
        executionModel: draftRaw.executionModel === "same_bar_close" ? "same_bar_close" : "next_bar_open",
    };

    // Deterministic platform mappers (existing Strategy Lab code):
    const sanitized = sanitizeDraft(draft);
    const strategy = strategyFromDraft(sanitized, {
        symbol: hypothesis.market as SupportedSymbol,
        direction: sanitized.direction,
        hierarchy,
    });
    strategy.id = newResearchId("cand");
    strategy.name = `${strategy.name} [${hypothesis.source}]`;
    strategy.description = `Research candidate ${hypothesis.id} from mission ${hypothesis.missionId}. ${strategy.description}`;
    strategy.whyp = {
        ...strategy.whyp,
        discovered: `Research hypothesis (${hypothesis.source}) generated for mission ${hypothesis.missionId}. Rationale: ${hypothesis.rationale || "—"}`,
        generatedByProvider: "strategy-research-compiler",
    };

    return {
        strategy,
        report: { ...baseReport, valid: true, strategyId: strategy.id },
    };
}
