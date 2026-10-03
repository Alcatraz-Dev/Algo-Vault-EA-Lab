// ─────────────────────────────────────────────────────────────────────────────
// Hypothesis generation.
//
// AI output is an UNTRUSTED structured proposal: the model may only fill a
// fixed JSON scaffold whose vocabulary is the existing Strategy Lab rule
// groups (trend | liquidity | structure | fvg | order_block | session |
// volatility | price_action | confirmation). Nothing here is executable and
// the compiler re-validates every field before a Strategy is created.
// A deterministic local generator produces the same scaffold when the AI is
// unavailable, so research never depends on a provider being up.
// ─────────────────────────────────────────────────────────────────────────────

import { ai } from "@/lib/ai/client";
import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import {
    ResearchConcept,
    ResearchMissionSpec,
    ResearchSession,
    StrategyHypothesis,
} from "./types";
import { newResearchId } from "./storage";

// ── Deterministic concept → rule templates (existing rule groups only) ───────

type RawRule = {
    group: string;
    operator: string;
    value: string | number | string[];
    timeframe?: Timeframe;
    label?: string;
    negate?: boolean;
    groupLogic?: "AND" | "OR";
};

type RawDraft = {
    name: string;
    description?: string;
    direction: "long" | "short";
    entryRules: RawRule[];
    confirmationRules?: RawRule[];
    stopLoss?: { mode: "atr" | "level"; atrMultiple?: number; levelOffset?: number };
    takeProfit?: { mode: "r" | "fixed"; r1?: number; r2?: number; r3?: number; trailingEnabled?: boolean; trailingStopAtr?: number };
    risk?: { mode: "percent" | "fixed_lot"; riskPercent?: number; maxPositions?: number; dailyLossLimitPct?: number; maxDrawdownPct?: number };
    filters?: {
        sessions?: ResearchSession[];
        volatilityMinAtrPct?: number;
        volatilityMaxAtrPct?: number;
        maxTradesPerDay?: number;
        cooldownCandles?: number;
    };
    regimeFilter?: string[];
    executionModel?: "next_bar_open" | "same_bar_close";
};

const STYLE_REGIMES: Record<ResearchMissionSpec["tradingStyle"], string[]> = {
    scalping: ["ranging", "breakout", "high_volatility"],
    intraday: ["trending_bullish", "trending_bearish", "breakout"],
    swing: ["trending_bullish", "trending_bearish", "ranging"],
};

function conceptRules(concept: ResearchConcept, tf: Timeframe, direction: "long" | "short"): RawRule[] {
    const bull = direction === "long";
    switch (concept) {
        case "smart_money":
            return [
                { group: "structure", operator: "eq", value: bull ? "bos_bullish" : "bos_bearish", timeframe: tf, label: bull ? "BOS bullish" : "BOS bearish" },
                { group: "liquidity", operator: "eq", value: bull ? "sell_side" : "buy_side", timeframe: tf, label: bull ? "Sell-side sweep" : "Buy-side sweep" },
            ];
        case "liquidity":
            return [
                { group: "liquidity", operator: "eq", value: bull ? "sell_side" : "buy_side", timeframe: tf, label: "Liquidity sweep present" },
            ];
        case "fvg":
            return [
                { group: "fvg", operator: "eq", value: bull ? "bullish" : "bearish", timeframe: tf, label: bull ? "Bullish FVG" : "Bearish FVG" },
            ];
        case "order_blocks":
            return [
                { group: "order_block", operator: "eq", value: bull ? "bullish" : "bearish", timeframe: tf, label: bull ? "Bullish OB" : "Bearish OB" },
            ];
        case "vwap":
            return [
                { group: "confirmation", operator: "eq", value: bull ? "close_above_ema" : "close_below_ema", timeframe: tf, label: "VWAP-side confirmation (EMA proxy)" },
            ];
        case "atr":
            return [
                { group: "volatility", operator: "eq", value: "normal", timeframe: tf, label: "ATR in normal band" },
            ];
        case "structure":
            return [
                { group: "structure", operator: "eq", value: bull ? "hh" : "ll", timeframe: tf, label: bull ? "Higher high" : "Lower low" },
                { group: "structure", operator: "eq", value: bull ? "hl" : "lh", timeframe: tf, label: bull ? "Higher low" : "Lower high" },
            ];
        case "sessions":
            return [
                { group: "session", operator: "in", value: ["london", "new_york", "overlap"], timeframe: tf, label: "Active sessions" },
            ];
        case "momentum":
            return [
                { group: "confirmation", operator: "eq", value: bull ? "momentum_positive" : "momentum_negative", timeframe: tf, label: "Momentum aligned" },
            ];
        case "mean_reversion":
            return [
                { group: "trend", operator: "eq", value: "ranging", timeframe: tf, label: "Ranging regime" },
                { group: "confirmation", operator: "eq", value: bull ? "close_below_ema" : "close_above_ema", timeframe: tf, label: "Stretched from mean", negate: false },
            ];
        default:
            return [];
    }
}

