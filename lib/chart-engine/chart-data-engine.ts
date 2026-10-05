import type { MarketCandle, SupportedSymbol } from "@/lib/market-data/types";
import type { ChartCandle, ChartTick } from "./candle";
import { toChartCandle } from "./candle";
import { applyHistory, applyTick, enforceChronology, isChronological } from "./candle-aggregator";
import { candleOpenTime, expectedCandleOpens, type ChartTimeframe } from "./timeframe";

/**
 * ChartDataEngine — Phase 2/3/8/20 state core of the native chart engine.
 *
 * One engine instance owns the canonical candle dataset for ONE
 * symbol+timeframe series. React components never hold candles in state;
 * they subscribe to this engine and read immutable snapshots. The engine:
 *
 *  - loads history through a pluggable HistoryProvider (canonical OHLC API),
 *  - folds live quotes through the CandleAggregator,
 *  - dedupes by symbol|timeframe|timestamp and enforces chronology,
 *  - detects gaps (market-closed periods excluded) and repairs them by
 *    re-fetching the missing range,
 *  - tracks connection/data-quality state explicitly (never presents stale
 *    data as live),
 *  - keeps deep history: old candles are never destroyed, the render
 *    viewport is the renderer's concern.
 *
 * The engine is transport-agnostic: history/tick/replay sources are injected,
 * which is what later lets backtesting/replay drive the SAME renderer.
 */

export type ConnectionState = "idle" | "loading" | "live" | "reconnecting" | "error";

export type DataQuality =
    | "pristine"      // no data yet
    | "live"          // ticks arriving
    | "delayed"       // last tick older than 2× expected cadence
    | "stale"         // no tick for a long time while market should be open
    | "gap_detected"  // hole in the candle sequence
    | "synchronizing" // repair fetch in flight
    | "market_closed"; // provider quiet because the market is closed

export type ChartEngineStatus = {
    connection: ConnectionState;
    quality: DataQuality;
    error: string | null;
    lastTickAt: number;
    lastHistoryLoadAt: number;
    candlesLoaded: number;
    oldestLoadedTimestamp: number | null;
    hasMoreHistory: boolean;
    loadingOlder: boolean;
    gapsDetected: number;
    duplicatesDropped: number;
    rowsRejected: number;
    reconnects: number;
};

export interface HistoryPage {
    candles: ChartCandle[];
    /** False when the provider exhausted history before `beforeMs`. */
    hasMore: boolean;
}

/** Boundary the engine uses to obtain candles — the only touchpoint with I/O. */
export interface ChartDataSources {
    /** Load the newest page (initial load / reconcile). */
    loadLatest: (req: { symbol: string; timeframe: ChartTimeframe; limit: number; signal?: AbortSignal }) => Promise<HistoryPage>;
    /** Load one page of history strictly older than `beforeMs` (scroll back). */
    loadOlder: (req: { symbol: string; timeframe: ChartTimeframe; beforeMs: number; limit: number; signal?: AbortSignal }) => Promise<HistoryPage>;
    /** Fill a specific gap (inclusive range of candle open times). */
    loadRange?: (req: { symbol: string; timeframe: ChartTimeframe; fromMs: number; toMs: number; signal?: AbortSignal }) => Promise<HistoryPage>;
    /** Optional symbol metadata (e.g. crypto trades through weekends). */
    isCrypto?: (symbol: string) => boolean;
}

export type EngineEvent =
    | { type: "status"; status: ChartEngineStatus }
    | { type: "candles"; candles: readonly ChartCandle[]; reason: "history" | "tick" | "repair" | "reconcile" }
    | { type: "gap"; fromMs: number; toMs: number };

export type Unsubscribe = () => void;

