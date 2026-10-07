"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChartDataEngine, type ChartEngineStatus } from "./chart-data-engine";
import { createAdaptiveApiDataSources, quoteToTick } from "./data-sources";
import type { ChartCandle } from "./candle";
import type { ChartTimeframe } from "./timeframe";

/**
 * useChartEngine — Phase 9 data/render split for React.
 *
 * Components own RENDER state (viewport, crosshair, hover); this hook owns
 * DATA state. The engine holds the canonical candle series; React sees only
 * throttled immutable snapshots via useSyncExternalStore, so a burst of ticks
 * coalesces into at most one render per animation frame instead of re-render
 * storms.
 */

// ── module-level engine pool ────────────────────────────────────────────────
// Engines are shared per (symbol, timeframe) across all chart components so
// two charts on the same series share one poller and one dataset.
type PoolEntry = {
    engine: ChartDataEngine;
    refs: number;
    pollTimer: ReturnType<typeof setInterval> | null;
    pollBusy: boolean;
    lastTickAt: number;
    /** How many quote fetches this pool entry has issued (test observability). */
    quoteFetches: number;
};
const enginePool = new Map<string, PoolEntry>();
let deepHistoryFlag: boolean | null = null;
const EMPTY_CANDLES: readonly ChartCandle[] = Object.freeze([]);
const EMPTY_STATUS: ChartEngineStatus = Object.freeze({
    connection: "idle",
    quality: "pristine",
    error: null,
    lastTickAt: 0,
    lastHistoryLoadAt: 0,
    candlesLoaded: 0,
    oldestLoadedTimestamp: null,
    hasMoreHistory: false,
    historyAvailability: "unknown",
    loadingOlder: false,
    gapsDetected: 0,
    duplicatesDropped: 0,
    rowsRejected: 0,
    reconnects: 0,
});

/** Called once (server probe) to decide whether paging beyond Biquote works. */
export function setDeepHistoryAvailable(v: boolean): void {
    deepHistoryFlag = v;
}

function poolKey(symbol: string, timeframe: string): string {
    return `${symbol.toUpperCase()}|${timeframe.toUpperCase()}`;
}

function getEngineEntry(symbol: string, timeframe: ChartTimeframe, pageSize: number): PoolEntry {
    const key = poolKey(symbol, timeframe);
    let entry = enginePool.get(key);
    if (!entry) {
        const engine = new ChartDataEngine(createAdaptiveApiDataSources(), {
            symbol,
            timeframe,
            pageSize,
        });
        entry = { engine, refs: 0, pollTimer: null, pollBusy: false, lastTickAt: 0, quoteFetches: 0 };
        enginePool.set(key, entry);
    }
    return entry;
}

function subscribeEngine(
    entry: PoolEntry,
    symbol: string,
    timeframe: ChartTimeframe,
    pollMs: number,
    notify: () => void,
): () => void {
    // React may re-run subscribe with the SAME entry object (StrictMode
    // remount, effect re-run). If its cleanup had already dropped the entry
    // from the pool, re-adopt it so a later mount cannot create a second
    // engine for a series this one is still polling.
    const key = poolKey(symbol, timeframe);
    if (enginePool.get(key) !== entry) enginePool.set(key, entry);

    const unsubscribe = entry.engine.subscribe(() => notify());
    entry.refs += 1;
    entry.engine.start();
    ensurePoller(entry, symbol, timeframe, pollMs);
    return () => {
        unsubscribe();
        entry.refs -= 1;
        if (entry.refs <= 0) {
            if (entry.pollTimer !== null) {
                clearInterval(entry.pollTimer);
                // MUST be nulled: `ensurePoller` early-returns on a non-null
                // id, so a cleared-but-still-set id left every later subscribe
                // to this entry with an engine that NEVER polls again — ticks
                // stop, quality degrades to stale/gap, the chart pauses, and a
                // later remount brings it back. That is the whole
                // "delay → pause → back live" cycle.
                entry.pollTimer = null;
            }
            entry.engine.destroy();
            if (enginePool.get(key) === entry) enginePool.delete(key);
        }
    };
}