/**
 * Deterministic local hypothesis — one per concept per direction, combined
 * into per-concept candidates. No AI, fully reproducible.
 */
export function buildLocalHypotheses(spec: ResearchMissionSpec, market: SupportedSymbol): RawDraft[] {
    const drafts: RawDraft[] = [];
    const directions: Array<"long" | "short"> =
        spec.direction === "both" ? ["long", "short"] : [spec.direction];
    const setupTf = spec.timeframes[0];

    for (const concept of spec.concepts) {
        for (const direction of directions) {
            const rules = conceptRules(concept, setupTf, direction);
            if (rules.length === 0) continue;
            drafts.push({
                name: `${market} ${concept} ${direction}`,
                description: `Deterministic ${spec.tradingStyle} hypothesis built from the "${concept}" concept on ${market} ${setupTf}.`,
                direction,
                entryRules: rules.slice(0, 4),
                confirmationRules: concept === "smart_money" ? conceptRules("structure", setupTf, direction).slice(0, 1) : [],
                stopLoss: { mode: "atr", atrMultiple: spec.riskProfile === "conservative" ? 2 : 1.5 },
                takeProfit: { mode: "r", r1: 1, r2: 2, r3: 3 },
                risk: {
                    mode: "percent",
                    riskPercent: spec.riskProfile === "conservative" ? 0.5 : spec.riskProfile === "aggressive" ? 1.5 : 1,
                    maxPositions: 1,
                    dailyLossLimitPct: spec.riskProfile === "conservative" ? 2 : 4,
                    maxDrawdownPct: 20,
                },
                filters: {
                    sessions: spec.sessions,
                    maxTradesPerDay: spec.tradingStyle === "scalping" ? 4 : 2,
                    cooldownCandles: 3,
                },
                regimeFilter: STYLE_REGIMES[spec.tradingStyle],
                executionModel: "next_bar_open",
            });
        }
    }
    return drafts;
}

// ── AI proposals (untrusted scaffold) ────────────────────────────────────────

const SCHEMA_DESCRIPTION = [
    "Array of strategy hypotheses. Each hypothesis:",
    '{ "name": string, "description": string, "direction": "long"|"short",',
    '  "entryRules": [ { "group": "trend"|"liquidity"|"structure"|"fvg"|"order_block"|"session"|"volatility"|"price_action"|"confirmation", "operator": "eq"|"neq"|"gte"|"lte"|"gt"|"lt"|"in"|"contains"|"not_in", "value": string|number|string[], "timeframe": string, "label": string } ],',
    '  "confirmationRules": [same shape],',
    '  "stopLoss": { "mode": "atr"|"level", "atrMultiple"?: number, "levelOffset"?: number },',
    '  "takeProfit": { "mode": "r"|"fixed", "r1"?: number, "r2"?: number, "r3"?: number },',
    '  "risk": { "riskPercent"?: number, "maxPositions"?: number, "dailyLossLimitPct"?: number, "maxDrawdownPct"?: number },',
    '  "filters": { "sessions"?: string[], "volatilityMinAtrPct"?: number, "volatilityMaxAtrPct"?: number, "maxTradesPerDay"?: number, "cooldownCandles"?: number },',
    '  "regimeFilter"?: string[], "executionModel"?: "next_bar_open"|"same_bar_close" }',
    "Use ONLY the listed rule groups/operators. Do not invent conditions, indicators or code.",
].join("\n");

function aiPrompt(spec: ResearchMissionSpec, market: SupportedSymbol): { system: string; user: string } {
    const system = [
        "You are a quantitative research hypothesis generator inside AlgoVault.",
        "You NEVER write code, indicators, MQL5, or arbitrary logic. You fill ONLY the strict JSON scaffold provided.",
        "Every field you emit is re-validated by a deterministic compiler; unsupported features are rejected.",
        "Produce diverse, testable hypotheses (entry/confirmation/filter/exit variations) within the scaffold.",
        "Reply with ONLY the JSON array.",
    ].join("\n");
    const user = [
        `Research mission:`,
        `- Market: ${market}`,
        `- Timeframes: ${spec.timeframes.join(", ")}`,
        `- Style: ${spec.tradingStyle}`,
        `- Concepts: ${spec.concepts.join(", ")}`,
        `- Sessions: ${spec.sessions.join(", ")}`,
        `- Direction: ${spec.direction}`,
        `- Risk profile: ${spec.riskProfile}`,
        `- Max hypotheses: ${spec.maxCandidates}`,
        SCHEMA_DESCRIPTION,
    ].join("\n");
    return { system, user };
}

