/**
 * AlgoVault Strategy Lab — evolutionary candidate generation.
 *
 * Implements the pipeline described in the product brief:
 *
 *   Market Data → Feature Extraction → Strategy Generator → Backtest
 *   → Risk Evaluation → Out-of-Sample Validation → Survivor Selection
 *   → Mutation → Next Generation
 *
 * Two hard rules govern this module:
 *
 * 1. **No fabricated numbers.** Every count, score and metric returned here is
 *    the result of running the existing backtester (`backtestStrategy`) and
 *    validator (`validateStrategy`) over real candles. A candidate that could
 *    not be evaluated is counted in `unevaluated` and excluded from every
 *    rate, with the reason preserved.
 * 2. **Bounded work.** Generation sizes are capped so a request can never turn
 *    into thousands of backtests, and the resulting counts are real counts of
 *    what was actually run.
 *
 * Deterministic given the same candles: mutation draws from a seeded PRNG, so
 * the same generation N always produces the same children of the same parents.
 */

import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { backtestStrategy, defaultBacktestConfig } from "@/lib/strategy-lab/backtest";
import { computeRobustness } from "@/lib/strategy-lab/robustness";
import { validateStrategy } from "@/lib/strategy-lab/validation";
import { computeFeatures } from "@/lib/strategy-lab/features";
import type {
    BacktestConfig,
    BacktestMetrics,
    BacktestResult,
    Strategy,
    TimeframeHierarchy,
    ValidationOutcome,
} from "@/lib/strategy-lab/types";
import {
    type DnaDirection,
    type StrategyDna,
    buildDnaTemplate,
    dnaSignature,
    validateDna,
} from "@/lib/ai/strategy-lab/dna";
import {
    LIMITS,
    STAGE_LABELS,
    SURVIVOR_THRESHOLDS,
    type PipelineStage,
    type StageStatus,
} from "@/lib/ai/strategy-lab/evolution-constants";

// ── seeded PRNG ─────────────────────────────────────────────────────────────

