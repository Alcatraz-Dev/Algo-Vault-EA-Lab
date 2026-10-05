/**
 * IndicatorEngine — one deterministic, incremental indicator computation
 * surface for the whole platform.
 *
 * Design:
 *  - Series identity is (symbol, timeframe, timestamp). Values are anchored
 *    by candle OPEN time, never by array position alone: consumers look rows
 *    up with `at(ref, timestamp)` or receive timestamped `IndicatorResult`s.
 *  - Full history and realtime updates run the SAME `step` fold. A tick only
 *    re-folds from the first changed candle onward, which is mathematically
 *    equivalent to a full recalculation (proved in tests/market-core).
 *  - A candle-close → new-candle transition finalizes the previous row and
 *    seeds the next one without duplicating or shifting any point.
 *  - `configure()` is the lifecycle: adding, changing parameters or removing
 *    an indicator recomputes/drops exactly that instance — no ghosts.
 *  - Symbol/timeframe are constructor-scoped: an engine built for
 *    XAUUSD|M5 can never serve EURUSD or H1 rows.
 */

import { indicatorRegistry } from "../registry";
// Side-effect: guarantee the built-in indicator definitions are registered
// for every consumer of the engine (the registry is otherwise empty until
// `lib/market-core/index.ts` is imported).
import "./definitions";
import { paramsKey, type CoreCandle, type IndicatorDefinition, type IndicatorResult, type IndicatorRuntime } from "../types";

export interface IndicatorRef {
    id: string;
    params?: Record<string, number>;
}

export interface IndicatorInstanceConfig extends IndicatorRef {
    /** Optional stable key when the same indicator appears twice. */
    key?: string;
}

export type SeriesChangeKind = "none" | "initial" | "incremental" | "full" | "reset";

export interface SeriesUpdateReport {
    kind: SeriesChangeKind;
    /** Index of the first candle that changed (or -1 for none). */
    firstDiff: number;
    /** Candles folded incrementally (0 for full/reset/none). */
    folded: number;
}

interface InstanceEntry {
    key: string;
    def: IndicatorDefinition;
    params: Record<string, number>;
    runtime: IndicatorRuntime<unknown>;
    state: unknown;
    /** Snapshot of `state` as it was BEFORE the last candle was folded. */
    checkpoint: unknown;
    results: IndicatorResult[];
}

function sameCandle(a: CoreCandle, b: CoreCandle): boolean {
    return (
        a.timestamp === b.timestamp &&
        a.open === b.open &&
        a.high === b.high &&
        a.low === b.low &&
        a.close === b.close &&
        (a.volume ?? 0) === (b.volume ?? 0) &&
        Boolean(a.finalized) === Boolean(b.finalized)
    );
}

export class IndicatorEngine {
    readonly symbol: string;
    readonly timeframe: string;
    private series: readonly CoreCandle[] = [];
    private readonly instances = new Map<string, InstanceEntry>();

    constructor(options: { symbol: string; timeframe: string; indicators?: IndicatorInstanceConfig[] }) {
        this.symbol = String(options.symbol).toUpperCase();
        this.timeframe = String(options.timeframe).toUpperCase();
        if (options.indicators?.length) this.configure(options.indicators);
    }