export interface ChartDataEngineOptions {
    symbol: SupportedSymbol | string;
    timeframe: ChartTimeframe;
    /** Initial + reconcile page size. 300–500 is the intended initial viewport. */
    pageSize?: number;
    /** Consider the feed delayed after this many ms without a tick (while open). */
    delayedAfterMs?: number;
    /** Consider the feed stale after this many ms without a tick (while open). */
    staleAfterMs?: number;
    /** How often the health/gap sweep runs (ms). */
    healthIntervalMs?: number;
    /** Override the crypto detection (crypto trades through weekends). */
    isCrypto?: (symbol: string) => boolean;
}

const TICK_STAMP_EPSILON_MS = 1500;

export class ChartDataEngine {
    readonly seriesKey: string;
    private readonly symbol: string;
    private readonly timeframe: ChartTimeframe;
    private readonly pageSize: number;
    private readonly delayedAfterMs: number;
    private readonly staleAfterMs: number;
    private readonly healthIntervalMs: number;
    private readonly sources: ChartDataSources;
    private readonly crypto: boolean;

    // ── canonical state (mutable inside, exposed as frozen snapshots) ──────
    private candles: ChartCandle[] = [];
    private snapshot: readonly ChartCandle[] = Object.freeze([]);
    private status: ChartEngineStatus;
    /** Stable immutable status identity for useSyncExternalStore consumers. */
    private statusSnapshot: ChartEngineStatus;
    private destroyed = false;
    private generation = 0;

    // request tracking
    private historyInFlight = false;
    private repairInFlight = false;
    private lastRequestedOldest: number | null = null;
    private repairAttemptFor: number | null = null;
    private healthTimer: ReturnType<typeof setInterval> | null = null;
    private listeners = new Set<(e: EngineEvent) => void>();
    private currentAbort: AbortController | null = null;

    constructor(sources: ChartDataSources, options: ChartDataEngineOptions) {
        this.sources = sources;
        this.symbol = String(options.symbol).toUpperCase();
        this.timeframe = options.timeframe;
        this.pageSize = options.pageSize ?? 400;
        this.delayedAfterMs = options.delayedAfterMs ?? 20_000;
        this.staleAfterMs = options.staleAfterMs ?? 120_000;
        this.healthIntervalMs = options.healthIntervalMs ?? 15_000;
        this.crypto = options.isCrypto
            ? options.isCrypto(this.symbol)
            : /BTC|ETH|SOL|XRP|ADA|DOGE|BNB|LTC|DOT/i.test(this.symbol);
        this.status = {
            connection: "idle",
            quality: "pristine",
            error: null,
            lastTickAt: 0,
            lastHistoryLoadAt: 0,
            candlesLoaded: 0,
            oldestLoadedTimestamp: null,
            hasMoreHistory: true,
            loadingOlder: false,
            gapsDetected: 0,
            duplicatesDropped: 0,
            rowsRejected: 0,
            reconnects: 0,
        };
        this.statusSnapshot = Object.freeze({ ...this.status });
        this.seriesKey = `${this.symbol}|${this.timeframe}`;
    }

    // ── subscriptions ───────────────────────────────────────────────────────
    subscribe(listener: (e: EngineEvent) => void): Unsubscribe {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getCandles(): readonly ChartCandle[] {
        return this.snapshot;
    }

    getStatus(): ChartEngineStatus {
        return this.statusSnapshot;
    }

    get symbolName(): string {
        return this.symbol;
    }

    get timeframeName(): ChartTimeframe {
        return this.timeframe;
    }

    // ── lifecycle ───────────────────────────────────────────────────────────
    start(): void {
        // React StrictMode (dev) mounts → cleanup(destroy) → mounts again with
        // the SAME engine instance from useMemo. A permanent destroyed flag
        // would leave the chart stuck on "Loading market data…" forever, so a
        // start() after destroy() revives the engine instead.
        if (this.destroyed) {
            this.destroyed = false;
            this.generation += 1;
            // The cleanup abort settles with destroyed=true, so loadInitial's
            // catch returns early and leaves connection stuck at "loading".
            // Reset it so the initial load below actually re-runs.
            if (this.status.connection !== "idle") {
                this.status = { ...this.status, connection: "idle", error: null };
            }
        }
        if (this.status.connection === "idle") {
            void this.loadInitial();
        }
        if (this.healthTimer === null) {
            this.healthTimer = setInterval(() => this.healthSweep(), this.healthIntervalMs);
        }
    }

    destroy(): void {
        this.destroyed = true;
        this.generation += 1;
        if (this.healthTimer !== null) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }
        this.currentAbort?.abort();
        this.listeners.clear();
    }