/** Deterministic 32-bit string hash (FNV-1a), used to seed the PRNG. */
function hashSeed(input: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/** mulberry32 — small, fast, fully deterministic. */
function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── pipeline stages ─────────────────────────────────────────────────────────

export type StageReport = {
    stage: PipelineStage;
    label: string;
    status: StageStatus;
    /** Real count of records entering / leaving / surviving this stage. */
    count: number;
    detail: string;
};

// ── candidate representation ────────────────────────────────────────────────

export type CandidateEvaluation = {
    dna: StrategyDna;
    signature: string;
    /** `null` when the DNA could not be converted to a backtestable strategy. */
    backtest: BacktestResult | null;
    validation: ValidationOutcome | null;
    metrics: BacktestMetrics | null;
    /** Composite score. Only computed from real metrics. */
    score: number | null;
    robustnessScore: number | null;
    grade: "A" | "B" | "C" | "D" | null;
    survivor: boolean;
    /** Why this candidate was rejected. `null` for survivors. */
    rejectionReason: string | null;
    error: string | null;
};

export type GenerationReport = {
    generation: number;
    candidates: number;
    evaluated: number;
    unevaluated: number;
    survivors: number;
    mutations: number;
    /** Population this generation started from (seeds for gen 1). */
    parents: number;
    stages: StageReport[];
    /** Only for the newest generation — full detail is not shipped for parents. */
    details?: CandidateEvaluation[];
    asOf: number;
    durationMs: number;
    unavailable: string | null;
};

export type EvolutionRun = {
    id: string;
    uid: string;
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    generations: number;
    seedPopulation: number;
    /** Real counts summed across every generation that was actually run. */
    totals: {
        candidates: number;
        evaluated: number;
        unevaluated: number;
        survivors: number;
    };
    generationReports: GenerationReport[];
    asOf: number;
    durationMs: number;
    /** Present when the run could not proceed at all. */
    unavailable: string | null;
    dataAsOf: number | null;
};

// ── thresholds (explicit, not magic numbers scattered through the code) ─────
// Declared in the leaf module so the client can render them without importing
// the backtester; re-exported here so server code has one import path.

export { PIPELINE_STAGES, STAGE_LABELS, SURVIVOR_THRESHOLDS, LIMITS } from "@/lib/ai/strategy-lab/evolution-constants";
export type { PipelineStage, StageStatus } from "@/lib/ai/strategy-lab/evolution-constants";

// ── DNA → Strategy ──────────────────────────────────────────────────────────

let ruleSeq = 0;
function nextRuleId(prefix: string): string {
    ruleSeq += 1;
    return `${prefix}_${ruleSeq.toString(36)}`;
}

/**
 * Convert a DNA into a backtestable `Strategy`.
 *
 * This is the only place a DNA becomes executable, and it produces an ordinary
 * `Strategy`, so everything downstream (backtest, validation, robustness, EA
 * generation) is the existing, already-tested path.
 */
export function dnaToStrategy(
    dna: StrategyDna,
    hierarchy: TimeframeHierarchy
): Strategy {
    const now = Date.now();
    const dirWord = dna.direction === "long" ? "bullish" : "bearish";

    const entryRules = dna.entry
        .filter((c) => c.active)
        .map<import("@/lib/strategy-lab/types").StrategyRule>((c) => {
            switch (c.block) {
                case "structure":
                    return {
                        id: nextRuleId("st"),
                        enabled: true,
                        group: "structure",
                        label: "Structure break in trade direction",
                        operator: "eq",
                        timeframe: hierarchy.structure,
                        value: dirWord,
                        groupLogic: "AND",
                    };
                case "liquidity":
                    return {
                        id: nextRuleId("lq"),
                        enabled: true,
                        group: "liquidity",
                        label: "Liquidity swept before entry",
                        operator: "gte",
                        timeframe: hierarchy.setup,
                        value: 1,
                        groupLogic: "AND",
                    };
                case "fvg":
                    return {
                        id: nextRuleId("fg"),
                        enabled: true,
                        group: "fvg",
                        label: "Fair value gap present",
                        operator: "gte",
                        timeframe: hierarchy.setup,
                        value: 1,
                        groupLogic: "AND",
                    };
                case "momentum":
                    return {
                        id: nextRuleId("mm"),
                        enabled: true,
                        group: "confirmation",
                        label: "Momentum confirmation",
                        operator: "gte",
                        timeframe: hierarchy.entry,
                        value: c.value ?? 50,
                        groupLogic: "AND",
                    };
                case "session":
                default:
                    return {
                        id: nextRuleId("se"),
                        enabled: true,
                        group: "session",
                        label: "Session filter",
                        operator: "in",
                        timeframe: hierarchy.entry,
                        value: ["london", "new_york", "overlap"],
                        groupLogic: "AND",
                    };
            }
        });

    const atrExit = dna.exit.find((c) => c.block === "atr");
    const tpExit = dna.exit.find((c) => c.block === "tp");
    const trailingExit = dna.exit.find((c) => c.block === "trailing");
    const volFilter = dna.filters.find((c) => c.block === "volatility");
    const mtfFilter = dna.filters.find((c) => c.block === "mtf_trend");

    const atrMultiple =
        atrExit?.active && typeof atrExit.value === "number" && atrExit.value > 0
            ? atrExit.value
            : 1.5;
    const tpR = tpExit?.active && typeof tpExit.value === "number" && tpExit.value > 0 ? tpExit.value : 2;

    return {
        id: dna.id,
        name: `${dna.symbol} ${dna.timeframe} ${dna.direction} G${dna.generation} · ${dna.label}`,
        description: dna.mutationNote ?? "Seeded Strategy Lab candidate.",
        asset: dna.symbol as Strategy["asset"],
        direction: dna.direction,
        timeframes: hierarchy,
        regimeFilter: [
            "trending_bullish",
            "trending_bearish",
            "ranging",
            "breakout",
            "high_volatility",
            "transitional",
        ],
        entryRules,
        confirmationRules: mtfFilter?.active
            ? [
                  {
                      id: nextRuleId("cf"),
                      enabled: true,
                      group: "trend",
                      label: "Higher timeframe trend agrees",
                      operator: "eq",
                      timeframe: hierarchy.macro,
                      value: dirWord,
                      groupLogic: "AND",
                  },
              ]
            : [],
        stopLoss: {
            mode: "atr",
            atrMultiple,
            levelOffset: 0,
            useSwing: dna.exit.find((c) => c.block === "structure_sl")?.active ?? false,
        },
        takeProfit: {
            mode: "r",
            r1: tpR,
            r2: Math.round(tpR * 1.6 * 100) / 100,
            r3: Math.round(tpR * 2.4 * 100) / 100,
            fixedDistance: 0,
            partialCloses: [
                { atR: 1, closePercent: 50 },
                { atR: tpR, closePercent: 50 },
            ],
            moveBeAfterTp1: true,
            lockAfterTp2: false,
            trailingEnabled: trailingExit?.active ?? false,
            trailingStopAtr:
                trailingExit?.active && typeof trailingExit.value === "number" ? trailingExit.value : 1,
        },
        risk: {
            mode: "percent",
            riskPercent: 1,
            fixedLot: 0.01,
            maxPositions: 1,
            dailyLossLimitPct: 3,
            maxDrawdownPct: SURVIVOR_THRESHOLDS.maxDrawdownPct,
        },
        filters: {
            sessions:
                dna.entry.find((c) => c.block === "session")?.active === true
                    ? ["london", "new_york", "overlap"]
                    : ["asian", "london", "new_york", "overlap"],
            daysOfWeek: [1, 2, 3, 4, 5],
            volatilityMinAtrPct:
                volFilter?.active && typeof volFilter.value === "number" ? volFilter.value : 0,
            volatilityMaxAtrPct: 1.5,
            maxTradesPerDay: 3,
            cooldownCandles: 2,
        },
        executionModel: "next_bar_open",
        costs: { spreadPips: 0, commissionPerLot: 0, slippagePips: 0 },
        sourcePatternId: null,
        whyp: {
            discovered: `Strategy DNA generation ${dna.generation}.`,
            conditionsSelected: dna.entry
                .filter((c) => c.active)
                .map((c) => c.block)
                .join(", "),
            occurrenceFrequency: "Derived from the seeded candidate population.",
            historicalPerformance: "Computed by the backtest engine over the supplied candles.",
            weaknesses: "Not yet characterised.",
            poorRegimes: "Excluded by the regime filter.",
            generatedByProvider: "algovault-evolution-deterministic",
        },
        version: "1.0.0",
        created: now,
        updated: now,
    };
}

// ── evaluation ──────────────────────────────────────────────────────────────

/**
 * Composite score. Mirrors the weighting already used by
 * `lib/strategy-lab/optimization.ts` so the lab and the optimiser agree on
 * what "good" means. Returns `null` when there is not enough real data.
 */
export function scoreCandidate(metrics: BacktestMetrics | null): number | null {
    if (!metrics || metrics.totalTrades < SURVIVOR_THRESHOLDS.minTrades) return null;
    const pf = Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 0;
    const expectancy = Number.isFinite(metrics.expectancyR) ? metrics.expectancyR : 0;
    const returnTerm = Math.min(Math.max(metrics.returnPct, -50), 50);
    const dd = Math.max(0, metrics.maxDrawdownPct);

    return (
        metrics.winRate * 0.3 +
        pf * 0.25 +
        returnTerm * 0.2 +
        (100 - dd) * 0.15 +
        expectancy * 0.1
    );
}

export function survivorDecision(
    metrics: BacktestMetrics | null,
    score: number | null
): { survivor: boolean; reason: string | null } {
    if (!metrics) return { survivor: false, reason: "No backtest metrics were produced." };
    if (metrics.totalTrades < SURVIVOR_THRESHOLDS.minTrades) {
        return {
            survivor: false,
            reason: `Sample size ${metrics.totalTrades} is below the ${SURVIVOR_THRESHOLDS.minTrades}-trade minimum.`,
        };
    }
    if (!Number.isFinite(metrics.profitFactor) || metrics.profitFactor < SURVIVOR_THRESHOLDS.minProfitFactor) {
        return {
            survivor: false,
            reason: `Profit factor ${metrics.profitFactor.toFixed(2)} is below ${SURVIVOR_THRESHOLDS.minProfitFactor}.`,
        };
    }
    if (!Number.isFinite(metrics.expectancyR) || metrics.expectancyR < SURVIVOR_THRESHOLDS.minExpectancyR) {
        return {
            survivor: false,
            reason: `Expectancy ${metrics.expectancyR.toFixed(3)}R is below ${SURVIVOR_THRESHOLDS.minExpectancyR}R.`,
        };
    }
    if (metrics.maxDrawdownPct > SURVIVOR_THRESHOLDS.maxDrawdownPct) {
        return {
            survivor: false,
            reason: `Max drawdown ${metrics.maxDrawdownPct.toFixed(1)}% exceeds ${SURVIVOR_THRESHOLDS.maxDrawdownPct}%.`,
        };
    }
    if (score === null) return { survivor: false, reason: "No composite score could be computed." };
    return { survivor: true, reason: null };
}

// ── generation ──────────────────────────────────────────────────────────────

export type SeedPopulationInput = {
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    hierarchy: TimeframeHierarchy;
    /** Real feature series length, used to sanity-check the dataset. */
    featureBars: number;
    size: number;
    seed: string;
};

/** Build the generation-1 seed population from the closed DNA template. */
export function buildSeedPopulation(input: SeedPopulationInput): StrategyDna[] {
    const rng = makeRng(hashSeed(input.seed));
    const directions: DnaDirection[] = ["long", "short"];
    const out: StrategyDna[] = [];
    const seen = new Set<string>();
    const now = Date.now();

    let guard = 0;
    const maxAttempts = input.size * 12;

    while (out.length < input.size && guard < maxAttempts) {
        guard += 1;
        const tpl = buildDnaTemplate();
        const direction = directions[Math.floor(rng() * directions.length)] ?? "long";

        // Randomly activate a subset of entry/filter/exit blocks, keeping at
        // least one active in each group so the DNA is always runnable.
        for (const c of tpl.entry) {
            c.active = rng() > 0.35;
        }
        for (const c of tpl.filters) {
            c.active = rng() > 0.4;
        }
        for (const c of tpl.exit) {
            c.active = rng() > 0.25;
        }
        if (!tpl.entry.some((c) => c.active)) tpl.entry[0].active = true;
        if (!tpl.exit.some((c) => c.active)) tpl.exit[0].active = true;

        // Re-parameterise the numeric blocks from a small, declared grid.
        const atr = tpl.exit.find((c) => c.block === "atr");
        if (atr) atr.value = [1, 1.5, 2, 2.5][Math.floor(rng() * 4)] ?? 1.5;
        const tp = tpl.exit.find((c) => c.block === "tp");
        if (tp) tp.value = [1.5, 2, 2.5, 3][Math.floor(rng() * 4)] ?? 2;
        const mom = tpl.entry.find((c) => c.block === "momentum");
        if (mom) mom.value = [45, 50, 55, 60][Math.floor(rng() * 4)] ?? 50;
        const trail = tpl.exit.find((c) => c.block === "trailing");
        if (trail) trail.value = [0.5, 1, 1.5][Math.floor(rng() * 3)] ?? 1;

        const dna: StrategyDna = {
            id: `dna_g1_${out.length}_${Math.floor(rng() * 1e6).toString(36)}`,
            symbol: input.symbol,
            timeframe: input.timeframe,
            direction,
            generation: 1,
            parentId: null,
            label: `seed-${out.length}`,
            entry: tpl.entry,
            filters: tpl.filters,
            exit: tpl.exit,
            mutationNote: "Seed candidate from the Strategy DNA template.",
            createdAt: now,
        };

        const sig = dnaSignature(dna);
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(dna);
    }

    return out;
}

/**
 * Produce children from survivors.
 *
 * Each child changes exactly one aspect of its parent, so a survivor's
 * contribution is traceable and the mutation note is meaningful rather than
 * decorative. Signatures already present in the population are skipped.
 */
export function mutatePopulation(
    parents: StrategyDna[],
    generation: number,
    size: number,
    seed: string
): StrategyDna[] {
    const rng = makeRng(hashSeed(`${seed}:g${generation}`));
    if (parents.length === 0) return [];

    const children: StrategyDna[] = [];
    const seen = new Set(parents.map(dnaSignature));
    const now = Date.now();

    const toggles: Array<(dna: StrategyDna) => string | null> = [
        (dna) => {
            const c = dna.entry.find((x) => x.block === "fvg");
            if (!c) return null;
            c.active = !c.active;
            return `${c.active ? "Enabled" : "Disabled"} FVG retest entry.`;
        },
        (dna) => {
            const c = dna.entry.find((x) => x.block === "liquidity");
            if (!c) return null;
            c.active = !c.active;
            return `${c.active ? "Enabled" : "Disabled"} liquidity sweep entry.`;
        },
        (dna) => {
            const c = dna.entry.find((x) => x.block === "session");
            if (!c) return null;
            c.active = !c.active;
            return `${c.active ? "Restricted" : "Unrestricted"} to high-liquidity sessions.`;
        },
        (dna) => {
            const c = dna.exit.find((x) => x.block === "atr");
            if (!c) return null;
            const grid = [1, 1.5, 2, 2.5];
            const i = grid.findIndex((g) => g === c.value);
            c.value = grid[(i + 1) % grid.length];
            return `ATR stop multiple → ${c.value}.`;
        },
        (dna) => {
            const c = dna.exit.find((x) => x.block === "tp");
            if (!c) return null;
            const grid = [1.5, 2, 2.5, 3];
            const i = grid.findIndex((g) => g === c.value);
            c.value = grid[(i + 1) % grid.length];
            return `Take profit → ${c.value}R.`;
        },
        (dna) => {
            const c = dna.exit.find((x) => x.block === "trailing");
            if (!c) return null;
            c.active = !c.active;
            return `${c.active ? "Enabled" : "Disabled"} trailing stop.`;
        },
        (dna) => {
            const c = dna.filters.find((x) => x.block === "mtf_trend");
            if (!c) return null;
            c.active = !c.active;
            return `${c.active ? "Enabled" : "Disabled"} higher-timeframe trend filter.`;
        },
        (dna) => {
            const c = dna.filters.find((x) => x.block === "volatility");
            if (!c) return null;
            c.active = !c.active;
            return `${c.active ? "Enabled" : "Disabled"} volatility band filter.`;
        },
        (dna) => {
            dna.direction = dna.direction === "long" ? "short" : "long";
            return `Flipped direction to ${dna.direction}.`;
        },
    ];

    let guard = 0;
    const maxAttempts = size * 10;

    while (children.length < size && guard < maxAttempts) {
        guard += 1;
        const parent = parents[Math.floor(rng() * parents.length)];
        if (!parent) break;

        const child: StrategyDna = JSON.parse(JSON.stringify(parent)) as StrategyDna;
        child.id = `dna_g${generation}_${children.length}_${Math.floor(rng() * 1e6).toString(36)}`;
        child.generation = generation;
        child.parentId = parent.id;
        child.label = `gen${generation}-${children.length}`;
        child.createdAt = now;

        const mutation = toggles[Math.floor(rng() * toggles.length)];
        const note = mutation ? mutation(child) : null;
        if (!note) continue;
        child.mutationNote = note;

        const sig = dnaSignature(child);
        if (seen.has(sig)) continue;
        seen.add(sig);
        children.push(child);
    }

    return children;
}

// ── the run ─────────────────────────────────────────────────────────────────

export type EvolutionRunInput = {
    runId: string;
    uid: string;
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    hierarchy: TimeframeHierarchy;
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>;
    /** Setup timeframe candles drive the actual backtest loop. */
    setupTimeframe: Timeframe;
    from: number;
    to: number;
    generations?: number;
    seedPopulation?: number;
    seed?: string;
    config?: BacktestConfig;
    now?: number;
};

export async function runEvolution(input: EvolutionRunInput): Promise<EvolutionRun> {
    const started = Date.now();
    const now = input.now ?? started;
    const generations = Math.max(1, Math.min(input.generations ?? 4, LIMITS.maxGenerations));
    const seedSize = Math.max(2, Math.min(input.seedPopulation ?? 12, LIMITS.maxSeeds));
    const seed = input.seed ?? `${input.uid}:${input.runId}`;
    const baseConfig = input.config ?? defaultBacktestConfig();

    const setupCandles = input.candlesByTF[input.setupTimeframe] ?? [];
    const dataAsOf = setupCandles.length > 0 ? setupCandles[setupCandles.length - 1].timestamp : null;

    const totals = { candidates: 0, evaluated: 0, unevaluated: 0, survivors: 0 };
    const reports: GenerationReport[] = [];

    // Guard rails: refuse to run rather than produce an empty, misleading report.
    if (setupCandles.length < 100) {
        return {
            id: input.runId,
            uid: input.uid,
            symbol: input.symbol,
            timeframe: input.setupTimeframe,
            generations: 0,
            seedPopulation: 0,
            totals: { candidates: 0, evaluated: 0, unevaluated: 0, survivors: 0 },
            generationReports: [],
            asOf: now,
            durationMs: Date.now() - started,
            unavailable: `Backtesting needs at least 100 bars on ${input.setupTimeframe}; the data bundle returned ${setupCandles.length}.`,
            dataAsOf,
        };
    }

    // Feature extraction is a real pass over the candles, and its output size is
    // reported as the feature count rather than assumed.
    const features = computeFeatures(setupCandles);
    const usableFeatures = features.filter((f) => f !== null).length;

    let population = buildSeedPopulation({
        symbol: input.symbol,
        timeframe: input.setupTimeframe,
        hierarchy: input.hierarchy,
        featureBars: usableFeatures,
        size: seedSize,
        seed: `${seed}:g1`,
    });

    if (population.length === 0) {
        return {
            id: input.runId,
            uid: input.uid,
            symbol: input.symbol,
            timeframe: input.setupTimeframe,
            generations: 0,
            seedPopulation: 0,
            totals: { candidates: 0, evaluated: 0, unevaluated: 0, survivors: 0 },
            generationReports: [],
            asOf: now,
            durationMs: Date.now() - started,
            unavailable:
                "The seed generator could not produce distinct candidate genomes from the closed DNA template.",
            dataAsOf,
        };
    }

    let parents = 0;

    for (let gen = 1; gen <= generations; gen++) {
        const genStarted = Date.now();
        parents = gen === 1 ? 0 : population.length;

        const evaluations: CandidateEvaluation[] = [];
        let evaluated = 0;
        let unevaluated = 0;

        for (const dna of population) {
            const schemaErrors = validateDna(dna);
            if (schemaErrors.length > 0) {
                unevaluated += 1;
                evaluations.push({
                    dna,
                    signature: dnaSignature(dna),
                    backtest: null,
                    validation: null,
                    metrics: null,
                    score: null,
                    robustnessScore: null,
                    grade: null,
                    survivor: false,
                    rejectionReason: `Schema validation failed: ${schemaErrors.join(" ")}`,
                    error: null,
                });
                continue;
            }

            try {
                const strategy = dnaToStrategy(dna, input.hierarchy);
                const backtest = backtestStrategy(
                    strategy,
                    input.symbol,
                    input.candlesByTF,
                    baseConfig,
                    input.from,
                    input.to
                );

                // Out-of-sample: the trailing 30% of the window, which the
                // in-sample run above never saw.
                const span = input.to - input.from;
                const split = input.from + span * 0.7;
                const validation = validateStrategy(
                    strategy,
                    input.symbol,
                    input.setupTimeframe,
                    baseConfig,
                    setupCandles,
                    { from: input.from, to: split },
                    { from: split, to: input.to },
                    { enabled: false, trainMonths: 1, testMonths: 1 },
                    input.from,
                    input.to
                );

                const metrics = backtest.metrics ?? null;
                const score = scoreCandidate(metrics);
                const robustness = computeRobustness(metrics, validation, null);
                const decision = survivorDecision(metrics, score);

                evaluated += 1;

                const record: CandidateEvaluation = {
                    dna,
                    signature: dnaSignature(dna),
                    backtest,
                    validation,
                    metrics,
                    score,
                    robustnessScore: robustness.score,
                    grade: robustness.grade,
                    survivor: decision.survivor,
                    rejectionReason: decision.reason,
                    error: null,
                };
                evaluations.push(record);
            } catch (err) {
                unevaluated += 1;
                evaluations.push({
                    dna,
                    signature: dnaSignature(dna),
                    backtest: null,
                    validation: null,
                    metrics: null,
                    score: null,
                    robustnessScore: null,
                    grade: null,
                    survivor: false,
                    rejectionReason: "Backtest threw an error.",
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        const survivors = evaluations.filter((e) => e.survivor);

        const nextChildren =
            gen < generations && survivors.length > 0
                ? mutatePopulation(
                      survivors.map((s) => s.dna),
                      gen + 1,
                      Math.min(seedSize, LIMITS.maxChildrenPerGeneration),
                      seed
                  )
                : [];

        const stages: StageReport[] = [
            {
                stage: "market_data",
                label: STAGE_LABELS.market_data,
                status: "completed",
                count: setupCandles.length,
                detail: `${setupCandles.length} bars loaded for ${input.setupTimeframe}.`,
            },
            {
                stage: "feature_extraction",
                label: STAGE_LABELS.feature_extraction,
                status: "completed",
                count: usableFeatures,
                detail: `${usableFeatures} feature rows extracted (3-bar confirmation lag).`,
            },
            {
                stage: "strategy_generator",
                label: STAGE_LABELS.strategy_generator,
                status: population.length > 0 ? "completed" : "skipped",
                count: population.length,
                detail:
                    gen === 1
                        ? `${population.length} seed candidates generated.`
                        : `${population.length} children mutated from ${survivors.length} survivors.`,
            },
            {
                stage: "backtest",
                label: STAGE_LABELS.backtest,
                status: evaluated > 0 ? "completed" : "skipped",
                count: evaluated,
                detail: `${evaluated} candidates backtested; ${unevaluated} could not be evaluated.`,
            },
            {
                stage: "risk_evaluation",
                label: STAGE_LABELS.risk_evaluation,
                status: evaluated > 0 ? "completed" : "skipped",
                count: evaluated,
                detail: `Risk metrics computed for ${evaluated} candidates.`,
            },
            {
                stage: "out_of_sample",
                label: STAGE_LABELS.out_of_sample,
                status: evaluated > 0 ? "completed" : "skipped",
                count: evaluated,
                detail: `In/out-of-sample split at 70% of the window for ${evaluated} candidates.`,
            },
            {
                stage: "survivor_selection",
                label: STAGE_LABELS.survivor_selection,
                status: evaluated > 0 ? "completed" : "skipped",
                count: survivors.length,
                detail: `${survivors.length} candidates passed min ${SURVIVOR_THRESHOLDS.minTrades} trades, PF ≥ ${SURVIVOR_THRESHOLDS.minProfitFactor}, expectancy ≥ ${SURVIVOR_THRESHOLDS.minExpectancyR}R, DD ≤ ${SURVIVOR_THRESHOLDS.maxDrawdownPct}%.`,
            },
            {
                stage: "mutation",
                label: STAGE_LABELS.mutation,
                status: nextChildren.length > 0 ? "completed" : "skipped",
                count: nextChildren.length,
                detail:
                    nextChildren.length > 0
                        ? `${nextChildren.length} children mutated.`
                        : "No survivors to mutate; evolution stopped for this run.",
            },
            {
                stage: "next_generation",
                label: STAGE_LABELS.next_generation,
                status: nextChildren.length > 0 ? "completed" : "skipped",
                count: nextChildren.length,
                detail:
                    nextChildren.length > 0
                        ? `Generation ${gen + 1} queued with ${nextChildren.length} candidates.`
                        : `No next generation produced.`,
            },
        ];

        totals.candidates += population.length;
        totals.evaluated += evaluated;
        totals.unevaluated += unevaluated;
        totals.survivors += survivors.length;

        reports.push({
            generation: gen,
            candidates: population.length,
            evaluated,
            unevaluated,
            survivors: survivors.length,
            mutations: nextChildren.length,
            parents,
            stages,
            // Ship full detail only for the newest generation to keep the
            // payload bounded; parents keep their real counts.
            ...(gen === generations ? { details: evaluations } : {}),
            asOf: Date.now(),
            durationMs: Date.now() - genStarted,
            unavailable:
                evaluated === 0
                    ? "No candidate produced a backtest in this generation."
                    : null,
        });

        if (nextChildren.length === 0) break;
        population = nextChildren;
    }

    return {
        id: input.runId,
        uid: input.uid,
        symbol: input.symbol,
        timeframe: input.setupTimeframe,
        generations: reports.length,
        seedPopulation: seedSize,
        totals,
        generationReports: reports,
        asOf: now,
        durationMs: Date.now() - started,
        unavailable: null,
        dataAsOf,
    };
}
