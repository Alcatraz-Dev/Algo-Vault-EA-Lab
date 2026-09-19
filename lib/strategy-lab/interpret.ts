// ─────────────────────────────────────────────────────────────────────────────
// Strategy Lab — natural-language → structured strategy draft.
//
// The AI is ONLY allowed to fill the structured StrategyDraft scaffold
// (rules + configuration). Everything from the draft to a runnable Strategy is
// a deterministic mapping here — no AI generates MQL5, and no AI can inject
// executable code into the pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import { ai } from "@/lib/ai/client";
import {
    DEFAULT_HIERARCHY,
    RuleGroup,
    RuleOperator,
    Strategy,
    StrategyDraft,
    StrategyRule,
    TimeframeHierarchy,
} from "./types";
import { MarketRegime, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";

const VALID_RULE_GROUPS = new Set<RuleGroup>(["trend", "liquidity", "structure", "fvg", "order_block", "session", "volatility", "price_action", "confirmation"]);
const VALID_OPERATORS = new Set<RuleOperator>(["eq", "neq", "gte", "lte", "gt", "lt", "in", "contains", "not_in"]);
const VALID_REGIMES = new Set<MarketRegime>(["trending_bullish", "trending_bearish", "ranging", "breakout", "high_volatility", "low_volatility", "transitional"]);
const VALID_TIMEFRAMES = new Set<string>(["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"]);

export type InterpretOptions = {
    symbol: SupportedSymbol;
    direction?: "long" | "short";
    hierarchy?: Partial<TimeframeHierarchy>;
    periodLabel?: string;
    model?: string;
};

export type InterpretResult = {
    draft: StrategyDraft;
    generatedBy: "ai" | "local";
    provider?: string;
    model?: string;
};

function promptFor(input: string, opts: InterpretOptions): { system: string; user: string } {
    const hierarchy = { ...DEFAULT_HIERARCHY, ...(opts.hierarchy ?? {}) };
    const rulesDoc = [
        'Rule "group" must be one of: ' + [...VALID_RULE_GROUPS].join(" | "),
        'Rule "operator" must be one of: ' + [...VALID_OPERATORS].join(" | "),
        'Rule "value" must be a string, number, boolean, or string[] that makes sense for that group (e.g. trend: "EMA structure bullish", structure: "BOS"/"CHOCH"/"HH"/"HL"/"LH"/"LL", liquidity: "buy_side"|"sell_side", fvg: "bullish"|"bearish", order_block: "bullish"|"bearish", session: "london"|"new_york"|"asian"|"overlap", volatility: "low"|"normal"|"high"|"extreme", price_action: "breakout_high"|"breakout_low", confirmation: "momentum_positive"|"momentum_negative").',
        'Rule "timeframe" optional, one of: ' + [...VALID_TIMEFRAMES].join(" | "),
        'filters.sessions: array of "asian"|"london"|"new_york"|"overlap".',
        'filters.daysOfWeek: array of JS getDay() ints (0=Sunday..6=Saturday).',
        'regimeFilter: array of "' + [...VALID_REGIMES].join('" | "') + '".',
        "Keep takeProfit.mode \"r\" (R-multiples) or \"fixed\" with fixedDistance in price units.",
        "Max 6 entry rules. Every rule must map to a supported Strategy Lab concept — do NOT invent custom conditions.",
    ].join("\n");
    const system = [
        "You convert natural-language trading strategy descriptions into a strict structured JSON scaffold.",
        "You NEVER write code, indicators, or MQL5. You produce ONLY a JSON object matching this schema (StrategyDraft):",
        "{",
        '  "name": string, "description": string, "direction": "long"|"short",',
        '  "entryRules": [ { "group": string, "operator": string, "value": string|number|boolean|string[], "timeframe"?: string, "label"?: string, "negate"?: boolean, "groupLogic"?: "AND"|"OR" } ],',
        '  "confirmationRules": [], "stopLoss"?: { "mode": "atr"|"level", "atrMultiple"?: number, "levelOffset"?: number, "useSwing"?: boolean },',
        '  "takeProfit"?: { "mode": "r"|"fixed", "r1"?: number, "r2"?: number, "r3"?: number, "fixedDistance"?: number, "partialCloses"?: [{"atR": number,"closePercent": number}], "moveBeAfterTp1"?: boolean, "lockAfterTp2"?: boolean, "trailingEnabled"?: boolean, "trailingStopAtr"?: number },',
        '  "risk"?: { "mode": "percent"|"fixed_lot", "riskPercent"?: number, "fixedLot"?: number, "maxPositions"?: number, "dailyLossLimitPct"?: number, "maxDrawdownPct"?: number },',
        '  "filters"?: { "sessions"?: string[], "daysOfWeek"?: number[], "volatilityMinAtrPct"?: number, "volatilityMaxAtrPct"?: number, "maxTradesPerDay"?: number, "cooldownCandles"?: number },',
        '  "regimeFilter"?: string[], "executionModel"?: "next_bar_open"|"same_bar_close"',
        "}",
        rulesDoc,
        "Reply with ONLY the JSON object. No markdown fences.",
    ].join("\n");
    const user = [
        `Build a strategy draft for ${opts.symbol}`,
        `Direction: ${opts.direction ?? "long"}.`,
        `Default timeframe hierarchy: macro=${hierarchy.macro}, structure=${hierarchy.structure}, setup=${hierarchy.setup}, entry=${hierarchy.entry}.`,
        `User description: ${input}`,
    ].join("\n");
    return { system, user };
}

/** Validates + normalizes an AI draft into a safe StrategyDraft (never trusts AI wholesale). */
export function sanitizeDraft(raw: Partial<StrategyDraft>): StrategyDraft {
    const groupLogic: "AND" | "OR" = raw.entryRules?.[0]?.groupLogic === "OR" ? "OR" : "AND";

    const entryRules: StrategyRule[] = (raw.entryRules ?? [])
        .filter((r) => r && VALID_RULE_GROUPS.has(r.group) && VALID_OPERATORS.has(r.operator) && r.value !== undefined && r.value !== null && r.value !== "")
        .slice(0, 6)
        .map((r, i) => ({
            id: r.id ?? `rule_${i}`,
            enabled: r.enabled !== false,
            group: r.group,
            label: typeof r.label === "string" && r.label.trim() ? r.label : `${r.group}:${String(r.value)}`,
            operator: r.operator,
            timeframe: r.timeframe && VALID_TIMEFRAMES.has(r.timeframe) ? (r.timeframe as Timeframe) : undefined,
            value: r.value,
            negate: r.negate === true,
            groupLogic,
        }));

    const confirmationRules: StrategyRule[] = Array.isArray(raw.confirmationRules)
        ? raw.confirmationRules
              .filter((r) => r && VALID_RULE_GROUPS.has(r.group) && VALID_OPERATORS.has(r.operator) && r.value !== undefined && r.value !== null)
              .slice(0, 4)
              .map((r, i) => ({
                  ...r,
                  id: r.id ?? `confirm_${i}`,
                  timeframe: r.timeframe && VALID_TIMEFRAMES.has(r.timeframe) ? (r.timeframe as Timeframe) : undefined,
                  groupLogic: r.groupLogic === "OR" ? "OR" : "AND",
              }))
        : [];

    const regimes = Array.isArray(raw.regimeFilter)
        ? raw.regimeFilter.filter((r): r is MarketRegime => typeof r === "string" && VALID_REGIMES.has(r as MarketRegime))
        : [];

    const sessions = Array.isArray(raw.filters?.sessions)
        ? raw.filters.sessions.filter((s) => ["asian", "london", "new_york", "overlap"].includes(s)) as Strategy["filters"]["sessions"]
        : [];

    const daysOfWeek = Array.isArray(raw.filters?.daysOfWeek)
        ? raw.filters.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : [];

    return {
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "AI Strategy",
        description: typeof raw.description === "string" ? raw.description.trim() : "",
        direction: raw.direction === "short" ? "short" : "long",
        entryRules,
        confirmationRules,
        stopLoss: raw.stopLoss && typeof raw.stopLoss === "object" ? raw.stopLoss : undefined,
        takeProfit: raw.takeProfit && typeof raw.takeProfit === "object" ? raw.takeProfit : undefined,
        risk: raw.risk && typeof raw.risk === "object" ? raw.risk : undefined,
        filters: {
            sessions,
            daysOfWeek,
            volatilityMinAtrPct: typeof raw.filters?.volatilityMinAtrPct === "number" ? raw.filters.volatilityMinAtrPct : 0,
            volatilityMaxAtrPct: typeof raw.filters?.volatilityMaxAtrPct === "number" ? raw.filters.volatilityMaxAtrPct : 0,
            maxTradesPerDay: typeof raw.filters?.maxTradesPerDay === "number" ? raw.filters.maxTradesPerDay : 0,
            cooldownCandles: typeof raw.filters?.cooldownCandles === "number" ? raw.filters.cooldownCandles : 0,
        },
        regimeFilter: regimes,
        executionModel: raw.executionModel === "same_bar_close" ? "same_bar_close" : "next_bar_open",
    };
}

function newId(prefix: string): string {
    return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Deterministically maps a sanitized draft onto a full Strategy using the same
 * defaults the platform's generator uses (costs per symbol, standard risk, etc.).
 */
export function strategyFromDraft(draft: StrategyDraft, opts: InterpretOptions): Strategy {
    const hierarchy: TimeframeHierarchy = { ...DEFAULT_HIERARCHY, ...(opts.hierarchy ?? {}) };
    const symbol = opts.symbol;
    const spec = getSymbolSpec(symbol);
    const pipSize = spec?.pipSize ?? 0.01;
    const typicalSpreadPrice = spec?.typicalSpread ?? 0;
    const spreadPips = typicalSpreadPrice > 0 ? Number((typicalSpreadPrice / pipSize).toFixed(1)) : 10;
    const setupTf = hierarchy.setup;

    const now = Date.now();
    const entryRules: StrategyRule[] = draft.entryRules.map((r, i) => ({
        id: r.id ?? `rule_${i}`,
        enabled: r.enabled !== false,
        group: r.group,
        label: r.label ?? `${r.group}:${String(r.value)}`,
        operator: r.operator,
        timeframe: r.timeframe ?? setupTf,
        value: r.value,
        negate: r.negate === true,
        groupLogic: r.groupLogic === "OR" ? "OR" : "AND",
    }));

    const strategy: Strategy = {
        id: newId("strategy"),
        name: draft.name,
        description: draft.description ?? "",
        asset: symbol,
        direction: draft.direction,
        timeframes: hierarchy,
        regimeFilter: draft.regimeFilter ?? [],
        entryRules,
        confirmationRules: draft.confirmationRules ?? [],
        stopLoss: {
            mode: draft.stopLoss?.mode === "level" ? "level" : "atr",
            atrMultiple: typeof draft.stopLoss?.atrMultiple === "number" && draft.stopLoss.atrMultiple > 0 ? draft.stopLoss.atrMultiple : 1.5,
            levelOffset: typeof draft.stopLoss?.levelOffset === "number" ? draft.stopLoss.levelOffset : 0,
            useSwing: draft.stopLoss?.useSwing === true,
        },
        takeProfit: {
            mode: draft.takeProfit?.mode === "fixed" ? "fixed" : "r",
            r1: draft.takeProfit?.r1 ?? 1,
            r2: draft.takeProfit?.r2 ?? 2,
            r3: draft.takeProfit?.r3 ?? 3,
            fixedDistance: draft.takeProfit?.fixedDistance ?? 0,
            partialCloses: Array.isArray(draft.takeProfit?.partialCloses) && draft.takeProfit.partialCloses.length > 0
                ? draft.takeProfit.partialCloses.map((p) => ({ atR: p.atR, closePercent: p.closePercent })).slice(0, 2)
                : [
                      { atR: 1, closePercent: 33 },
                      { atR: 2, closePercent: 33 },
                  ],
            moveBeAfterTp1: draft.takeProfit?.moveBeAfterTp1 ?? true,
            lockAfterTp2: draft.takeProfit?.lockAfterTp2 ?? true,
            trailingEnabled: draft.takeProfit?.trailingEnabled === true,
            trailingStopAtr: typeof draft.takeProfit?.trailingStopAtr === "number" && draft.takeProfit.trailingStopAtr > 0 ? draft.takeProfit.trailingStopAtr : 1,
        },
        risk: {
            mode: draft.risk?.mode === "fixed_lot" ? "fixed_lot" : "percent",
            riskPercent: typeof draft.risk?.riskPercent === "number" && draft.risk.riskPercent > 0 ? draft.risk.riskPercent : 1,
            fixedLot: typeof draft.risk?.fixedLot === "number" && draft.risk.fixedLot > 0 ? draft.risk.fixedLot : 0.01,
            maxPositions: typeof draft.risk?.maxPositions === "number" && draft.risk.maxPositions > 0 ? draft.risk.maxPositions : 1,
            dailyLossLimitPct: typeof draft.risk?.dailyLossLimitPct === "number" ? draft.risk.dailyLossLimitPct : 3,
            maxDrawdownPct: typeof draft.risk?.maxDrawdownPct === "number" ? draft.risk.maxDrawdownPct : 20,
        },
        filters: {
            sessions: draft.filters?.sessions?.length ? draft.filters.sessions : ["london", "new_york", "overlap"],
            daysOfWeek: draft.filters?.daysOfWeek?.length ? draft.filters.daysOfWeek : [1, 2, 3, 4, 5],
            volatilityMinAtrPct: draft.filters?.volatilityMinAtrPct ?? 0,
            volatilityMaxAtrPct: draft.filters?.volatilityMaxAtrPct ?? 0,
            maxTradesPerDay: draft.filters?.maxTradesPerDay ?? 2,
            cooldownCandles: draft.filters?.cooldownCandles ?? 3,
        },
        executionModel: draft.executionModel ?? "next_bar_open",
        costs: { spreadPips, commissionPerLot: spec?.category === "indices" || spec?.category === "crypto" ? 2 : 4, slippagePips: 1 },
        sourcePatternId: null,
        whyp: {
            discovered: `Interpreted from your natural-language description: ${draft.description || "—"}`,
            conditionsSelected: entryRules.map((r) => r.label).join(", "),
            occurrenceFrequency: "",
            historicalPerformance: "",
            weaknesses: "",
            poorRegimes: "",
            generatedByProvider: "strategy-lab-interpret",
        },
        version: "1.0.0",
        created: now,
        updated: now,
    };
    return strategy;
}

/**
 * Natural-language → structured draft. AI fills only the structured scaffold;
 * sanitizeDraft() hard-validates every field it returns.
 */
export async function interpretToDraft(input: string, opts: InterpretOptions): Promise<InterpretResult> {
    const { system, user } = promptFor(input, opts);
    let raw: Partial<StrategyDraft> = {};
    let generatedBy: "ai" | "local" = "local";
    let provider: string | undefined;
    let model: string | undefined;
    try {
        const res = await ai.generateStructured<Partial<StrategyDraft>>(user, "StrategyDraft structured strategy scaffold (strict JSON).", system);
        if (res && typeof res === "object") {
            raw = res as Partial<StrategyDraft>;
            generatedBy = "ai";
        }
    } catch (err) {
        console.warn("[interpret] AI structured call failed, falling back to local heuristic draft:", err);
    }

    // Deterministic local fallback draft (never empty entryRules).
    if (!raw.entryRules || raw.entryRules.length === 0) {
        const direction = opts.direction ?? "long";
        raw = {
            name: `${opts.symbol} ${direction === "long" ? "Long" : "Short"} — Momentum Continuation`,
            description: input,
            direction,
            entryRules: [
                { group: "trend", operator: "eq", value: "EMA structure bullish", label: `EMA structure ${direction === "long" ? "bullish" : "bearish"}`, timeframe: opts.hierarchy?.macro ?? DEFAULT_HIERARCHY.macro },
                { group: "confirmation", operator: "eq", value: direction === "long" ? "momentum_positive" : "momentum_negative", label: "Momentum confirmation", timeframe: opts.hierarchy?.setup ?? DEFAULT_HIERARCHY.setup },
            ],
            regimeFilter: direction === "long" ? ["trending_bullish", "breakout", "high_volatility"] : ["trending_bearish", "breakout", "high_volatility"],
        };
    }

    const draft = sanitizeDraft(raw);
    return { draft, generatedBy, provider, model };
}