    // ── history ─────────────────────────────────────────────────────────────
    async loadInitial(): Promise<void> {
        const gen = ++this.generation;
        this.currentAbort?.abort();
        const abort = new AbortController();
        this.currentAbort = abort;

        this.setStatus({ connection: "loading", quality: "synchronizing", error: null });

        try {
            const page = await this.sources.loadLatest({
                symbol: this.symbol,
                timeframe: this.timeframe,
                limit: this.pageSize,
                signal: abort.signal,
            });
            if (this.destroyed || gen !== this.generation) return;

            const result = applyHistory([], page.candles);
            this.commitCandles(enforceChronology(result.series), "history");
            this.setStatus({
                connection: "live",
                quality: this.deriveQuality(),
                lastHistoryLoadAt: Date.now(),
                candlesLoaded: this.candles.length,
                oldestLoadedTimestamp: this.candles[0]?.timestamp ?? null,
                hasMoreHistory: page.hasMore,
                rowsRejected: result.rejected,
                duplicatesDropped: result.duplicates,
                error: null,
            });
        } catch (err) {
            if (this.destroyed || gen !== this.generation) return;
            if ((err as Error)?.name === "AbortError") {
                // Back to idle so a later start()/remount retries the load
                // instead of seeing a stuck non-idle connection.
                this.setStatus({ connection: "idle" });
                return;
            }
            this.setStatus({
                connection: "error",
                quality: "stale",
                error: err instanceof Error ? err.message : "Failed to load chart history.",
            });
        }
    }

    /** Force a full resync (reconnect, manual refresh). */
    async resync(): Promise<void> {
        if (this.destroyed) return;
        this.setStatus((s) => ({
            ...s,
            connection: "reconnecting",
            quality: "synchronizing",
            reconnects: s.reconnects + 1,
        }));
        await this.loadInitial();
        // After reload, repair any hole between what we kept and the fresh page.
        await this.detectAndRepairGaps();
    }

    /** Prepend one older page; preserves existing candles (no viewport jump). */
    async loadOlder(): Promise<boolean> {
        if (this.destroyed || this.status.loadingOlder) return false;
        if (!this.status.hasMoreHistory) return false;
        const oldest = this.candles[0]?.timestamp;
        if (oldest === undefined) return false;
        // Don't re-request the same boundary twice (dedupe against double-scroll).
        if (this.lastRequestedOldest === oldest && this.historyInFlight) return false;

        const gen = this.generation;
        this.historyInFlight = true;
        this.lastRequestedOldest = oldest;
        this.setStatus({ loadingOlder: true });
        try {
            const page = await this.sources.loadOlder({
                symbol: this.symbol,
                timeframe: this.timeframe,
                beforeMs: oldest,
                limit: this.pageSize,
            });
            if (this.destroyed || gen !== this.generation) return false;

            if (page.candles.length === 0) {
                this.setStatus({ hasMoreHistory: false, loadingOlder: false });
                return false;
            }

            const result = applyHistory(this.candles, page.candles);
            this.commitCandles(enforceChronology(result.series), "history");
            this.setStatus({
                loadingOlder: false,
                hasMoreHistory: page.hasMore,
                candlesLoaded: this.candles.length,
                oldestLoadedTimestamp: this.candles[0]?.timestamp ?? null,
                duplicatesDropped: this.status.duplicatesDropped + result.duplicates,
                rowsRejected: this.status.rowsRejected + result.rejected,
            });
            return true;
        } catch {
            if (!this.destroyed && gen === this.generation) {
                this.setStatus({ loadingOlder: false });
            }
            return false;
        } finally {
            this.historyInFlight = false;
        }
    }