    /** Stable instance key: `id|params` (params order-independent). */
    static keyOf(ref: IndicatorRef): string {
        const def = indicatorRegistry.get(ref.id);
        if (!def) return ref.id;
        return `${ref.id}|${paramsKey(ref.params, def)}`;
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    /**
     * Set the active indicator instances. Added instances compute over the
     * current series; removed instances are dropped entirely (their state,
     * rows and runtime disappear — no ghost series).
     */
    configure(indicators: IndicatorInstanceConfig[]): { added: string[]; removed: string[] } {
        const wanted = new Map<string, IndicatorInstanceConfig>();
        for (const item of indicators) {
            const def = indicatorRegistry.get(item.id);
            if (!def) continue;
            const params: Record<string, number> = {};
            for (const spec of def.params) {
                params[spec.key] = Number.isFinite(item.params?.[spec.key]) ? (item.params![spec.key]) : spec.default;
            }
            const key = item.key ?? `${item.id}|${paramsKey(params, def)}`;
            wanted.set(key, { ...item, key, params });
        }

        const added: string[] = [];
        const removed: string[] = [];

        for (const key of Array.from(this.instances.keys())) {
            if (!wanted.has(key)) {
                this.instances.delete(key);
                removed.push(key);
            }
        }

        for (const [key, item] of wanted) {
            if (this.instances.has(key)) {
                const existing = this.instances.get(key)!;
                // Parameter change under the same explicit key → recompute.
                const sameParams = Object.keys(item.params!).length === Object.keys(existing.params).length &&
                    Object.entries(item.params!).every(([k, v]) => existing.params[k] === v);
                if (sameParams) continue;
                this.instances.delete(key);
                removed.push(key);
            }
            const entry = this.buildInstance(key, item.id, item.params!);
            this.foldRange(entry, 0, this.series.length - 1, this.series, true);
            this.instances.set(key, entry);
            added.push(key);
        }
        return { added, removed };
    }

    has(ref: IndicatorRef): boolean {
        return this.instances.has(IndicatorEngine.keyOf(ref));
    }

    instanceKeys(): string[] {
        return Array.from(this.instances.keys());
    }

    /** Drop everything (unmount / symbol switch). */
    dispose(): void {
        this.instances.clear();
        this.series = [];
    }

    // ── series updates ─────────────────────────────────────────────────────

    /**
     * Feed the canonical candle snapshot. Detects the kind of change and
     * folds only what is needed:
     *   - tail-only change (forming candle updated) → re-fold from that index
     *   - append (history extended or new candle) → fold the new candles
     *   - prepend/replace (history loaded earlier, symbol reload) → full fold
     */
    setSeries(candles: readonly CoreCandle[]): SeriesUpdateReport {
        const prev = this.series;
        if (candles === prev) return { kind: "none", firstDiff: -1, folded: 0 };

        if (candles.length === 0) {
            this.series = candles;
            for (const entry of this.instances.values()) this.resetInstance(entry);
            return { kind: prev.length > 0 ? "reset" : "none", firstDiff: -1, folded: 0 };
        }

        if (prev.length === 0) {
            this.series = candles;
            this.foldAll(candles);
            return { kind: "initial", firstDiff: 0, folded: candles.length };
        }

        const minLen = Math.min(prev.length, candles.length);
        let firstDiff = 0;
        while (firstDiff < minLen && sameCandle(prev[firstDiff], candles[firstDiff])) firstDiff += 1;

        if (firstDiff === minLen && prev.length === candles.length) {
            // Identical content (possibly new object identities).
            this.series = candles;
            return { kind: "none", firstDiff: -1, folded: 0 };
        }

        // Incremental is only safe when everything BEFORE firstDiff is intact
        // and we still hold the state/checkpoint covering it:
        //   - pure append: state is "after prev last" (firstDiff === prev.length)
        //   - tail change (+ optional append): checkpoint is "before prev last"
        //     (firstDiff === prev.length - 1)
        const canIncrement =
            candles.length >= prev.length &&
            (firstDiff === prev.length || (firstDiff === prev.length - 1 && firstDiff < candles.length));

        this.series = candles;

        if (!canIncrement) {
            this.foldAll(candles);
            return { kind: "full", firstDiff, folded: candles.length };
        }

        let folded = 0;
        for (const entry of this.instances.values()) {
            // Restore the state as it was before candle `firstDiff`.
            if (firstDiff === prev.length - 1) {
                entry.state = entry.runtime.clone(entry.checkpoint);
            }
            this.foldRange(entry, firstDiff, candles.length - 1, candles, false);
            folded += candles.length - firstDiff;
        }
        return { kind: "incremental", firstDiff, folded };
    }

    // ── reads ──────────────────────────────────────────────────────────────

    /** Timestamp-anchored rows for an instance (empty when unknown). */
    get(ref: IndicatorRef): IndicatorResult[] {
        return this.instances.get(IndicatorEngine.keyOf(ref))?.results ?? [];
    }

    /** Rows by exact instance key (see `instanceKeys` / `describeInstances`). */
    getByKey(key: string): IndicatorResult[] {
        return this.instances.get(key)?.results ?? [];
    }

    /** Introspection for the developer/debug inspector. */
    describeInstances(): Array<{
        key: string;
        id: string;
        name: string;
        params: Record<string, number>;
        version: string;
        rows: number;
        firstValue: number | null;
        lastValue: number | null;
    }> {
        const out: Array<{
            key: string;
            id: string;
            name: string;
            params: Record<string, number>;
            version: string;
            rows: number;
            firstValue: number | null;
            lastValue: number | null;
        }> = [];
        for (const entry of this.instances.values()) {
            const first = entry.results[0]?.values;
            const last = entry.results[entry.results.length - 1]?.values;
            const firstOutput = entry.def.outputs[0]?.key;
            const fv = first && firstOutput !== undefined ? first[firstOutput] ?? null : null;
            const lv = last && firstOutput !== undefined ? last[firstOutput] ?? null : null;
            out.push({
                key: entry.key,
                id: entry.def.id,
                name: entry.def.name,
                params: { ...entry.params },
                version: entry.def.version,
                rows: entry.results.length,
                firstValue: fv ?? null,
                lastValue: lv ?? null,
            });
        }
        return out;
    }

    /** Latest row (the forming candle's values) or null. */
    latest(ref: IndicatorRef): IndicatorResult | null {
        const rows = this.get(ref);
        return rows.length > 0 ? rows[rows.length - 1] : null;
    }

    /** Values for one candle timestamp (binary search). Null when unknown. */
    at(ref: IndicatorRef, timestamp: number): Record<string, number | null> | null {
        const rows = this.get(ref);
        if (rows.length === 0) return null;
        let lo = 0;
        let hi = rows.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const ts = rows[mid].timestamp;
            if (ts === timestamp) return rows[mid].values;
            if (ts < timestamp) lo = mid + 1;
            else hi = mid - 1;
        }
        return null;
    }

