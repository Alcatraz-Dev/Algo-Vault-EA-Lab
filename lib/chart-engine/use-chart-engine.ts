"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChartDataEngine, type ChartEngineStatus } from "./chart-data-engine";
import { createApiDataSources, quoteToTick } from "./data-sources";
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
};
const enginePool = new Map<string, PoolEntry>();
let deepHistoryFlag: boolean | null = null;

/** Called once (server probe) to decide whether paging beyond Biquote works. */
export function setDeepHistoryAvailable(v: boolean): void {
    deepHistoryFlag = v;
}

function poolKey(symbol: string, timeframe: string): string {
    return `${symbol.toUpperCase()}|${timeframe.toUpperCase()}`;
}

function acquireEngine(symbol: string, timeframe: ChartTimeframe, pageSize: number): PoolEntry {
    const key = poolKey(symbol, timeframe);
    let entry = enginePool.get(key);
    if (!entry) {
        const engine = new ChartDataEngine(createApiDataSources(deepHistoryFlag ?? false), {
            symbol,
            timeframe,
            pageSize,
        });
        entry = { engine, refs: 0, pollTimer: null, pollBusy: false, lastTickAt: 0 };
        enginePool.set(key, entry);
    }
    entry.refs += 1;
    return entry;
}

function releaseEngine(symbol: string, timeframe: string): void {
    const key = poolKey(symbol, timeframe);
    const entry = enginePool.get(key);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs <= 0) {
        if (entry.pollTimer !== null) clearInterval(entry.pollTimer);
        entry.engine.destroy();
        enginePool.delete(key);
    }
}

/** Ensure the shared quote poller is running for this engine's series. */
function ensurePoller(entry: PoolEntry, symbol: string, timeframe: ChartTimeframe, pollMs: number): void {
    if (entry.pollTimer !== null) return;
    const tick = async () => {
        if (entry.pollBusy) return;
        entry.pollBusy = true;
        try {
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
        () => (enabled ? acquireEngine(sym, timeframe, pageSize) : null),
        [enabled, sym, timeframe, pageSize],
    );

    // Release on unmount / key change.
    useEffect(() => {
        if (!entry) return;
        return () => {
            releaseEngine(sym, timeframe);
        };
    }, [entry, sym, timeframe]);

    // Start engine + poller while mounted.
    useEffect(() => {
        if (!entry) return;
        entry.engine.start();
        ensurePoller(entry, sym, timeframe, pollMs);
    }, [entry, sym, timeframe, pollMs]);

    // ── subscription with coalesced snapshots ───────────────────────────
    const candlesCache = useRef<{ snap: readonly ChartCandle[]; version: number }>({ snap: Object.freeze([]), version: 0 });
    const [, forceVersion] = useState(0);

    useEffect(() => {
        if (!entry) return;
        let scheduled = false;
        const bump = () => {
            if (scheduled) return;
            scheduled = true;
            // Coalesce bursts of engine events into one React commit per frame.
            requestAnimationFrame(() => {
                scheduled = false;
                forceVersion((v) => v + 1);
            });
        };
        const unsub = entry.engine.subscribe(bump);
        return unsub;
    }, [entry]);

    const getCandlesSnapshot = useCallback((): readonly ChartCandle[] => {
        if (!entry) return Object.freeze([]);
        const snap = entry.engine.getCandles();
        if (snap !== candlesCache.current.snap) {
            candlesCache.current = { snap, version: candlesCache.current.version + 1 };
        }
        return snap;
    }, [entry]);

    const getStatusSnapshot = useCallback((): ChartEngineStatus => {
        if (!entry) {
            return {
                connection: "idle",
                quality: "pristine",
                error: null,
                lastTickAt: 0,
                lastHistoryLoadAt: 0,
                candlesLoaded: 0,
                oldestLoadedTimestamp: null,
                hasMoreHistory: false,
                loadingOlder: false,
                gapsDetected: 0,
                duplicatesDropped: 0,
                rowsRejected: 0,
                reconnects: 0,
            };
        }
        return entry.engine.getStatus();
    }, [entry]);

    useSyncExternalStore(
        (onStoreChange) => {
            if (!entry) return () => {};
            return entry.engine.subscribe(onStoreChange);
        },
        getStatusSnapshot,
        getStatusSnapshot,
    );
    // Version read ties the rAF-coalesced bump into the same render pass.
    // (useSyncExternalStore covers status; the version re-read refreshes candles.)
    void forceVersion;

    const candles = entry ? getCandlesSnapshot() : Object.freeze([]);

    const loadOlder = useCallback(async () => {
        if (!entry) return false;
        return entry.engine.loadOlder();
    }, [entry]);

    const resync = useCallback(async () => {
        if (!entry) return;
        await entry.engine.resync();
    }, [entry]);

    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;

    const mode: UseChartEngineResult["mode"] =
        !entry || (entry.engine.getStatus().connection === "loading" && candles.length === 0)
            ? "loading"
            : entry.engine.getStatus().connection === "error"
                ? "error"
                : entry.engine.getStatus().connection === "reconnecting"
                    ? "reconnecting"
                    : "live";

    return { candles, status: entry ? entry.engine.getStatus() : getStatusSnapshot(), mode, hasMoreHistory: entry ? entry.engine.getStatus().hasMoreHistory : false, loadOlder, resync, currentPrice };
}

/**
 * useEngineDeepHistory — probe whether the server can page deep history
 * (Twelve Data configured). Runs once per app session; caches the verdict.
 */
export function useEngineDeepHistoryProbe(): boolean {
    const [deep, setDeep] = useState<boolean>(deepHistoryFlag ?? false);
    useEffect(() => {
        if (deepHistoryFlag !== null) {
            setDeep(deepHistoryFlag);
            return;
        }
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