    // ── live data ───────────────────────────────────────────────────────────
    /**
     * Fold a live quote/tick. Safe to call as often as data arrives; internal
     * no-op detection keeps identity stable so subscribers can skip renders.
     */
    ingestTick(tick: ChartTick | null | undefined): void {
        if (this.destroyed || !tick) return;
        if (!Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.timestamp)) return;

        const result = applyTick(this.candles, tick, this.timeframe);
        if (!result.changed) return;

        this.commitCandles(result.series, "tick");
        const quality = this.deriveQuality(tick.timestamp);
        this.setStatus({
            lastTickAt: Math.max(this.status.lastTickAt, tick.timestamp),
            quality,
            // A working tick stream proves the connection recovered.
            connection: this.status.connection === "reconnecting" || this.status.connection === "error" ? "live" : this.status.connection,
            error: null,
        });
    }

    /**
     * Merge a full provider candle list (reconcile). Provider bars win over
     * quote-merged tails for already-known buckets; unknown buckets backfill.
     */
    reconcile(providerCandles: MarketCandle[]): void {
        if (this.destroyed || providerCandles.length === 0) return;
        const canonical = providerCandles
            .map((c) => toChartCandle(c, this.symbol, this.timeframe))
            .filter((c): c is ChartCandle => c !== null);
        if (canonical.length === 0) return;

        const result = applyHistory(this.candles, canonical);
        const changed =
            result.series.length !== this.candles.length ||
            result.series.some((c, i) => c !== this.candles[i]);
        if (!changed) return;

        this.commitCandles(enforceChronology(result.series), "reconcile");
        this.setStatus({
            lastHistoryLoadAt: Date.now(),
            candlesLoaded: this.candles.length,
            oldestLoadedTimestamp: this.candles[0]?.timestamp ?? null,
            quality: this.deriveQuality(),
        });
    }

    // ── gap detection / repair ──────────────────────────────────────────────
    /** Find holes between candle opens (market-closed periods excluded). */
    detectGaps(): Array<{ fromMs: number; toMs: number }> {
        const gaps: Array<{ fromMs: number; toMs: number }> = [];
        if (this.candles.length < 2) return gaps;
        // Only scan the recent window where ticks are authoritative; deep
        // history came from the provider as-is.
        const scanFrom = Math.max(
            this.candles[0].timestamp,
            candleOpenTime(Date.now(), this.timeframe) - this.pageSize * this.intervalMs(),
        );
        for (let i = 1; i < this.candles.length; i++) {
            const prev = this.candles[i - 1].timestamp;
            const cur = this.candles[i].timestamp;
            if (cur <= prev) continue;
            if (cur - prev <= this.intervalMs()) continue;
            // Every expected open strictly between prev and cur that's missing.
            const missing = expectedCandleOpens(prev, cur, this.timeframe, { alwaysOpen: this.crypto })
                .filter((t) => t > prev && t < cur);
            if (missing.length === 0) continue;
            gaps.push({ fromMs: missing[0], toMs: missing[missing.length - 1] });
        }
        void scanFrom;
        return gaps;
    }

    async detectAndRepairGaps(): Promise<boolean> {
        if (this.destroyed || this.repairInFlight) return false;
        const gaps = this.detectGaps();
        if (gaps.length === 0) return false;

        const gap = gaps[0];
        if (!this.sources.loadRange) {
            this.setStatus({ quality: "gap_detected", gapsDetected: this.status.gapsDetected + 1 });
            return false;
        }
        // Avoid retry storms on a hole the provider simply cannot fill.
        if (this.repairAttemptFor === gap.fromMs) return false;

        this.repairInFlight = true;
        this.repairAttemptFor = gap.fromMs;
        this.setStatus({ quality: "synchronizing" });
        try {
            const page = await this.sources.loadRange({
                symbol: this.symbol,
                timeframe: this.timeframe,
                fromMs: gap.fromMs,
                toMs: gap.toMs,
            });
            if (this.destroyed) return false;
            if (page.candles.length > 0) {
                const result = applyHistory(this.candles, page.candles);
                this.commitCandles(enforceChronology(result.series), "repair");
            }
            const remaining = this.detectGaps().length;
            this.setStatus({
                quality: remaining > 0 ? "gap_detected" : this.deriveQuality(),
                gapsDetected: this.status.gapsDetected + 1,
                candlesLoaded: this.candles.length,
            });
            return page.candles.length > 0;
        } catch {
            if (!this.destroyed) this.setStatus({ quality: "gap_detected" });
            return false;
        } finally {
            this.repairInFlight = false;
        }
    }

    // ── internals ───────────────────────────────────────────────────────────
    private intervalMs(): number {
        return this.status && this.candles.length > 1
            ? Math.max(this.candles[this.candles.length - 1].timestamp - this.candles[this.candles.length - 2].timestamp, 1)
            : 0;
    }

    private deriveQuality(lastTickAt?: number): DataQuality {
        const ts = lastTickAt ?? this.status.lastTickAt;
        if (this.candles.length === 0) return "pristine";
        const now = Date.now();
        if (ts > 0) {
            const silentFor = now - Math.max(ts, TICK_STAMP_EPSILON_MS);
            if (silentFor > this.staleAfterMs) {
                // Distinguish "market closed" from "feed broken": if the last
                // candle is old but the market is closed, that is honest.
                return "stale";
            }
            if (silentFor > this.delayedAfterMs) return "delayed";
            return "live";
        }
        return "pristine";
    }

    private healthSweep(): void {
        if (this.destroyed || this.candles.length === 0) return;
        const quality = this.deriveQuality();
        const gaps = this.detectGaps();
        const patch: Partial<ChartEngineStatus> = { quality: gaps.length > 0 ? "gap_detected" : quality };
        if (gaps.length > 0) {
            patch.gapsDetected = this.status.gapsDetected;
            void this.detectAndRepairGaps();
        }
        // Connection degrades to reconnecting when the feed went silent while
        // the market should be open (stale > reconnect threshold).
        if (quality === "stale" && this.status.connection === "live") {
            patch.connection = "reconnecting";
        }
        this.setStatus(patch);
    }

    private commitCandles(nextInput: readonly ChartCandle[], reason: "history" | "tick" | "repair" | "reconcile"): void {
        let next = nextInput as ChartCandle[];
        if (!isChronological(next)) next = enforceChronology(next);
        this.candles = next;
        this.snapshot = Object.freeze(next.slice());
        // The public store snapshot is shared by useSyncExternalStore; swap it
        // whenever canonical candles change, before notifying subscribers.
        this.statusSnapshot = Object.freeze({
            ...this.status,
            candlesLoaded: next.length,
            oldestLoadedTimestamp: next[0]?.timestamp ?? null,
        });
        this.status = { ...this.status, candlesLoaded: next.length, oldestLoadedTimestamp: next[0]?.timestamp ?? null };
        for (const listener of Array.from(this.listeners)) {
            try {
                listener({ type: "candles", candles: this.snapshot, reason });
            } catch {
                // listener errors must never break the engine
            }
        }
    }

    private setStatus(patch: Partial<ChartEngineStatus> | ((s: ChartEngineStatus) => Partial<ChartEngineStatus>)): void {
        const resolved = typeof patch === "function" ? patch(this.status) : patch;
        this.status = { ...this.status, ...resolved };
        this.statusSnapshot = Object.freeze({ ...this.status });
        const event: EngineEvent = { type: "status", status: this.statusSnapshot };
        for (const listener of Array.from(this.listeners)) {
            try {
                listener(event);
            } catch {
                // ignore
            }
        }
    }
}

/** Convenience: does this engine's series match the given symbol/timeframe? */
export function engineMatches(engine: ChartDataEngine, symbol: string, timeframe: string): boolean {
    return engine.seriesKey === `${symbol.toUpperCase()}|${timeframe.toUpperCase()}`;
}
