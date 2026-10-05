/**
 * Smart Money engine (core) — ONE deterministic detector set for chart,
 * backtest, replay, alerts, strategy research and AI.
 *
 * Contract:
 *  - `detectSmartMoney(candles, config)` receives ONLY the candles that are
 *    available at evaluation time. Running it on a prefix (replay/backtest)
 *    can never see the future: every detector only reads indices ≤ the last
 *    provided candle.
 *  - Every emitted object carries `confirmationAt`; consumers that hold a
 *    full snapshot gate visibility with `visibleAsOf(objects, asOf)` so a
 *    historically-confirmed object can never appear before it was known.
 *  - Output is deterministic: same candles + config → identical objects,
 *    ids and statuses (proved by tests).
 *
 * This is the engine the chart, the dashboard, the alerts, the backtester
 * and the AI context all consume. No surface runs its own SMC math.
 */

import type { CoreCandle, SmartMoneyObject } from "../types";
import { detectLiquidity } from "./liquidity";
import { detectDealingRange, type DealingRange } from "./premium-discount";
import { detectSessionLiquidity } from "./sessions";
import { detectStructure, type StructureResult } from "./structure";
import { timeframeToMs, type DetectorContext } from "./shared";
import { detectZones, type ZonesResult } from "./zones";

/** Bump whenever any detector rule changes (research reproducibility). */
export const SMART_MONEY_VERSION = "1.0.0";

export interface SmartMoneyConfig {
    symbol: string;
    timeframe: string;
    /** Fractal lookback for pivots (default 3, matching the platform). */
    lookback?: number;
    /** Relative tolerance for equal-high/low clustering (default 0.001). */
    equalTolerance?: number;
    /** Order-block displacement lookahead in candles (default 3). */
    obLookahead?: number;
    structure?: boolean;
    liquidity?: boolean;
    zones?: boolean;
    orderBlocks?: boolean;
    sessions?: boolean;
}

export interface SmartMoneyDetection {
    version: string;
    symbol: string;
    timeframe: string;
    /** Every object, ascending by confirmation time then id. */
    objects: SmartMoneyObject[];
    structure: StructureResult;
    dealingRange: DealingRange | null;
    pools: SmartMoneyObject[];
    sweeps: SmartMoneyObject[];
    fvgs: SmartMoneyObject[];
    orderBlocks: SmartMoneyObject[];
    limitations: string[];
}

const DEFAULTS = {
    lookback: 3,
    equalTolerance: 0.001,
    obLookahead: 3,
};

