import type { MarketCandle, SupportedSymbol } from "@/lib/market-data/types";
import { candlesEqual, toChartCandle, type ChartCandle, type ChartTick } from "./candle";
import { applyHistory, applyTick, enforceChronology, indexAtOrBefore, isChronological } from "./candle-aggregator";
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
    /**
     * Why (or why not) more history can be loaded — Phase 1 failure semantics.
     *  unknown       → nothing probed yet
     *  has_more      → the provider reports more pages
     *  exhausted     → the provider authoritatively has nothing older
     *  unavailable   → history is temporarily unavailable (rate limit,
     *                  auth, network). NOT a boundary: the engine backs off
     *                  for a cooldown, then retries — it never latches
     *                  hasMoreHistory=false on a transient failure.
     */
    historyAvailability: HistoryAvailability;
    loadingOlder: boolean;
    gapsDetected: number;
    duplicatesDropped: number;
    rowsRejected: number;
    reconnects: number;
};

export type HistoryAvailability = "unknown" | "has_more" | "exhausted" | "unavailable";

export interface HistoryPage {
    candles: ChartCandle[];
    /** False when the provider exhausted history before `beforeMs`. */
    hasMore: boolean;
    /**
     * Optional explicit boundary from the data source. When present it wins
     * over the empty-page heuristic so a transient provider failure is never
     * reported as "no more history".
     */
    boundary?: "more" | "exhausted" | "unavailable";
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

/**
 * Minimum wait before re-attempting a repair for the SAME hole. One attempt
 * per hole, then a cooldown — a provider that cannot fill a range must not be
 * polled for it on every health sweep (retry storm), but a later retry can
 * still heal a hole the shallow window covered in the meantime.
 */
const REPAIR_RETRY_MS = 60_000;

/**
 * Phase 1 bounded history prefetch: a threshold crossing fetches at most
 * this many pages (each one engine pageSize — never one enormous request).
 */
const MAX_PREFETCH_PAGES = 3;

/**
 * Scroll-back buffer a prefetch aims for. Converted to a page count through
 * the engine's own pageSize, so the bound is derived rather than hardcoded
 * per call site: pages = clamp(ceil(PREFETCH_TARGET_BARS / pageSize), 1, 3).
 */
const PREFETCH_TARGET_BARS = 1000;

/**
 * Backoff before re-attempting history after a transient failure (network,
 * rate limit, provider outage). During the cooldown the engine reports
 * "temporarily unavailable" — hasMoreHistory stays true and no request is
 * issued — so the chart neither latches "no more history" nor hammers the
 * provider on every scroll event.
 */
const HISTORY_RETRY_COOLDOWN_MS = 20_000;

/**
 * True when the series differs in length, in any candle's values, or in a
 * finalize flag. Used to skip snapshot publication for no-op merges (an
 * identical provider response or an all-duplicate history page must not
 * notify React subscribers).
 */
function seriesDiffers(next: readonly ChartCandle[], prev: readonly ChartCandle[]): boolean {
    if (next.length !== prev.length) return true;
    for (let i = 0; i < next.length; i++) {
        const a = next[i];
        const b = prev[i];
        if (a === b) continue;
        if (a.finalized !== b.finalized) return true;
        if (!candlesEqual(a, b)) return true;
    }
    return false;
}

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
    private repairAttemptAt = 0;
    /** Earliest time a history request may be retried after a failure. */
    private historyRetryAt = 0;
    /** When the in-flight reconcile/resync request began (wall clock). */
    private reconcileRequestStartedAt = 0;
    private healthTimer: ReturnType<typeof setInterval> | null = null;
    private listeners = new Set<(e: EngineEvent) => void>();
    /** Every in-flight I/O request — aborted together on epoch changes. */
    private activeRequests = new Set<AbortController>();

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
            historyAvailability: "unknown",
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
        this.abortActiveRequests();
        this.listeners.clear();
    }

    // ── request/abort bookkeeping ───────────────────────────────────────────────
    /** Register an in-flight request so epoch changes can cancel it. */
    private beginRequest(): AbortController {
        const controller = new AbortController();
        this.activeRequests.add(controller);
        return controller;
    }

    private endRequest(controller: AbortController): void {
        this.activeRequests.delete(controller);
    }

    /** Cancel every in-flight request (epoch change: load/resync/destroy). */
    private abortActiveRequests(): void {
        for (const controller of this.activeRequests) controller.abort();
        this.activeRequests.clear();
    }

    // ── history ─────────────────────────────────────────────────────────────
    async loadInitial(): Promise<void> {
        const gen = ++this.generation;
        this.abortActiveRequests();
        const abort = this.beginRequest();

        this.setStatus({ connection: "loading", quality: "synchronizing", error: null, loadingOlder: false });

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
                historyAvailability: page.hasMore ? "has_more" : "exhausted",
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
        } finally {
            this.endRequest(abort);
        }
    }

    /**
     * Force a full resync (reconnect, manual refresh).
     *
     * With an EMPTY dataset this is the initial canonical load. With data on
     * screen it RECONCILES instead: the fresh newest page is merged through
     * `reconcile()` so provider bars stay authoritative for the buckets they
     * cover, deep paged history and the live-merged forming bar survive the
     * reconnect, no duplicate bars can appear (applyHistory dedupes by candle
     * key + enforceChronology on commit), and the viewport is not reset by a
     * wholesale dataset swap. Gap repair still runs afterwards.
     */
    async resync(): Promise<void> {
        if (this.destroyed) return;
        this.setStatus((s) => ({
            ...s,
            connection: "reconnecting",
            quality: "synchronizing",
            reconnects: s.reconnects + 1,
            // A new epoch begins: any in-flight older-page load is cancelled
            // and its stale result must not leave loadingOlder latched.
            loadingOlder: false,
        }));
        if (this.candles.length === 0) {
            await this.loadInitial();
            await this.detectAndRepairGaps();
            return;
        }

        // Reconcile path — mirrors loadInitial's generation/status contract so
        // an in-flight older-page load cannot commit after the reconnect.
        const gen = ++this.generation;
        this.abortActiveRequests();
        const abort = this.beginRequest();
        // Marks when the provider snapshot began: a live tick arriving after
        // this moment is NEWER than the page and stays authoritative for the
        // forming bucket (see reconcile).
        const requestStartedAt = Date.now();
        this.reconcileRequestStartedAt = requestStartedAt;
        try {
            const page = await this.sources.loadLatest({
                symbol: this.symbol,
                timeframe: this.timeframe,
                limit: this.pageSize,
                signal: abort.signal,
            });
            if (this.destroyed || gen !== this.generation) return;
            this.reconcile(page.candles);
            this.setStatus({
                connection: "live",
                quality: this.deriveQuality(),
                lastHistoryLoadAt: Date.now(),
                candlesLoaded: this.candles.length,
                oldestLoadedTimestamp: this.candles[0]?.timestamp ?? null,
                hasMoreHistory: page.hasMore,
                historyAvailability: page.hasMore ? "has_more" : "exhausted",
                error: null,
            });
        } catch (err) {
            if (this.destroyed || gen !== this.generation) return;
            this.setStatus({
                connection: "error",
                quality: "stale",
                error: err instanceof Error ? err.message : "Failed to load chart history.",
            });
        } finally {
            // Only clear our own marker — a superseded resync must not wipe
            // the marker of a newer one still in flight.
            if (this.reconcileRequestStartedAt === requestStartedAt) {
                this.reconcileRequestStartedAt = 0;
            }
            this.endRequest(abort);
        }
        // After the reload/reconcile, repair any hole between what we kept and
        // the fresh page.
        await this.detectAndRepairGaps();
    }

    /**
     * Bounded prefetch page count for one history-threshold crossing,
     * derived from the engine's own page size:
     *
     *   pages = clamp(ceil(PREFETCH_TARGET_BARS / pageSize), 1, MAX_PREFETCH_PAGES)
     *
     * so a threshold crossing buffers roughly PREFETCH_TARGET_BARS candles
     * through `pageSize × boundedPrefetchPages` requests instead of one
     * enormous request — and never more than MAX_PREFETCH_PAGES round trips.
     */
    get prefetchPages(): number {
        const size = Math.max(1, this.pageSize);
        return Math.min(MAX_PREFETCH_PAGES, Math.max(1, Math.ceil(PREFETCH_TARGET_BARS / size)));
    }

    /**
     * Prepend older history pages; preserves existing candles (no viewport jump).
     *
     * Phase 1 batch prefetch: when `options.pages > 1` (the scroll-threshold
     * path passes `prefetchPages`), pages are fetched SEQUENTIALLY with a
     * shared cursor, merged, deduped and committed as ONE canonical update —
     * a single snapshot publication and a single renderer viewport
     * compensation for the whole batch, never one per page.
     *
     * Failure semantics: a transient provider failure sets
     * historyAvailability="unavailable" with a cooldown — it NEVER latches
     * hasMoreHistory=false (only an authoritative empty/exhausted page does).
     */
    async loadOlder(options?: { pages?: number }): Promise<boolean> {
        if (this.destroyed || this.status.loadingOlder) return false;
        if (!this.status.hasMoreHistory) return false;
        // Back off after a transient failure instead of hammering the
        // provider on every scroll event (history stays available).
        if (this.status.historyAvailability === "unavailable" && Date.now() < this.historyRetryAt) {
            return false;
        }
        const oldest = this.candles[0]?.timestamp;
        if (oldest === undefined) return false;
        // Don't re-request the same boundary twice (dedupe against double-scroll).
        if (this.lastRequestedOldest === oldest && this.historyInFlight) return false;

        const pagesWanted = Math.min(MAX_PREFETCH_PAGES, Math.max(1, Math.floor(options?.pages ?? 1)));
        const gen = this.generation;
        const abort = this.beginRequest();
        this.historyInFlight = true;
        this.lastRequestedOldest = oldest;
        this.setStatus({ loadingOlder: true });

        try {
            let cursor = oldest;
            const incoming: ChartCandle[] = [];
            let boundary: "more" | "exhausted" | "unavailable" | undefined;
            let lastHasMore = false;

            for (let page = 0; page < pagesWanted; page++) {
                const result = await this.sources.loadOlder({
                    symbol: this.symbol,
                    timeframe: this.timeframe,
                    beforeMs: cursor,
                    limit: this.pageSize,
                    signal: abort.signal,
                });
                // A stale/aborted request must never mutate the new chart
                // state (symbol/timeframe switch, resync, destroy).
                if (this.destroyed || gen !== this.generation) return false;

                if (result.boundary !== undefined) boundary = result.boundary;
                lastHasMore = result.hasMore;
                if (result.candles.length === 0) break; // authoritative end (or failure, per boundary)

                const pageOldest = Math.min(...result.candles.map((c) => c.timestamp));
                if (!(pageOldest < cursor)) break; // no forward progress — stop
                incoming.push(...result.candles);
                cursor = pageOldest;

                if (!result.hasMore) break;
                if (result.boundary === "exhausted") break;
            }

            // ── resolve history availability (Phase 1 failure semantics) ──
            let availability: HistoryAvailability;
            if (boundary === "unavailable") {
                // Transient provider failure — NOT a history boundary. Keep
                // hasMoreHistory true and back off for a cooldown.
                availability = "unavailable";
                this.historyRetryAt = Date.now() + HISTORY_RETRY_COOLDOWN_MS;
            } else if (
                boundary === "more" &&
                incoming.length > 0
            ) {
                availability = "has_more";
            } else if (
                incoming.length === 0 ||
                boundary === "exhausted" ||
                !lastHasMore
            ) {
                // Empty page without a failure marker / explicit exhaustion /
                // short last page: the honest end of available history.
                availability = "exhausted";
            } else {
                availability = "has_more";
            }

            const hasMoreNext = availability === "has_more" || availability === "unavailable";

            if (incoming.length === 0) {
                this.setStatus({
                    loadingOlder: false,
                    hasMoreHistory: hasMoreNext,
                    historyAvailability: availability,
                });
                return false;
            }

            const result = applyHistory(this.candles, incoming);
            const changed = seriesDiffers(result.series, this.candles);
            if (changed) {
                this.commitCandles(enforceChronology(result.series), "history");
            }
            this.setStatus({
                loadingOlder: false,
                hasMoreHistory: hasMoreNext,
                historyAvailability: availability,
                candlesLoaded: this.candles.length,
                oldestLoadedTimestamp: this.candles[0]?.timestamp ?? null,
                duplicatesDropped: this.status.duplicatesDropped + result.duplicates,
                rowsRejected: this.status.rowsRejected + result.rejected,
            });
            return changed;
        } catch {
            if (this.destroyed || gen !== this.generation) {
                // Stale/aborted: no mutation. The epoch that superseded this
                // request (loadInitial/resync) already reset loadingOlder.
                return false;
            }
            // Transient failure (network/HTTP error): history is temporarily
            // unavailable — back off and retry later instead of latching
            // "no more history".
            this.historyRetryAt = Date.now() + HISTORY_RETRY_COOLDOWN_MS;
            this.setStatus({
                loadingOlder: false,
                historyAvailability: "unavailable",
                hasMoreHistory: true,
            });
            return false;
        } finally {
            this.historyInFlight = false;
            this.endRequest(abort);
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
        // Hard no-future-leakage backstop: a tick stamped beyond the current
        // clock (beyond a small skew epsilon) must never open a candle bucket
        // in the future. quoteToTick already clamps at the transport
        // boundary; this guards the engine itself.
        if (tick.timestamp > Date.now() + TICK_STAMP_EPSILON_MS) return;

        const result = applyTick(this.candles, tick, this.timeframe);
        if (!result.changed) return;

        this.commitCandles(result.series, "tick");
        // Freshness answers "is data arriving?", so it is stamped at ARRIVAL.
        // Providers stamp the forming bar with its OPEN time (up to a full
        // period old), which graded a perfectly healthy feed as "delayed" for
        // most of every bar and then flipped it back to live — the visible
        // delayed → paused → live oscillation. The provider stamp still
        // buckets the candle (applyTick above); this only grades the feed.
        const arrivedAt = Date.now();
        const quality = this.deriveQuality(arrivedAt);
        this.setStatus({
            lastTickAt: Math.max(this.status.lastTickAt, arrivedAt),
            quality,
            // A working tick stream proves the connection recovered.
            connection: this.status.connection === "reconnecting" || this.status.connection === "error" ? "live" : this.status.connection,
            error: null,
        });
    }

    /**
     * Merge a full provider candle list (reconcile). Provider bars win over
     * quote-merged tails for already-known buckets; unknown buckets backfill.
     *
     * Phase 1 canonical rules:
     *  - HISTORY is authoritative for closed/previous bars.
     *  - LIVE ticks are authoritative for the CURRENT FORMING bar until
     *    history confirms it: a tick that arrived after this reconcile's
     *    provider request started is newer than the page, so the forming
     *    close is not walked backwards (high/low take the union).
     *  - Never duplicates, never backwards timestamps, never candles newer
     *    than the provider response, never client-clock inventions.
     *  - A response identical to the current series publishes nothing.
     */
    reconcile(providerCandles: MarketCandle[]): void {
        if (this.destroyed || providerCandles.length === 0) return;
        const canonical = providerCandles
            .map((c) => toChartCandle(c, this.symbol, this.timeframe))
            .filter((c): c is ChartCandle => c !== null);
        if (canonical.length === 0) return;

        const prevLast = this.candles.length > 0 ? this.candles[this.candles.length - 1] : null;
        const providerNewest = canonical[canonical.length - 1].timestamp;

        const result = applyHistory(this.candles, canonical);

        // HISTORY is authoritative for closed bars: a provider page that
        // extends beyond our tail confirms our former forming bucket closed
        // — finalize it wherever it sits after the merge. (Values identical
        // to the provider's own row: only the state flag changes.)
        if (prevLast && providerNewest > prevLast.timestamp) {
            const idx = indexAtOrBefore(result.series, prevLast.timestamp);
            if (idx >= 0 && result.series[idx].timestamp === prevLast.timestamp && !result.series[idx].finalized) {
                result.series[idx] = { ...result.series[idx], finalized: true };
            }
        }

        // A tick newer than the provider request stays authoritative for the
        // still-forming bucket (response-arriving-after-newer-tick race).
        const liveNewerThanPage =
            this.reconcileRequestStartedAt > 0 &&
            this.status.lastTickAt >= this.reconcileRequestStartedAt;
        if (liveNewerThanPage && this.candles.length > 0 && result.series.length > 0) {
            const liveLast = this.candles[this.candles.length - 1];
            const idx = result.series.length - 1;
            const mergedLast = result.series[idx];
            if (mergedLast.timestamp === liveLast.timestamp) {
                result.series[idx] = {
                    ...mergedLast,
                    high: Math.max(mergedLast.high, liveLast.high),
                    low: Math.min(mergedLast.low, liveLast.low),
                    close: liveLast.close,
                    volume: Math.max(mergedLast.volume ?? 0, liveLast.volume ?? 0),
                    finalized: liveLast.finalized,
                };
            }
        }

        // Publish only when candle VALUES actually changed — an identical
        // provider response must not churn React snapshots.
        const changed = seriesDiffers(result.series, this.candles);
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
        // Avoid retry storms on a hole the provider cannot fill: one attempt
        // per hole, then a cooldown before trying the same range again.
        if (
            this.repairAttemptFor === gap.fromMs &&
            Date.now() - this.repairAttemptAt < REPAIR_RETRY_MS
        ) {
            return false;
        }

        this.repairInFlight = true;
        this.repairAttemptFor = gap.fromMs;
        this.repairAttemptAt = Date.now();
        // Repair is generation-scoped: a resync/switch that bumps the
        // generation cancels this attempt so stale data can never land in
        // the new epoch.
        const gen = this.generation;
        const abort = this.beginRequest();
        this.setStatus({ quality: "synchronizing" });
        try {
            let filled = false;
            if (this.sources.loadRange) {
                try {
                    const page = await this.sources.loadRange({
                        symbol: this.symbol,
                        timeframe: this.timeframe,
                        fromMs: gap.fromMs,
                        toMs: gap.toMs,
                        signal: abort.signal,
                    });
                    if (this.destroyed || gen !== this.generation) return false;
                    if (page.candles.length > 0) {
                        const result = applyHistory(this.candles, page.candles);
                        if (seriesDiffers(result.series, this.candles)) {
                            this.commitCandles(enforceChronology(result.series), "repair");
                        }
                        filled = true;
                    }
                } catch {
                    // Range fill failed — the newest-page refill below can
                    // still cover holes inside the shallow window.
                }
            }
            if (!filled && !this.destroyed && gen === this.generation) {
                // Shallow providers (Biquote) answer no range queries, but
                // their newest page still contains recent bars — refill from
                // it so a hole the feed missed while quotes were down heals
                // instead of latching the chart into a permanent GAP state.
                filled = await this.refillFromNewest(gen, abort.signal);
            }
            if (this.destroyed || gen !== this.generation) return false;

            const remaining = this.detectGaps().length;
            this.setStatus({
                quality: remaining > 0 ? "gap_detected" : this.deriveQuality(),
                gapsDetected: this.status.gapsDetected + 1,
                candlesLoaded: this.candles.length,
                oldestLoadedTimestamp: this.candles[0]?.timestamp ?? null,
            });
            return filled;
        } catch {
            if (!this.destroyed) this.setStatus({ quality: "gap_detected" });
            return false;
        } finally {
            this.repairInFlight = false;
            this.endRequest(abort);
        }
    }

    /**
     * Newest-page refill — the fallback for providers that cannot answer a
     * range query. A hole inside the shallow window is present in the newest
     * page too, so re-fetching and merging it heals the gap (and the pause it
     * would otherwise keep re-triggering).
     */
    private async refillFromNewest(gen: number, signal?: AbortSignal): Promise<boolean> {
        if (this.destroyed) return false;
        try {
            const page = await this.sources.loadLatest({
                symbol: this.symbol,
                timeframe: this.timeframe,
                limit: this.pageSize,
                signal,
            });
            if (this.destroyed || gen !== this.generation) return false;
            if (page.candles.length === 0) return false;
            const result = applyHistory(this.candles, page.candles);
            const changed =
                result.series.length !== this.candles.length ||
                result.series.some((c, i) => c !== this.candles[i]);
            if (!changed) return false;
            this.commitCandles(enforceChronology(result.series), "repair");
            this.setStatus({
                lastHistoryLoadAt: Date.now(),
                candlesLoaded: this.candles.length,
                oldestLoadedTimestamp: this.candles[0]?.timestamp ?? null,
            });
            return true;
        } catch {
            return false;
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
