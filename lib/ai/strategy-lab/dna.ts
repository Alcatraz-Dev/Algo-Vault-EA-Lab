/**
 * AlgoVault Strategy Lab — Strategy DNA schema.
 *
 * A Strategy DNA is the structured, inspectable description of a strategy
 * candidate: what triggers it (entry), what disqualifies it (filters), and how
 * it exits. It is deliberately separate from the existing `Strategy` type in
 * `lib/strategy-lab/types.ts`: the DNA is a *declarative* spec that a candidate
 * is generated from, and it is what the evolution engine mutates. Converting a
 * surviving DNA into a runnable `Strategy` is done by the generator, which
 * reuses `backtestStrategy` — so DNA never becomes a second, parallel trading
 * path.
 *
 * Schema is explicit and serialisable so it can be stored in RTDB verbatim and
 * diffed between generations.
 */

import type { MarketRegime, Timeframe } from "@/lib/market-data/types";
import type { RuleGroup } from "@/lib/strategy-lab/types";

export const DNA_ENTRY_BLOCKS = ["momentum", "structure", "liquidity", "fvg", "session"] as const;
export const DNA_FILTER_BLOCKS = ["mtf_trend", "volatility", "market_regime"] as const;
export const DNA_EXIT_BLOCKS = ["atr", "structure_sl", "tp", "trailing"] as const;

export type DnaEntryBlock = (typeof DNA_ENTRY_BLOCKS)[number];
export type DnaFilterBlock = (typeof DNA_FILTER_BLOCKS)[number];
export type DnaExitBlock = (typeof DNA_EXIT_BLOCKS)[number];

export type DnaDirection = "long" | "short";

/** A single entry trigger. `active: false` records a block that was evaluated
 *  and deliberately switched off, so the evolution trail stays auditable. */
export type DnaEntryComponent = {
    block: DnaEntryBlock;
    active: boolean;
    /** Human-readable condition, e.g. "RSI(14) reclaims 50 after sweep". */
    condition: string;
    /** Numeric parameter when the condition is parameterised. */
    value?: number;
    /** Rule group this maps onto when converted to a `Strategy`. */
    ruleGroup: RuleGroup;
};

export type DnaFilterComponent = {
    block: DnaFilterBlock;
    active: boolean;
    condition: string;
    value?: number | string;
};

export type DnaExitComponent = {
    block: DnaExitBlock;
    active: boolean;
    condition: string;
    value?: number;
};

export type StrategyDna = {
    id: string;
    symbol: string;
    timeframe: Timeframe;
    direction: DnaDirection;
    /** Generation this DNA was produced by (1-based). */
    generation: number;
    /** For mutated DNAs, the parent DNA id. `null` for a seed. */
    parentId: string | null;
    /** Which parent slot this DNA occupies, for stable identity across runs. */
    label: string;
    entry: DnaEntryComponent[];
    filters: DnaFilterComponent[];
    exit: DnaExitComponent[];
    /** Free-form note describing what changed versus the parent. */
    mutationNote: string | null;
    createdAt: number;
};

// ── constructors ────────────────────────────────────────────────────────────

/**
 * The canonical template every candidate starts from. Mutations toggle or
 * re-parameterise entries in this list; they never invent a new block outside
 * the declared taxonomy, which keeps the schema closed and comparable.
 *
 * Deliberately symbol- and timeframe-agnostic: the blocks describe *structure*,
 * not an instrument, so the same seed genome can be evaluated against any
 * candle series. Symbol and timeframe are properties of the evaluation run
 * (`EvolutionRun`), not of the genome.
 */