function rawHypothesisToDraft(raw: unknown, market: SupportedSymbol, fallbackDirection: "long" | "short"): RawDraft | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const entryRules = Array.isArray(r.entryRules) ? r.entryRules : [];
    if (entryRules.length === 0) return null;
    const direction = r.direction === "short" ? "short" : r.direction === "long" ? "long" : fallbackDirection;
    return {
        name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 80) : `${market} AI hypothesis`,
        description: typeof r.description === "string" ? r.description.slice(0, 400) : "",
        direction,
        entryRules: entryRules as RawRule[],
        confirmationRules: (Array.isArray(r.confirmationRules) ? r.confirmationRules : []) as RawRule[],
        stopLoss: (typeof r.stopLoss === "object" && r.stopLoss !== null ? r.stopLoss : undefined) as RawDraft["stopLoss"],
        takeProfit: (typeof r.takeProfit === "object" && r.takeProfit !== null ? r.takeProfit : undefined) as RawDraft["takeProfit"],
        risk: (typeof r.risk === "object" && r.risk !== null ? r.risk : undefined) as RawDraft["risk"],
        filters: (typeof r.filters === "object" && r.filters !== null ? r.filters : undefined) as RawDraft["filters"],
        regimeFilter: Array.isArray(r.regimeFilter) ? (r.regimeFilter as string[]) : [],
        executionModel: r.executionModel === "same_bar_close" ? "same_bar_close" : "next_bar_open",
    };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface GeneratedHypotheses {
    hypotheses: StrategyHypothesis[];
    source: "ai" | "local" | "mixed";
    /** True when an AI request was actually attempted (for honest budget accounting). */
    aiUsed: boolean;
    aiError?: string;
}

/**
 * Generates up to `spec.maxCandidates` hypotheses for one market: AI proposals
 * (untrusted scaffold, sanitized shape-only) blended with deterministic local
 * hypotheses. The compiler remains the sole gatekeeper for validity.
 *
 * `useAI=false` (AI budget exhausted or forced) runs the deterministic local
 * generator only — research never depends on a provider being up, and the
 * engine never claims AI ran when it did not.
 */
export async function generateHypotheses(
    spec: ResearchMissionSpec,
    missionId: string,
    market: SupportedSymbol,
    requested: number,
    options?: { useAI?: boolean }
): Promise<GeneratedHypotheses> {
    const directions: Array<"long" | "short"> =
        spec.direction === "both" ? ["long", "short"] : [spec.direction];
    const hypotheses: StrategyHypothesis[] = [];
    let aiCount = 0;
    let aiUsed = false;
    let aiError: string | undefined;

    if (options?.useAI !== false) {
        aiUsed = true;
        try {
            const { system, user } = aiPrompt(spec, market);
            const proposals = await ai.generateStructured<unknown[]>(user, SCHEMA_DESCRIPTION, system);
            if (Array.isArray(proposals)) {
                for (const raw of proposals.slice(0, requested)) {
                    const draft = rawHypothesisToDraft(raw, market, directions[0]);
                    if (!draft) continue;
                    hypotheses.push(makeHypothesis(missionId, market, spec, draft, "ai"));
                    aiCount += 1;
                }
            }
        } catch (err) {
            aiError = err instanceof Error ? err.message : String(err);
        }
    }

    if (hypotheses.length < requested) {
        const local = buildLocalHypotheses(spec, market);
        for (const draft of local) {
            if (hypotheses.length >= requested) break;
            hypotheses.push(makeHypothesis(missionId, market, spec, draft, "local"));
        }
    }

    const source: GeneratedHypotheses["source"] =
        !aiUsed ? "local" : aiCount === 0 ? "local" : aiCount === hypotheses.length ? "ai" : "mixed";
    return { hypotheses: hypotheses.slice(0, requested), source, aiUsed, aiError };
}

function makeHypothesis(
    missionId: string,
    market: SupportedSymbol,
    spec: ResearchMissionSpec,
    draft: RawDraft,
    source: "ai" | "local"
): StrategyHypothesis {
    return {
        id: newResearchId("hyp"),
        missionId,
        market,
        timeframes: [...spec.timeframes],
        direction: draft.direction,
        rationale: draft.description ?? "",
        concepts: [...spec.concepts],
        draft: draft as unknown as Record<string, unknown>,
        source,
        createdAt: Date.now(),
    };
}