export function detectSmartMoney(candles: readonly CoreCandle[], config: SmartMoneyConfig): SmartMoneyDetection {
    const tfMs = timeframeToMs(config.timeframe);
    const limitations: string[] = [];
    const symbol = String(config.symbol).toUpperCase();
    const timeframe = String(config.timeframe).toUpperCase();

    const empty: SmartMoneyDetection = {
        version: SMART_MONEY_VERSION,
        symbol,
        timeframe,
        objects: [],
        structure: { objects: [], bias: "neutral", counts: { hh: 0, hl: 0, lh: 0, ll: 0, bos: 0, choch: 0 }, pivots: [] },
        dealingRange: null,
        pools: [],
        sweeps: [],
        fvgs: [],
        orderBlocks: [],
        limitations,
    };

    if (tfMs <= 0) {
        limitations.push(`Unsupported timeframe "${config.timeframe}".`);
        return empty;
    }
    if (!candles || candles.length < 10) {
        limitations.push("Insufficient candles for smart money detection.");
        return empty;
    }

    const ctx: DetectorContext = {
        symbol,
        timeframe,
        tfMs,
        candles,
        lookback: Math.max(1, config.lookback ?? DEFAULTS.lookback),
        equalTolerance: config.equalTolerance ?? DEFAULTS.equalTolerance,
    };

    const wantStructure = config.structure !== false;
    const wantLiquidity = config.liquidity !== false;
    const wantZones = config.zones !== false;
    const wantObs = config.orderBlocks !== false;
    const wantSessions = config.sessions !== false;

    // Pivots are ALWAYS computed (liquidity pools and the dealing range are
    // built from them); `structure: false` only suppresses the structure
    // objects in the output, it never skips the underlying detection.
    const structureRun = detectStructure(ctx);
    const structure = wantStructure ? structureRun : { ...structureRun, objects: [] };

    const confirmedPivots = structure.pivots
        .filter((p) => !p.developing)
        .map((p) => ({ side: p.side, price: p.price, timestamp: p.timestamp, confirmationTime: p.confirmationTime, index: p.index }));

    const liquidity = wantLiquidity
        ? detectLiquidity(ctx, confirmedPivots)
        : { pools: [], sweeps: [], objects: [] };

    const zones: ZonesResult = wantZones || wantObs
        ? detectZones(ctx, { lookahead: Math.max(1, config.obLookahead ?? DEFAULTS.obLookahead) })
        : { fvgs: [], orderBlocks: [], objects: [] };
    const fvgs = wantZones ? zones.fvgs : [];
    const orderBlocks = wantObs ? zones.orderBlocks : [];

    const lastClose = candles[candles.length - 1].close;
    const confirmedHighs = confirmedPivots.filter((p) => p.side === "high");
    const confirmedLows = confirmedPivots.filter((p) => p.side === "low");
    const dealing = wantStructure ? detectDealingRange(ctx, confirmedHighs, confirmedLows, lastClose) : { range: null, object: null };

    const sessionObjects = wantSessions ? detectSessionLiquidity(ctx) : [];

    const objects = [
        ...structure.objects,
        ...liquidity.objects,
        ...fvgs,
        ...orderBlocks,
        ...(dealing.object ? [dealing.object] : []),
        ...sessionObjects,
    ].sort((a, b) => a.confirmationAt - b.confirmationAt || a.id.localeCompare(b.id));

    if (candles.length < ctx.lookback * 2 + 1) {
        limitations.push("Candle count below pivot lookback — structure not confirmed yet.");
    }

    return {
        version: SMART_MONEY_VERSION,
        symbol,
        timeframe,
        objects,
        structure,
        dealingRange: dealing.range,
        pools: liquidity.pools,
        sweeps: liquidity.sweeps,
        fvgs,
        orderBlocks,
        limitations,
    };
}

/**
 * Point-in-time filter: only objects that were KNOWABLE at `asOf`
 * (confirmation time ≤ asOf). Use this whenever a consumer renders or
 * reasons about a full snapshot on behalf of an earlier moment.
 */
export function visibleAsOf(objects: readonly SmartMoneyObject[], asOf: number): SmartMoneyObject[] {
    return objects.filter((o) => o.confirmationAt <= asOf);
}

/** Objects whose lifecycle had already started at `asOf`. */
export function detectedBy(objects: readonly SmartMoneyObject[], asOf: number): SmartMoneyObject[] {
    return objects.filter((o) => o.detectedAt <= asOf);
}

/**
 * Recompute lifecycle status as of a past time. Zones detected on the full
 * snapshot carry their END status; backtests that need a historical status
 * re-run detection on the prefix instead (the canonical, leak-free path).
 */
export function statusAsOf(detection: SmartMoneyDetection, asOf: number): SmartMoneyObject[] {
    return visibleAsOf(detection.objects, asOf);
}

// ── memoized runner ────────────────────────────────────────────────────────

/**
 * Convenience wrapper that memoizes on series identity so a chart render
 * loop does not re-run detection when nothing changed. Detection itself is
 * cheap (single O(n) pass per detector) and only re-runs when the candle
 * snapshot or the config changes.
 */
export class SmartMoneyDetector {
    private cachedSeries: readonly CoreCandle[] | null = null;
    private cache: SmartMoneyDetection | null = null;

    constructor(private readonly config: SmartMoneyConfig) {}

    /**
     * Snapshot identity is the cache key: the canonical data engine swaps in
     * a NEW array on every committed change, so identity changes exactly
     * when the data changed (and never when it did not).
     */
    run(candles: readonly CoreCandle[]): SmartMoneyDetection {
        if (this.cache && this.cachedSeries === candles) return this.cache;
        this.cache = detectSmartMoney(candles, this.config);
        this.cachedSeries = candles;
        return this.cache;
    }

    dispose(): void {
        this.cache = null;
        this.cachedSeries = null;
    }
}