/** Ensure the shared quote poller is running for this engine's series. */
function ensurePoller(entry: PoolEntry, symbol: string, timeframe: ChartTimeframe, pollMs: number): void {
    if (entry.pollTimer !== null) return;
    const tick = async () => {
        if (entry.pollBusy) return;
        entry.pollBusy = true;
        try {
            entry.quoteFetches += 1;
            const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbol.toUpperCase())}`, {
                cache: "no-store",
            });
            if (!res.ok) return;
            const body = (await res.json().catch(() => null)) as
                | { quotes?: Record<string, { price: number; timestamp: number }> }
                | null;
            const tickOut = quoteToTick(body?.quotes?.[symbol.toUpperCase()], symbol);
            if (tickOut) {
                entry.engine.ingestTick({ ...tickOut, source: "quotes-api" });
                entry.lastTickAt = Date.now();
            }
        } catch {
            // transient network error — next poll retries; health sweep marks
            // quality degraded if silence persists.
        } finally {
            entry.pollBusy = false;
        }
        void timeframe;
    };
    void tick();
    entry.pollTimer = setInterval(tick, pollMs);
}

export type UseChartEngineResult = {
    /** Immutable canonical candle snapshot (throttled). */
    candles: readonly ChartCandle[];
    status: ChartEngineStatus;
    /** Explicit chart mode derived from connection + data state. */
    mode: "loading" | "live" | "reconnecting" | "error";
    /** True when more history exists beyond the loaded window. */
    hasMoreHistory: boolean;
    /** Prepend one older page. Returns true when new candles arrived. */
    loadOlder: () => Promise<boolean>;
    /** Full resync (reconnect / manual refresh). */
    resync: () => Promise<void>;
    /** Current price from the forming candle (0 when empty). */
    currentPrice: number;
};

export function useChartEngine(
    symbol: string,
    timeframe: ChartTimeframe,
    options: { pageSize?: number; pollMs?: number; enabled?: boolean } = {},
): UseChartEngineResult {
    const pageSize = options.pageSize ?? 400;
    const pollMs = options.pollMs ?? 2000;
    const enabled = options.enabled ?? true;

    const sym = symbol.toUpperCase();
    const entry = useMemo(
        () => (enabled && typeof window !== "undefined" ? getEngineEntry(sym, timeframe, pageSize) : null),
        [enabled, sym, timeframe, pageSize],
    );

    // ── external-store subscription ─────────────────────────────────────
    // The engine refreshes its stable snapshot after every candle or status
    // commit. One subscription therefore refreshes both data and status
    // without ref reads during render or a second rAF-driven state path.
    const getStatusSnapshot = useCallback((): ChartEngineStatus => {
        if (!entry) return EMPTY_STATUS;
        return entry.engine.getStatus();
    }, [entry]);

    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            if (!entry) return () => {};
            return subscribeEngine(entry, sym, timeframe, pollMs, onStoreChange);
        },
        [entry, sym, timeframe, pollMs],
    );
    const status = useSyncExternalStore(
        subscribe,
        getStatusSnapshot,
        getStatusSnapshot,
    );

    const candles: readonly ChartCandle[] = entry ? entry.engine.getCandles() : EMPTY_CANDLES;

    const loadOlder = useCallback(async () => {
        if (!entry) return false;
        // Phase 1 scroll-back prefetch: the threshold path buffers a bounded
        // batch of pages per crossing (pageSize × prefetchPages, capped) and
        // commits them as ONE canonical update.
        return entry.engine.loadOlder({ pages: entry.engine.prefetchPages });
    }, [entry]);

    const resync = useCallback(async () => {
        if (!entry) return;
        await entry.engine.resync();
    }, [entry]);

    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;

    const mode: UseChartEngineResult["mode"] =
        !entry || (status.connection === "loading" && candles.length === 0)
            ? "loading"
            : status.connection === "error"
                ? "error"
                : status.connection === "reconnecting"
                    ? "reconnecting"
                    : "live";

    return { candles, status, mode, hasMoreHistory: status.hasMoreHistory, loadOlder, resync, currentPrice };
}

/**
 * useEngineDeepHistory — probe whether the server can page deep history
 * (Twelve Data configured). Runs once per app session; caches the verdict.
 */
export function useEngineDeepHistoryProbe(): boolean {
    const [deep, setDeep] = useState<boolean>(deepHistoryFlag ?? false);
    useEffect(() => {
        if (deepHistoryFlag !== null) return;
        let cancelled = false;
        fetch("/api/chart-config", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((body: { deepHistory?: boolean } | null) => {
                if (cancelled) return;
                deepHistoryFlag = Boolean(body?.deepHistory);
                setDeepHistoryAvailable(deepHistoryFlag);
                setDeep(deepHistoryFlag);
            })
            .catch(() => {
                if (!cancelled) {
                    deepHistoryFlag = false;
                    setDeepHistoryAvailable(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);
    return deep;
}

// ── Phase 1 test support (polling/pool audit) ────────────────────────────────
// These accessors exist so the pooling contract can be verified without
// mounting React: one engine + one quote poller per symbol|timeframe, shared
// by every subscriber, torn down after the last one leaves.

export type EnginePoolSnapshot = {
    /** Active subscribers (React hook instances) on this pooled engine. */
    refs: number;
    /** True while the shared quote poller timer is running. */
    polling: boolean;
    /** Quote fetches issued by this pool entry since creation. */
    quoteFetches: number;
    /** The pooled engine itself (test access for resync/status inspection). */
    engine: ChartDataEngine;
};

/** Introspect the pooled engine for a series (null when not pooled). */
export function __enginePoolSnapshot(symbol: string, timeframe: string): EnginePoolSnapshot | null {
    const entry = enginePool.get(poolKey(symbol, timeframe));
    if (!entry) return null;
    return { refs: entry.refs, polling: entry.pollTimer !== null, quoteFetches: entry.quoteFetches, engine: entry.engine };
}

/**
 * Subscribe exactly like useChartEngine does, without React. Returns the
 * unsubscribe function (same ref-counting/teardown semantics).
 */
export function __subscribeEngineForTest(
    symbol: string,
    timeframe: ChartTimeframe,
    pollMs: number,
    notify: () => void,
): () => void {
    const entry = getEngineEntry(symbol, timeframe, 400);
    return subscribeEngine(entry, symbol.toUpperCase(), timeframe, pollMs, notify);
}