    /**
     * One output as an array aligned 1:1 with `timestamps`, looked up by
     * timestamp so a historical prepend can never shift the line.
     */
    getOutputAligned(ref: IndicatorRef, output: string, timestamps: readonly number[]): Array<number | null> {
        const rows = this.get(ref);
        const out: Array<number | null> = new Array(timestamps.length).fill(null);
        if (rows.length === 0) return out;
        let ri = 0;
        for (let i = 0; i < timestamps.length; i++) {
            const ts = timestamps[i];
            while (ri < rows.length && rows[ri].timestamp < ts) ri += 1;
            if (ri >= rows.length) break;
            if (rows[ri].timestamp === ts) out[i] = rows[ri].values[output] ?? null;
        }
        return out;
    }

    /** All outputs aligned 1:1 with `timestamps`. */
    getAllAligned(ref: IndicatorRef, timestamps: readonly number[]): Array<Record<string, number | null>> {
        const rows = this.get(ref);
        const out: Array<Record<string, number | null>> = new Array(timestamps.length);
        let ri = 0;
        for (let i = 0; i < timestamps.length; i++) {
            const ts = timestamps[i];
            while (ri < rows.length && rows[ri].timestamp < ts) ri += 1;
            out[i] = ri < rows.length && rows[ri].timestamp === ts ? rows[ri].values : {};
        }
        return out;
    }

    get length(): number {
        return this.series.length;
    }

    // ── internals ──────────────────────────────────────────────────────────

    private buildInstance(key: string, id: string, params: Record<string, number>): InstanceEntry {
        const def = indicatorRegistry.get(id);
        if (!def) throw new Error(`[market-core] unknown indicator "${id}"`);
        const runtime = def.create(params) as IndicatorRuntime<unknown>;
        return {
            key,
            def,
            params,
            runtime,
            state: runtime.initialState(),
            checkpoint: runtime.initialState(),
            results: [],
        };
    }

