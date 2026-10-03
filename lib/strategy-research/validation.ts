// ─────────────────────────────────────────────────────────────────────────────
// Strict runtime validation of Research Missions.
//
// Mission parameters may originate from UI forms or AI suggestions — neither
// is trusted. Everything is whitelisted against the EXISTING platform
// vocabularies (SUPPORTED_SYMBOLS, Timeframe, Strategy Lab sessions/regimes)
// and bounded numerically. Invalid input never reaches the pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import { SUPPORTED_SYMBOLS, SupportedSymbol, Timeframe, TIMEFRAME_INTERVALS } from "@/lib/market-data/types";
import {
    MISSION_STAGES,
    MissionStage,
    RESEARCH_CONCEPTS,
    RESEARCH_PERIODS,
    RESEARCH_RISK_PROFILES,
    RESEARCH_SESSIONS,
    RESEARCH_TRADING_STYLES,
    ResearchBudget,
    ResearchMission,
    ResearchMissionSpec,
} from "./types";

export const MISSION_LIMITS = {
    maxMarkets: 3,
    minMarkets: 1,
    maxTimeframes: 4,
    minTimeframes: 1,
    maxConcepts: 6,
    minConcepts: 1,
    minCandidates: 1,
    maxCandidates: 24,
    maxNameLength: 80,
} as const;

/** Hard ceilings for per-mission research budgets (fail-safe upper bounds). */
export const BUDGET_LIMITS = {
    maxHypotheses: { min: 1, max: 96, def: 48 },
    maxBacktests: { min: 10, max: 1200, def: 400 },
    maxAIRequests: { min: 0, max: 50, def: 12 },
    maxDurationMs: { min: 60_000, max: 4 * 3_600_000, def: 45 * 60_000 },
} as const;

function clampBudget(raw: unknown): ResearchBudget {
    const b = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const num = (v: unknown, cfg: { min: number; max: number; def: number }) => {
        const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : cfg.def;
        return Math.max(cfg.min, Math.min(cfg.max, n));
    };
    return {
        maxHypotheses: num(b.maxHypotheses, BUDGET_LIMITS.maxHypotheses),
        maxBacktests: num(b.maxBacktests, BUDGET_LIMITS.maxBacktests),
        maxAIRequests: num(b.maxAIRequests, BUDGET_LIMITS.maxAIRequests),
        maxDurationMs: num(b.maxDurationMs, BUDGET_LIMITS.maxDurationMs),
    };
}

export interface MissionValidationResult {
    valid: boolean;
    errors: string[];
    normalized: ResearchMissionSpec | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function whitelist<T extends string>(values: unknown, allowed: readonly T[]): T[] {
    if (!Array.isArray(values)) return [];
    const set = new Set<T>();
    for (const v of values) {
        if (typeof v === "string" && (allowed as readonly string[]).includes(v)) set.add(v as T);
    }
    return [...set];
}

/** Validates + normalizes a raw mission spec. Returns a strict spec or errors. */
export function validateMissionSpec(raw: unknown): MissionValidationResult {
    const errors: string[] = [];
    if (!isPlainObject(raw)) {
        return { valid: false, errors: ["Mission spec must be an object."], normalized: null };
    }

    const markets = whitelist(
        Array.isArray(raw.markets) ? raw.markets : Array.isArray(raw.market) ? raw.market : [],
        SUPPORTED_SYMBOLS as readonly SupportedSymbol[]
    ).slice(0, MISSION_LIMITS.maxMarkets);
    if (markets.length < MISSION_LIMITS.minMarkets) {
        errors.push(`markets: 1–${MISSION_LIMITS.maxMarkets} supported symbols required (got ${markets.length}).`);
    }

    const timeframes = whitelist(raw.timeframes, Object.keys(TIMEFRAME_INTERVALS) as Timeframe[]).slice(
        0,
        MISSION_LIMITS.maxTimeframes
    );
    if (timeframes.length < MISSION_LIMITS.minTimeframes) {
        errors.push(`timeframes: 1–${MISSION_LIMITS.maxTimeframes} of M1|M3|M5|M15|M30|H1|H4|D1 required.`);
    }

    const tradingStyle = whitelist([raw.tradingStyle], RESEARCH_TRADING_STYLES)[0];
    if (!tradingStyle) errors.push("tradingStyle must be scalping|intraday|swing.");

    const concepts = whitelist(raw.concepts, RESEARCH_CONCEPTS).slice(0, MISSION_LIMITS.maxConcepts);
    if (concepts.length < MISSION_LIMITS.minConcepts) {
        errors.push(`concepts: 1–${MISSION_LIMITS.maxConcepts} supported concepts required.`);
    }

    let sessions = whitelist(raw.sessions, RESEARCH_SESSIONS);
    if (sessions.length === 0) sessions = ["london", "new_york", "overlap"];

    const direction = raw.direction === "long" || raw.direction === "short" ? raw.direction : "both";

    const riskProfile = whitelist([raw.riskProfile], RESEARCH_RISK_PROFILES)[0] ?? "moderate";

    const historicalPeriod = whitelist([raw.historicalPeriod], RESEARCH_PERIODS)[0] ?? "1Y";

    const maxCandidatesRaw = typeof raw.maxCandidates === "number" ? Math.floor(raw.maxCandidates) : 8;
    const maxCandidates = Math.min(
        MISSION_LIMITS.maxCandidates,
        Math.max(MISSION_LIMITS.minCandidates, maxCandidatesRaw)
    );
    if (maxCandidatesRaw > MISSION_LIMITS.maxCandidates) {
        errors.push(`maxCandidates capped at ${MISSION_LIMITS.maxCandidates}.`);
    }

    // The engine NEVER enables execution — reject any attempt to turn it on.
    if (raw.executionEnabled === true) {
        errors.push("executionEnabled must be false: the research engine does not execute orders.");
    }

    if (errors.length > 0) {
        return { valid: false, errors, normalized: null };
    }

    return {
        valid: true,
        errors: [],
        normalized: {
            markets,
            timeframes,
            tradingStyle,
            concepts,
            sessions,
            direction,
            riskProfile,
            historicalPeriod,
            maxCandidates: Math.min(maxCandidates, clampBudget(raw.budget).maxHypotheses),
            requireOOS: raw.requireOOS !== false,
            requireWalkForward: raw.requireWalkForward !== false,
            requireMonteCarlo: raw.requireMonteCarlo !== false,
            forwardTesting: raw.forwardTesting === true,
            budget: clampBudget(raw.budget),
            executionEnabled: false,
        },
    };
}

export function validateMissionName(name: unknown): string {
    if (typeof name === "string" && name.trim().length > 0) {
        return name.trim().slice(0, MISSION_LIMITS.maxNameLength);
    }
    return "Research Mission";
}

/** Validates persisted mission shape read back from RTDB before orchestrating it. */
export function isCoercibleMission(value: unknown): value is ResearchMission {
    if (!isPlainObject(value)) return false;
    const m = value as Partial<ResearchMission>;
    return (
        typeof m.id === "string" &&
        typeof m.uid === "string" &&
        isPlainObject(m.spec) &&
        Array.isArray(m.stages) &&
        m.stages.every((s) => isPlainObject(s) && MISSION_STAGES.includes((s as MissionStageStateLike).stage)) &&
        typeof m.createdAt === "number"
    );
}

interface MissionStageStateLike {
    stage: MissionStage;
    status: string;
    attempts: number;
}

export function emptyStageStates(): ResearchMission["stages"] {
    return MISSION_STAGES.map((stage) => ({ stage, status: "pending", attempts: 0 }));
}