export function buildDnaTemplate(): {
    entry: DnaEntryComponent[];
    filters: DnaFilterComponent[];
    exit: DnaExitComponent[];
} {
    return {
        entry: [
            {
                block: "structure",
                active: true,
                condition: "Break of structure in the trade direction",
                ruleGroup: "structure",
            },
            {
                block: "liquidity",
                active: true,
                condition: "Sweep of equal highs/lows before entry",
                ruleGroup: "liquidity",
            },
            {
                block: "fvg",
                active: true,
                condition: "Retest of a fair value gap",
                ruleGroup: "fvg",
            },
            {
                block: "momentum",
                active: true,
                condition: "Momentum confirmation on the entry timeframe",
                value: 50,
                ruleGroup: "confirmation",
            },
            {
                block: "session",
                active: false,
                condition: "Only during a high-liquidity session",
                ruleGroup: "session",
            },
        ],
        filters: [
            {
                block: "mtf_trend",
                active: true,
                condition: "Higher timeframe trend must agree",
            },
            {
                block: "volatility",
                active: true,
                condition: "ATR% inside a workable band",
                value: 0.1,
            },
            {
                block: "market_regime",
                active: true,
                condition: "Regime must not be low volatility",
            },
        ],
        exit: [
            {
                block: "atr",
                active: true,
                condition: "Stop sized by ATR multiple",
                value: 1.5,
            },
            {
                block: "structure_sl",
                active: true,
                condition: "Stop placed beyond the structure swing",
            },
            {
                block: "tp",
                active: true,
                condition: "Fixed R-multiple take profit",
                value: 2,
            },
            {
                block: "trailing",
                active: false,
                condition: "Trail stop after first target",
                value: 1,
            },
        ],
    };
}

/** Structural signature of a DNA, used to detect and avoid duplicate genomes. */
export function dnaSignature(dna: StrategyDna): string {
    const parts = [
        dna.symbol,
        dna.timeframe,
        dna.direction,
        ...dna.entry
            .filter((c) => c.active)
            .map((c) => `${c.block}:${c.value ?? "-"}`)
            .sort(),
        ...dna.filters
            .filter((c) => c.active)
            .map((c) => `${c.block}:${c.value ?? "-"}`)
            .sort(),
        ...dna.exit
            .filter((c) => c.active)
            .map((c) => `${c.block}:${c.value ?? "-"}`)
            .sort(),
    ];
    return parts.join("|");
}

/** Count of active blocks — a crude but honest complexity measure. */
export function dnaActiveBlockCount(dna: StrategyDna): number {
    return (
        dna.entry.filter((c) => c.active).length +
        dna.filters.filter((c) => c.active).length +
        dna.exit.filter((c) => c.active).length
    );
}

/** Regime allow-list implied by the `market_regime` filter. */
export function dnaAllowedRegimes(dna: StrategyDna): MarketRegime[] {
    const filter = dna.filters.find((c) => c.block === "market_regime");
    if (!filter || !filter.active) {
        // No regime filter means no restriction. Returning the full set keeps
        // the backtester's gate consistent rather than silently excluding all.
        return [
            "trending_bullish",
            "trending_bearish",
            "ranging",
            "breakout",
            "high_volatility",
            "low_volatility",
            "transitional",
        ];
    }
    return ["trending_bullish", "trending_bearish", "ranging", "breakout", "high_volatility", "transitional"];
}

/** Validate a DNA against the closed schema. Returns the reasons it failed. */
export function validateDna(dna: StrategyDna): string[] {
    const errors: string[] = [];

    if (!dna.id) errors.push("Missing id.");
    if (!dna.symbol) errors.push("Missing symbol.");
    if (dna.direction !== "long" && dna.direction !== "short") {
        errors.push(`Invalid direction: ${String(dna.direction)}.`);
    }
    if (!Number.isInteger(dna.generation) || dna.generation < 1) {
        errors.push("Generation must be a positive integer.");
    }

    for (const c of dna.entry) {
        if (!DNA_ENTRY_BLOCKS.includes(c.block)) errors.push(`Unknown entry block: ${c.block}.`);
    }
    for (const c of dna.filters) {
        if (!DNA_FILTER_BLOCKS.includes(c.block)) errors.push(`Unknown filter block: ${c.block}.`);
    }
    for (const c of dna.exit) {
        if (!DNA_EXIT_BLOCKS.includes(c.block)) errors.push(`Unknown exit block: ${c.block}.`);
    }

    if (dnaActiveBlockCount(dna) === 0) {
        errors.push("DNA has no active blocks.");
    }
    const sl = dna.exit.find((c) => c.block === "atr");
    if (sl?.active && (typeof sl.value !== "number" || sl.value <= 0)) {
        errors.push("Active ATR stop must carry a positive multiple.");
    }

    return errors;
}