    private resetInstance(entry: InstanceEntry): void {
        entry.state = entry.runtime.initialState();
        entry.checkpoint = entry.runtime.initialState();
        entry.results = [];
    }

    private foldAll(candles: readonly CoreCandle[]): void {
        for (const entry of this.instances.values()) this.foldRange(entry, 0, candles.length - 1, candles, true);
    }

    /**
     * Fold `[from, to]` inclusive. When `resetRows` is true the whole rows
     * array is rebuilt; otherwise rows before `from` are preserved as-is.
     */
    private foldRange(
        entry: InstanceEntry,
        from: number,
        to: number,
        candles: readonly CoreCandle[],
        resetRows: boolean,
    ): void {
        const list = candles;
        if (list.length === 0) {
            this.resetInstance(entry);
            return;
        }
        if (resetRows) {
            entry.state = entry.runtime.initialState();
            entry.results = new Array(list.length);
        } else if (entry.results.length > from) {
            entry.results.length = from;
        }
        const start = Math.max(0, from);
        for (let i = start; i <= to && i < list.length; i++) {
            if (i === list.length - 1) {
                // Checkpoint the pre-candle state so a later tick on this
                // same forming candle can re-fold from here.
                entry.checkpoint = entry.runtime.clone(entry.state);
            }
            const candle = list[i];
            const values = entry.runtime.step(entry.state, candle);
            entry.results[i] = { timestamp: candle.timestamp, values };
        }
    }
}

/**
 * Memoized one-shot computation: canonical math for callers that do not need
 * a persistent engine (chart layers, AI confluence, quick adapters).
 *
 * Results are cached per candle-snapshot identity + instance params, so a
 * render loop that receives the same canonical snapshot re-uses the rows
 * instead of re-folding. The cache dies with the snapshot (WeakMap).
 */
const alignedCache = new WeakMap<readonly CoreCandle[], Map<string, Array<number | null>>>();

export function alignedIndicatorSeries(
    candles: readonly CoreCandle[],
    ref: IndicatorRef,
    output?: string,
): Array<number | null> {
    if (candles.length === 0) return [];
    const def = indicatorRegistry.get(ref.id);
    if (!def) return new Array(candles.length).fill(null);
    const params: Record<string, number> = {};
    for (const spec of def.params) {
        params[spec.key] = Number.isFinite(ref.params?.[spec.key]) ? ref.params![spec.key] : spec.default;
    }
    const outputKey = output ?? def.outputs[0]?.key ?? "value";
    const cacheKey = `${ref.id}|${paramsKey(params, def)}|${outputKey}`;

    let byKey = alignedCache.get(candles);
    if (!byKey) {
        byKey = new Map();
        alignedCache.set(candles, byKey);
    }
    const cached = byKey.get(cacheKey);
    if (cached) return cached;

    const first = candles[0];
    const engine = new IndicatorEngine({
        symbol: first.symbol ?? "UNKNOWN",
        timeframe: first.timeframe ?? "M5",
        indicators: [{ id: ref.id, params }],
    });
    engine.setSeries(candles);
    const aligned = engine.getOutputAligned({ id: ref.id, params }, outputKey, candles.map((c) => c.timestamp));
    byKey.set(cacheKey, aligned);
    return aligned;
}

// ── multi-timeframe mapping ────────────────────────────────────────────────

/**
 * Map higher-timeframe indicator rows onto a base timeline by TIMESTAMP
 * (last HTF row whose open time ≤ base candle open time), never by array
 * index. Before the first HTF row the value is null.
 */
export function mapToTimeline(
    baseTimestamps: readonly number[],
    htfRows: readonly IndicatorResult[],
): Array<Record<string, number | null>> {
    const out: Array<Record<string, number | null>> = new Array(baseTimestamps.length);
    let hi = 0;
    for (let i = 0; i < baseTimestamps.length; i++) {
        const ts = baseTimestamps[i];
        while (hi + 1 < htfRows.length && htfRows[hi + 1].timestamp <= ts) hi += 1;
        out[i] = htfRows.length > 0 && htfRows[hi].timestamp <= ts ? htfRows[hi].values : {};
    }
    return out;
}
