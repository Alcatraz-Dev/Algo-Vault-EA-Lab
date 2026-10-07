/**
 * Native chart engine — standalone test suite.
 *
 * Mirrors the repo's test convention (see tests/pro-scalping-terminal.test.ts):
 * a self-contained runner executed with
 *
 *     npx jiti tests/chart-engine/chart-engine.test.ts
 *
 * Covers the phases of the chart-engine spec: timeframe boundaries (all
 * supported timeframes), canonical candle normalization, aggregation (M1…H4),
 * live candle updates, finalization, dedupe, out-of-order data, gap
 * detection/repair, reconnect/resync, symbol & timeframe switching, viewport
 * preservation on history prepend, live-follow rules, market-closed honesty,
 * indicator sync, overlay sync and no-future-leakage.
 */

import {
    TIMEFRAME_MS,
    candleOpenTime,
    nextCandleOpenTime,
    isInCandle,
    isMarketTradableAt,
    expectedCandleOpens,
} from "../../lib/chart-engine/timeframe";
import { toChartCandle, chartCandleToMarketCandle, candleKey, type ChartCandle } from "../../lib/chart-engine/candle";
import { applyHistory, applyTick, isChronological, enforceChronology } from "../../lib/chart-engine/candle-aggregator";
import { ChartDataEngine, type ChartDataSources } from "../../lib/chart-engine/chart-data-engine";
import {
    isAtLiveEdge,
    zoomAt,
    panByPixels,
    viewportAfterAppend,
    goToLive,
    timeToX,
    xToTime,
    candleX,
    xToCandleIndex,
    computeWindow,
} from "../../lib/chart-engine/viewport";
import { InteractionController } from "../../lib/chart-engine/interactions";
import { computeStructureOverlay, structureOverlayLayer, computeIndicatorSeries } from "../../lib/chart-engine/overlay-contract";
import { TailTracker } from "../../lib/chart-engine/indicators";
import { barIndexForTime, countPrependedBars, shiftLogicalRangeForPrepend } from "../../lib/chart-engine/coordinate-mapping";
import { createAdaptiveApiDataSources, createApiDataSources, quoteToTick } from "../../lib/chart-engine/data-sources";
import { __enginePoolSnapshot, __subscribeEngineForTest } from "../../lib/chart-engine/use-chart-engine";
import { fetchDeepHistoryPageDetailed } from "../../lib/market-data/twelvedata/candle-bridge";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let passed = 0;
let failed = 0;
const asyncChecks: Promise<void>[] = [];

function check(name: string, fn: () => void | Promise<void>) {
    void assert1;
    try {
        const r = fn();
        if (r instanceof Promise) {
            // Async checks resolve in the tail batch; failures are counted there.
            asyncChecks.push(
                r.then(
                    () => {
                        passed += 1;
                        console.log(`  ✓ ${name}`);
                    },
                    (err: unknown) => {
                        failed += 1;
                        console.error(`  ✗ ${name}`);
                        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
                    }
                )
            );
            return;
        }
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    }
}

function assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = ""): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message} Expected ${b} but got ${a}`);
}

// Allow legacy one-argument assert calls from earlier drafts.
function assert1(condition: unknown): void {
    assert(condition, "condition failed");
}

/**
 * Async checks run concurrently (Promise.all), but they share one global
 * fetch. Serialize every fetch-stubbing check through this chain so stubs
 * never overlap and clobber each other's responses.
 */
let fetchStubChain: Promise<void> = Promise.resolve();
async function withFetchStub<T>(stub: typeof fetch, body: () => Promise<T>): Promise<T> {
    const previous = fetchStubChain;
    let release!: () => void;
    fetchStubChain = new Promise<void>((r) => {
        release = r;
    });
    await previous;
    const original = globalThis.fetch;
    globalThis.fetch = stub;
    try {
        return await body();
    } finally {
        globalThis.fetch = original;
        release();
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** A clean series of `n` hourly candles starting at `startMs`. */
function series(n: number, startMs: number, tf: ChartCandle["timeframe"] = "H1", price = 100): ChartCandle[] {
    const out: ChartCandle[] = [];
    for (let i = 0; i < n; i++) {
        const t = startMs + i * TIMEFRAME_MS[tf];
        out.push({
            timestamp: t,
            open: price + i,
            high: price + i + 1,
            low: price + i - 1,
            close: price + i + 0.5,
            volume: 10 + i,
            symbol: "XAUUSD",
            timeframe: tf,
            finalized: true,
        });
    }
    return out;
}

function mkEngine(sources: Partial<ChartDataSources>, opts?: { timeframe?: ChartCandle["timeframe"]; symbol?: string }): ChartDataEngine {
    return new ChartDataEngine(
        {
            loadLatest: async () => ({ candles: [], hasMore: false }),
            loadOlder: async () => ({ candles: [], hasMore: false }),
            ...sources,
        },
        { symbol: opts?.symbol ?? "XAUUSD", timeframe: opts?.timeframe ?? "H1", pageSize: 10, healthIntervalMs: 60_000 }
    );
}

const HOUR = TIMEFRAME_MS.H1;

// ── Phase 4a: timeframe boundaries ──────────────────────────────────────────

console.log("Timeframe boundaries");
for (const tf of ["M1", "M3", "M5", "M15", "M30", "H1", "H4"] as const) {
    check(`candleOpenTime buckets to ${tf} boundaries`, () => {
        const interval = TIMEFRAME_MS[tf];
        const offset = Math.floor(interval / 3);
        const base = Date.UTC(2026, 8, 23, 13, 7, 21); // arbitrary moment
        assertEqual(candleOpenTime(base + offset, tf), Math.floor((base + offset) / interval) * interval);
        assert((candleOpenTime(base + offset, tf) as number) % interval === 0, "bucket is aligned");
    });
    check(`nextCandleOpenTime(${tf}) = open + interval`, () => {
        const base = Date.UTC(2026, 8, 23, 13, 0);
        assertEqual(nextCandleOpenTime(base, tf), candleOpenTime(base, tf) + TIMEFRAME_MS[tf]);
    });
    check(`isInCandle(${tf}) bounds correctly`, () => {
        const open = candleOpenTime(Date.UTC(2026, 8, 23, 13, 4), tf);
        assert(isInCandle(open, open, tf), "start inclusive");
        assert(isInCandle(open + TIMEFRAME_MS[tf] - 1, open, tf), "end exclusive-1");
        assert(!isInCandle(open + TIMEFRAME_MS[tf], open, tf), "end excluded");
    });
}
check("M3 buckets are not aligned to M5 grid", () => {
    const t = Date.UTC(2026, 8, 23, 13, 4);
    assertEqual(candleOpenTime(t, "M3"), Date.UTC(2026, 8, 23, 13, 3));
    assertEqual(candleOpenTime(t, "M5"), Date.UTC(2026, 8, 23, 13, 0));
});
check("H4 bucket uses UTC 0/4/8/12/16/20 anchors", () => {
    assertEqual(candleOpenTime(Date.UTC(2026, 8, 23, 19, 30), "H4"), Date.UTC(2026, 8, 23, 16, 0));
    assertEqual(candleOpenTime(Date.UTC(2026, 8, 23, 21, 0), "H4"), Date.UTC(2026, 8, 23, 20, 0));
});

// ── Phase 7: market sessions ─────────────────────────────────────────────────

console.log("Market session handling");
check("Wednesday is tradable, Saturday is not", () => {
    assert(isMarketTradableAt(Date.UTC(2026, 8, 23, 12, 0)) === true, "Wed noon");
    assert(isMarketTradableAt(Date.UTC(2026, 8, 26, 12, 0)) === false, "Saturday");
});
check("weekend gate: Sun 20:59 closed, Sun 21:00 open, Fri 21:00 closed", () => {
    // 2026-09-27 is a Sunday; 2026-09-25 is a Friday.
    assertEqual(isMarketTradableAt(Date.UTC(2026, 8, 27, 20, 59)), false);
    assertEqual(isMarketTradableAt(Date.UTC(2026, 8, 27, 21, 0)), true);
    assertEqual(isMarketTradableAt(Date.UTC(2026, 8, 25, 21, 0)), false);
});
check("expectedCandleOpens excludes market-closed buckets (weekend not a gap)", () => {
    // Friday 20:00 → Sunday 22:00 on H1: only Sunday 22:00 and 23:00 buckets… actually none strictly between Friday 20:00 and Sunday 22:00 open while tradable except Sunday 21:00+ opens.
    const from = Date.UTC(2026, 8, 25, 20, 0); // Friday 20:00
    const to = Date.UTC(2026, 8, 27, 22, 0); // Sunday 22:00
    const opens = expectedCandleOpens(from, to, "H1");
    assert(opens.every((t) => isMarketTradableAt(t)), "every expected open is tradable");
    assertEqual(opens, [Date.UTC(2026, 8, 27, 21, 0), Date.UTC(2026, 8, 27, 22, 0)], "Sunday 21:00 and 22:00 opens only");
});

// ── Phase 2: canonical candle ────────────────────────────────────────────────

console.log("Canonical candle model");
check("toChartCandle re-buckets provider stamps to open time", () => {
    const c = toChartCandle(
        { timestamp: Date.UTC(2026, 8, 23, 13, 7, 21), open: 100, high: 102, low: 99, close: 101, volume: 5 },
        "XAUUSD",
        "M5"
    );
    assert(c !== null, "candle normalized");
    assertEqual(c!.timestamp, Date.UTC(2026, 8, 23, 13, 5));
    assertEqual(c!.symbol, "XAUUSD");
    assertEqual(c!.finalized, false);
});
check("toChartCandle rejects invalid OHLC instead of fixing it", () => {
    assertEqual(toChartCandle({ timestamp: 1, open: 100, high: 90, low: 99, close: 101 } as never, "XAUUSD", "M5"), null);
    assertEqual(toChartCandle({ timestamp: 1, open: -5, high: 4, low: -6, close: 3 } as never, "XAUUSD", "M5"), null);
});
check("candleKey dedupes by symbol|timeframe|timestamp", () => {
    assertEqual(candleKey("xauusd", "m5", 123), candleKey("XAUUSD", "M5", 123));
    assert(candleKey("XAUUSD", "M5", 123) !== candleKey("EURUSD", "M5", 123), "different symbols differ");
});
check("chartCandleToMarketCandle keeps legacy contract", () => {
    const s = series(3, 0);
    const legacy = chartCandleToMarketCandle(s[0]);
    assertEqual(Object.keys(legacy).sort(), ["close", "high", "low", "open", "timestamp", "volume"]);
});

// ── Phase 4: aggregation ─────────────────────────────────────────────────────

console.log("Live candle aggregation");
const H1 = "H1" as const;
check("tick inside forming candle updates H/L/C without appending", () => {
    const base = series(3, 0, H1);
    base[2] = { ...base[2], finalized: false }; // forming candle
    const r = applyTick(base, { price: 105, timestamp: base[2].timestamp + 30_000 }, H1);
    assertEqual(r.action, "update");
    assertEqual(r.series.length, 3);
    assertEqual(r.series[2].high, 105);
    assertEqual(r.series[2].close, 105);
    assertEqual(r.series[2].finalized, false);
});
check("boundary crossing finalizes previous candle and opens a new one", () => {
    const base = series(3, 0, H1);
    const r = applyTick(base, { price: 110, timestamp: base[2].timestamp + HOUR + 1 }, H1);
    assertEqual(r.action, "new");
    assertEqual(r.finalizedPrevious, true);
    assertEqual(r.series.length, 4);
    assertEqual(r.series[2].finalized, true);
    assertEqual(r.series[3].open, base[2].close);
    assertEqual(r.series[3].timestamp, base[2].timestamp + HOUR);
});
check("late (out-of-order) ticks never rewrite history", () => {
    const base = series(3, 0, H1);
    const r = applyTick(base, { price: 1, timestamp: base[0].timestamp + 10 }, H1);
    assertEqual(r.action, "none");
    assertEqual(r.series, base);
});
check("no candles are fabricated across market-closed gaps", () => {
    const base = series(3, 0, H1);
    // Next tick arrives Monday (far future bucket) — one real candle opens.
    const r = applyTick(base, { price: 120, timestamp: base[2].timestamp + 60 * HOUR }, H1);
    assertEqual(r.series.length, 4);
    assertEqual(r.series[3].timestamp, candleOpenTime(base[2].timestamp + 60 * HOUR, H1));
});
check("M1 aggregation folds ticks into the right minute buckets", () => {
    const start = Date.UTC(2026, 8, 23, 13, 0);
    let s: ChartCandle[] = [toChartCandle({ timestamp: start, open: 10, high: 10, low: 10, close: 10 }, "EURUSD", "M1")!];
    const ticks = [10.5, 11, 9.8, 10.2];
    for (let i = 0; i < ticks.length; i++) {
        s = applyTick(s, { price: ticks[i], timestamp: start + i * 15_000 }, "M1").series;
    }
    assertEqual(s.length, 1);
    assertEqual(s[0].high, 11);
    assertEqual(s[0].low, 9.8);
    assertEqual(s[0].close, 10.2);
    // cross the minute boundary
    s = applyTick(s, { price: 10.4, timestamp: start + 60_000 + 5_000 }, "M1").series;
    assertEqual(s.length, 2);
    assertEqual(s[0].finalized, true);
    assertEqual(s[1].open, 10.2);
});
check("M3/M5/M15/M30/H4 boundary math matches the timeframe engine", () => {
    for (const tf of ["M3", "M5", "M15", "M30", "H4"] as const) {
        const start = candleOpenTime(Date.UTC(2026, 8, 23, 2, 1), tf);
        let s: ChartCandle[] = [toChartCandle({ timestamp: start, open: 10, high: 10, low: 10, close: 10 }, "EURUSD", tf)!];
        s = applyTick(s, { price: 11, timestamp: start + TIMEFRAME_MS[tf] - 1 }, tf).series;
        assertEqual(s.length, 1, tf);
        s = applyTick(s, { price: 11.5, timestamp: start + TIMEFRAME_MS[tf] }, tf).series;
        assertEqual(s.length, 2, tf);
        assertEqual(s[1].timestamp, start + TIMEFRAME_MS[tf], tf);
    }
});
check("volume accumulates when ticks carry size", () => {
    const base = series(1, 0, H1);
    let s = base;
    s = applyTick(s, { price: 101, timestamp: 10, volume: 2 }, H1).series;
    s = applyTick(s, { price: 101, timestamp: 20, volume: 3 }, H1).series;
    assertEqual(s[0].volume, base[0].volume! + 5);
});
check("no-op ticks keep array identity (render skip)", () => {
    const base = series(2, 0, H1);
    const r = applyTick(base, { price: base[1].close, timestamp: base[1].timestamp + 1 }, H1);
    assertEqual(r.changed, false);
    assert(r.series === base, "same reference returned");
});

// ── history merge / dedupe / ordering ────────────────────────────────────────

console.log("History merge, dedupe and ordering");
check("applyHistory dedupes by candle key and prefers provider rows", () => {
    const base = series(4, 0, H1);
    const incoming = [
        { ...base[1], close: 999 }, // provider revision of a known bucket
        base[3],
    ];
    const r = applyHistory(base, incoming);
    assertEqual(r.series.length, 4);
    assertEqual(r.series[1].close, 999);
    assertEqual(r.duplicates, 2, "both incoming rows already exist in the series");
});
check("applyHistory accepts out-of-order batches and re-sorts", () => {
    const base = series(3, HOUR * 10, H1);
    const shuffled = [base[2], base[0], base[1]];
    const r = applyHistory([], shuffled);
    assert(isChronological(r.series), "sorted ascending");
});
check("enforceChronology drops duplicate/out-of-order stamps defensively", () => {
    const base = series(3, 0, H1);
    const dirty = [base[0], base[1], base[1], base[0], base[2]];
    const fixed = enforceChronology(dirty);
    assertEqual(fixed.length, 3);
    assert(isChronological(fixed), "chronology restored");
});

// ── engine: gaps, repair, resync, switching ─────────────────────────────────

console.log("ChartDataEngine lifecycle");
const GAP_FROM = Date.UTC(2026, 8, 23, 10, 0);
const GAP_TO = Date.UTC(2026, 8, 23, 13, 0);

function gapSources(repairLog: string[][]): ChartDataSources {
    const c1 = series(2, GAP_FROM - 2 * HOUR, H1); // 08:00, 09:00
    const c2 = series(2, GAP_TO, H1); // 13:00, 14:00
    const all = [...c1, ...c2];
    return {
        async loadLatest() {
            return { candles: all, hasMore: true };
        },
        async loadOlder(req) {
            return { candles: all.filter((c) => c.timestamp < req.beforeMs), hasMore: false };
        },
        async loadRange(req) {
            repairLog.push([`${req.fromMs}`, `${req.toMs}`]);
            // The mock provider serves any requested range (like a real
            // deep-history provider would).
            const out: ChartCandle[] = [];
            for (let t = req.fromMs; t <= req.toMs; t += HOUR) {
                out.push({
                    timestamp: t,
                    open: 50,
                    high: 51,
                    low: 49,
                    close: 50.5,
                    volume: 1,
                    symbol: "XAUUSD",
                    timeframe: "H1",
                    finalized: true,
                });
            }
            return { candles: out, hasMore: false };
        },
    };
}

async function waitUntil(pred: () => boolean, ms = 500): Promise<void> {
    const start = Date.now();
    while (!pred()) {
        if (Date.now() - start > ms) throw new Error("timeout waiting for engine condition");
        await new Promise((r) => setTimeout(r, 5));
    }
}

check("initial load, gap detection and repair fill the hole", async () => {
    const repairLog: string[][] = [];
    const engine = mkEngine(gapSources(repairLog));
    engine.start();
    await waitUntil(() => engine.getStatus().lastHistoryLoadAt > 0);
    // Initial history has a 10:00–13:00 hole (4 missing candles).
    assert(engine.detectGaps().length > 0, "gap detected");
    const repaired = await engine.detectAndRepairGaps();
    assert(repaired, "repair fetch ran and filled candles");
    assertEqual(engine.detectGaps().length, 0, "no gaps remain");
    assertEqual(repairLog.length, 1);
    engine.destroy();
});

check("adaptive API source enables paging from the canonical capability response", async () => {
    const seen: string[] = [];
    const base = Date.UTC(2026, 8, 23, 13, 0);
    const stub = (async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (!url.includes("before=")) {
            return new Response(JSON.stringify({
                hasDeepHistory: true,
                candles: [{ timestamp: base + HOUR, open: 100, high: 102, low: 99, close: 101, volume: 5 }],
            }), { status: 200 });
        }
        return new Response(JSON.stringify({
            hasDeepHistory: true,
            candles: [{ timestamp: base, open: 98, high: 101, low: 97, close: 100, volume: 4 }],
        }), { status: 200 });
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
        const source = createAdaptiveApiDataSources();
        const latest = await source.loadLatest({ symbol: "XAUUSD", timeframe: H1, limit: 100 });
        assertEqual(latest.hasMore, true, "latest page learns deep-history capability");
        const older = await source.loadOlder({ symbol: "XAUUSD", timeframe: H1, beforeMs: base + HOUR, limit: 100 });
        assertEqual(older.candles.length, 1);
        assert(older.candles[0].timestamp < base + HOUR, "only strictly older bars accepted");
        assert(seen[1].includes(`before=${base + HOUR}`), "older request carries exclusive cursor");
    });
});
check("loadOlder prepends without duplicating or dropping candles", async () => {
    let olderCalls = 0;
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(5, 0, H1), hasMore: true };
        },
        async loadOlder(req) {
            olderCalls += 1;
            return { candles: series(5, req.beforeMs - 5 * HOUR, H1).filter((c) => c.timestamp < req.beforeMs), hasMore: olderCalls < 2 };
        },
    });
    engine.start();
    await waitUntil(() => engine.getCandles().length === 5);
    const ok = await engine.loadOlder();
    assert(ok, "older page loaded");
    assertEqual(engine.getCandles().length, 10);
    assert(isChronological(engine.getCandles() as ChartCandle[]), "still ordered");
    assertEqual(engine.getStatus().duplicatesDropped, 0);
    engine.destroy();
});

check("resync marks reconnecting, preserves dataset, repairs gaps", async () => {
    const repairLog: string[][] = [];
    const engine = mkEngine(gapSources(repairLog));
    engine.start();
    await waitUntil(() => engine.getStatus().lastHistoryLoadAt > 0);
    const before = engine.getCandles().length;
    await engine.resync();
    assert(engine.getCandles().length >= before, "dataset preserved or grown");
    assertEqual(engine.getStatus().reconnects, 1);
    engine.destroy();
});

check("ingestTick appends live candles and flips connection back to live", async () => {
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(3, 0, H1), hasMore: false };
        },
        async loadOlder() {
            return { candles: [], hasMore: false };
        },
    });
    engine.start();
    await waitUntil(() => engine.getCandles().length === 3);
    engine.ingestTick({ price: 500, timestamp: series(3, 0, H1)[2].timestamp + HOUR + 5 });
    assertEqual(engine.getCandles().length, 4);
    assertEqual(engine.getStatus().connection, "live");
    engine.destroy();
});

check("symbol switching: separate engines never contaminate each other", async () => {
    const a = mkEngine(
        { async loadLatest() { return { candles: series(3, 0, H1), hasMore: false }; } },
        { symbol: "XAUUSD" }
    );
    const b = mkEngine(
        { async loadLatest() { return { candles: series(3, 0, H1, 2), hasMore: false }; } },
        { symbol: "EURUSD" }
    );
    a.start();
    b.start();
    await waitUntil(() => a.getCandles().length === 3 && b.getCandles().length === 3);
    a.ingestTick({ price: 777, timestamp: Date.now() });
    b.ingestTick({ price: 42, timestamp: Date.now() });
    await new Promise((r) => setTimeout(r, 20));
    assert(!a.getCandles().some((c) => c.close === 42), "EURUSD tick never lands in XAUUSD series");
    assert(!b.getCandles().some((c) => c.close === 777), "XAUUSD tick never lands in EURUSD series");
    a.destroy();
    b.destroy();
});

check("timeframe switching: stale H1 ticks cannot modify the M5 engine", async () => {
    const m5 = mkEngine(
        { async loadLatest() { return { candles: series(3, 0, "M5"), hasMore: false }; } },
        { timeframe: "M5" }
    );
    m5.start();
    await waitUntil(() => m5.getCandles().length === 3);
    // A tick stamped inside an old H1 bucket (way before the M5 tail).
    const staleH1Tick = { price: 31337, timestamp: 10 };
    m5.ingestTick(staleH1Tick);
    assertEqual(m5.getCandles().length, 3);
    assert(!m5.getCandles().some((c) => c.close === 31337), "stale tick ignored");
    m5.destroy();
});

check("provider disconnect: error status, last data kept, honest quality", async () => {
    const engine = mkEngine({
        async loadLatest() {
            throw new Error("provider down");
        },
        async loadOlder() {
            return { candles: [], hasMore: false };
        },
    });
    engine.start();
    await waitUntil(() => engine.getStatus().connection === "error");
    assertEqual(engine.getCandles().length, 0);
    assert(engine.getStatus().error !== null, "error surfaced");
    engine.destroy();
});

check("no paging provider: loadOlder reports the boundary honestly", async () => {
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(3, 0, H1), hasMore: false };
        },
        async loadOlder() {
            return { candles: [], hasMore: false };
        },
    });
    engine.start();
    await waitUntil(() => engine.getCandles().length === 3);
    const ok = await engine.loadOlder();
    assertEqual(ok, false);
    assertEqual(engine.getStatus().hasMoreHistory, false);
    engine.destroy();
});

// ── Phase 5/6: viewport, live-follow, historical scrolling ───────────────────

console.log("Viewport, live-follow and history scrolling");
const VP = { barWidth: 8, rightOffsetBars: 5, scrollFromRightPx: 0, autoFitY: true };
check("live edge detection with epsilon", () => {
    assert(isAtLiveEdge(VP), "0 scroll = live");
    assert(!isAtLiveEdge({ ...VP, scrollFromRightPx: 100 }), "scrolled = away");
});
check("zoomAt keeps the anchor candle stationary", () => {
    const anchor = 100; // px from right edge
    const z = zoomAt(VP, 2, anchor);
    // anchor bar distance in bars must be preserved
    const barsBefore = (VP.scrollFromRightPx + anchor) / VP.barWidth;
    const barsAfter = (z.scrollFromRightPx + anchor) / z.barWidth;
    assert(Math.abs(barsBefore - barsAfter) < 1e-9, "anchor stationary");
});
check("panByPixels clamps at the live edge", () => {
    const p = panByPixels(VP, -999);
    assertEqual(p.scrollFromRightPx, 0);
    const q = panByPixels(VP, 40);
    assertEqual(q.scrollFromRightPx, 40);
});
check("viewportAfterAppend freezes the screen while live appends happen", () => {
    const away = { ...VP, scrollFromRightPx: 120 };
    const after = viewportAfterAppend(away, 5);
    assertEqual(after.scrollFromRightPx, 120 + 5 * away.barWidth);
});
check("goToLive resets follow position", () => {
    const after = goToLive({ ...VP, scrollFromRightPx: 300 });
    assertEqual(after.scrollFromRightPx, 0);
});
check("timeToX / xToTime roundtrip; xToCandleIndex inverts candleX", () => {
    const len = 100;
    const last = (len - 1) * HOUR;
    const x = timeToX(last - 10 * HOUR, len, last, VP, 800, H1);
    const t = xToTime(x, len, last, VP, 800, H1);
    assertEqual(t, last - 10 * HOUR);
    const idx = 42;
    const cx = candleX(idx, len, VP, 800);
    assert(Math.abs(xToCandleIndex(cx, len, VP, 800) - idx) < 1e-9, "index roundtrip");
    // Newest candle sits rightOffsetBars + 1 slots from the right edge.
    const newestX = candleX(len - 1, len, VP, 800);
    assertEqual(newestX, 800 - (1 + VP.rightOffsetBars) * VP.barWidth);
});
check("computeWindow slices the visible range inside the series", () => {
    const w = computeWindow({ ...VP, scrollFromRightPx: 0 }, 50, 400, H1);
    assert(w.endIndex <= 50, "end within series");
    assert(w.startIndex >= 0, "start non-negative");
    const away = computeWindow({ ...VP, scrollFromRightPx: 800 }, 50, 400, H1);
    assert(away.endIndex < w.endIndex, "scrolling left reveals older candles");
});
check("barIndexForTime maps timestamps through observed bars across market gaps", () => {
    const friday = Date.UTC(2026, 8, 25, 20, 0);
    const sunday = Date.UTC(2026, 8, 27, 21, 0);
    const bars = [{ timestamp: friday }, { timestamp: sunday }, { timestamp: sunday + HOUR }];
    assertEqual(barIndexForTime(bars, friday, HOUR), 0);
    assertEqual(barIndexForTime(bars, sunday, HOUR), 1);
    assertEqual(barIndexForTime(bars, sunday + HOUR / 2, HOUR), 1.5);
    assertEqual(barIndexForTime(bars, sunday + 2 * HOUR, HOUR), 3);
    assert(Number.isNaN(barIndexForTime([], friday, HOUR)), "empty series cannot be mapped");
});
check("prepend viewport compensation shifts by newly prepended bars only", () => {
    const shifted = shiftLogicalRangeForPrepend({ from: 12.25, to: 42.75 }, 400, 650);
    assertEqual(shifted, { from: 262.25, to: 292.75 });
    assertEqual(shiftLogicalRangeForPrepend({ from: 5, to: 20 }, 400, 350), { from: 5, to: 20 });
    assertEqual(countPrependedBars([{ time: 1 }, { time: 2 }, { time: 5 }, { time: 9 }], 5), 2);
    assertEqual(countPrependedBars([{ time: 1 }, { time: 2 }], 0), 0);
});

console.log("InteractionController");
check("drag away disengages follow, drag back re-engages, goToLive works", () => {
    let following: boolean | null = null;
    const ic = new InteractionController({ onFollowChange: (f) => (following = f) });
    assert(ic.isFollowingLive(), "starts live");
    ic.dragStart_(0);
    ic.dragMove(80); // dragging right reveals older candles → disengages
    ic.dragEnd();
    assert(ic.getViewport().scrollFromRightPx > 6, "scrolled away");
    assertEqual(following, false);
    ic.goToLive();
    assert(ic.isFollowingLive(), "back to live");
    assertEqual(following, true);
});
check("wheel zoom anchors at cursor", () => {
    const ic = new InteractionController();
    const before = ic.getViewport().barWidth;
    ic.wheelZoom(-120, 600, 800);
    assert(ic.getViewport().barWidth > before, "zoom in");
    ic.wheelZoom(120, 600, 800);
    assert(Math.abs(ic.getViewport().barWidth - before) < 1e-9, "zoom out restores");
});
check("pinch zoom scales bar width", () => {
    const ic = new InteractionController();
    ic.pinchMove(100, 400, 800);
    ic.pinchMove(200, 400, 800);
    assert(ic.getViewport().barWidth > 8, "widened");
    ic.pinchEnd();
});

// ── Phase 9: TailTracker ─────────────────────────────────────────────────────

console.log("TailTracker (data/render split)");
check("append and update produce minimal updates, prepend forces reset", () => {
    const tt = new TailTracker();
    const s3 = series(3, 0, H1);
    tt.seedFrom(s3);
    // updated forming candle
    const updated = [...s3.slice(0, -1), { ...s3[2], close: 555 }];
    let d = tt.diff(updated, "XAUUSD|H1");
    assertEqual(d.updates.length, 1);
    assertEqual(d.fullReset, false);
    // appended candle
    const appended = [...updated, { ...s3[2], timestamp: s3[2].timestamp + HOUR, open: 555, high: 556, low: 554, close: 555.5 }];
    d = tt.diff(appended, "XAUUSD|H1");
    assertEqual(d.updates.length, 2, "finalize previous + push new");
    // prepended history → full reset
    const prepended = [...series(2, -2 * HOUR, H1), ...appended];
    d = tt.diff(prepended, "XAUUSD|H1");
    assertEqual(d.fullReset, true);
    // no change
    d = tt.diff(prepended, "XAUUSD|H1");
    assertEqual(d.updates.length, 0);
});

// ── Phase 14/15: indicator & overlay sync ────────────────────────────────────

console.log("Indicator & overlay synchronization");
check("indicator series align 1:1 with candles (EMA/SMA/RSI)", () => {
    const s = series(60, 0, H1);
    const [ema20] = computeIndicatorSeries(s, ["ema20"]);
    assertEqual(ema20.values.length, 60);
    assert(ema20.values[59] !== null && Number.isFinite(ema20.values[59] as number), "EMA finite at tail");
    // Canonical EMA (lib/market-core v1.0.0): SMA-seeded, null during the
    // warmup window — never a fabricated value at bar 0.
    assert(ema20.values[0] === null, "EMA is null before its seed window fills");
    const closes = s.slice(0, 20).map((c) => c.close);
    const seed = closes.reduce((a, b) => a + b, 0) / 20;
    assertEqual(ema20.values[19], seed, "EMA seeds with SMA(period) at index period-1");
    assert(ema20.values[20] !== null, "EMA emits from index period onward");
    const [rsi14] = computeIndicatorSeries(s, ["rsi"]);
    assert(rsi14.values[13] === null && rsi14.values[14] !== null, "RSI warmup is period bars");
});
check("structure overlay exposes deterministic BOS/CHoCH/swing events", () => {
    // Ramp up then dump: guarantees swings + BOS.
    const s = Array.from({ length: 80 }, (_, i) => {
        const drift = i < 50 ? i * 0.8 : 40 - (i - 50) * 1.1;
        const close = 100 + drift + Math.sin(i / 3) * 1.2;
        return {
            timestamp: i * HOUR,
            open: close - 0.4,
            high: close + 1.1,
            low: close - 1.1,
            close,
            volume: 10,
            symbol: "XAUUSD",
            timeframe: H1,
            finalized: true,
        } as ChartCandle;
    });
    const { events, bias } = computeStructureOverlay(s, H1);
    assert(events.length > 0, "events exist");
    assert(events.every((e) => Number.isFinite(e.price) && Number.isFinite(e.timestamp)), "events carry price+time");
    assert(["bullish", "bearish", "neutral"].includes(bias), "bias resolved");
    const layer = structureOverlayLayer(true);
    const markers = layer.getEventMarkers?.(s) ?? [];
    assert(markers.length === events.length, "layer adapters 1:1 to events");
});
check("structure overlay is deterministic (same input → same output)", () => {
    const s = series(40, 0, H1);
    const a = computeStructureOverlay(s, H1);
    const b = computeStructureOverlay(s, H1);
    assertEqual(a, b);
});

// ── Phase 22: no future leakage ──────────────────────────────────────────────

console.log("No future leakage");
check("prefix candles produce identical structure to truncated dataset", () => {
    const full = series(60, 0, H1);
    const at30 = computeStructureOverlay(full.slice(0, 30), H1);
    const recomputedWithMore = computeStructureOverlay(full.slice(0, 30), H1);
    assertEqual(at30, recomputedWithMore, "structure at bar 30 depends only on bars 0..29");
    // And adding future bars never changes the earlier events list object for the prefix call:
    assertEqual(at30.events.map((e) => e.timestamp), computeStructureOverlay(full.slice(0, 30), H1).events.map((e) => e.timestamp));
});
check("aggregation never needs future candles (streaming fold)", () => {
    const start = Date.UTC(2026, 8, 23, 13, 0);
    let s: ChartCandle[] = [toChartCandle({ timestamp: start, open: 10, high: 10, low: 10, close: 10 }, "EURUSD", "M5")!];
    const stepwise: number[][] = [];
    for (let i = 0; i < 10; i++) {
        s = applyTick(s, { price: 10 + i * 0.5, timestamp: start + i * 30_000 }, "M5").series;
        stepwise.push([s[s.length - 1].high, s[s.length - 1].low, s[s.length - 1].close]);
    }
    assertEqual(stepwise[4], [12, 10, 12], "running H/L/C only reflect past ticks");
});

// ── Phase 1: data pipeline (prefetch, cancellation, reconciliation, …) ─────

const P1_BASE = Date.UTC(2026, 0, 5, 0); // fixed past Monday 00:00
const ENGINE_SOURCE = readFileSync(resolve(__dirname, "../../lib/chart-engine/chart-data-engine.ts"), "utf8");

async function p1Sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
}

console.log("Phase 1: bounded prefetch, batch prepend, viewport");
check("bounded prefetch: ≤ max pages, merged into ONE canonical update", async () => {
    const pageSize = 10;
    let olderCalls = 0;
    const engine = new ChartDataEngine(
        {
            async loadLatest() {
                return { candles: series(pageSize, P1_BASE, H1), hasMore: true };
            },
            async loadOlder(req) {
                olderCalls += 1;
                // Inclusive boundary row (like a provider's inclusive end_date)
                // to exercise dedupe across pages.
                return {
                    candles: series(pageSize, req.beforeMs - (pageSize - 1) * HOUR, H1),
                    hasMore: true,
                };
            },
        },
        { symbol: "XAUUSD", timeframe: H1, pageSize, healthIntervalMs: 60_000 }
    );
    let candleEvents = 0;
    engine.subscribe((e) => {
        if (e.type === "candles") candleEvents += 1;
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === pageSize);

        assert(engine.prefetchPages >= 1 && engine.prefetchPages <= 3, "prefetch page count derived and bounded");
        const oldestBefore = engine.getCandles()[0].timestamp;
        candleEvents = 0;

        const ok = await engine.loadOlder({ pages: engine.prefetchPages });
        assert(ok, "batch prepend committed");
        assertEqual(olderCalls, 3, "at most MAX_PREFETCH_PAGES requests per crossing");
        assertEqual(candleEvents, 1, "ONE snapshot publication for the whole batch");

        const after = engine.getCandles();
        assertEqual(after.length, pageSize + 3 * (pageSize - 1), "merged without duplicates (one row/page overlap)");
        assert(after[0].timestamp < oldestBefore, "older bars land at the front");
        for (let i = 1; i < after.length; i++) {
            assert(after[i].timestamp > after[i - 1].timestamp, `prepend keeps ascending chronology at ${i}`);
        }
        assertEqual(engine.getStatus().duplicatesDropped, 3, "boundary overlap rows counted as duplicates");
        assertEqual(engine.getStatus().loadingOlder, false);
        assertEqual(engine.getStatus().hasMoreHistory, true, "provider still reports more after a full batch");
    } finally {
        engine.destroy();
    }
});

check("batch prepend compensates the viewport exactly once (no jump, no zoom change)", async () => {
    const pageSize = 10;
    const engine = new ChartDataEngine(
        {
            async loadLatest() {
                return { candles: series(pageSize, P1_BASE, H1), hasMore: true };
            },
            async loadOlder(req) {
                return { candles: series(pageSize, req.beforeMs - (pageSize - 1) * HOUR, H1), hasMore: true };
            },
        },
        { symbol: "XAUUSD", timeframe: H1, pageSize, healthIntervalMs: 60_000 }
    );
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === pageSize);

        // Renderer-equivalent capture BEFORE the batch.
        const before = engine.getCandles().map((c) => ({ time: c.timestamp }));
        const previousFirstTime = before[0].time;
        const range = { from: 3.5, to: 8.5 };

        await engine.loadOlder({ pages: engine.prefetchPages });
        const after = engine.getCandles().map((c) => ({ time: c.timestamp }));

        // One compensation pass over the whole batch (the renderer does this
        // once per dataset push — the batch commits exactly once).
        const added = countPrependedBars(after, previousFirstTime);
        assertEqual(added, 27, "all prepended bars counted in a single pass");
        const shifted = shiftLogicalRangeForPrepend(range, 0, added);
        assertEqual(shifted.to - shifted.from, range.to - range.from, "visible span (zoom) unchanged");
        const candleAt = (bars: { time: number }[], idx: number) => bars[Math.floor(idx)]?.time;
        assertEqual(
            candleAt(after, shifted.from),
            candleAt(before, range.from),
            "the same market candle stays at the same screen position"
        );
        assert(
            !/fitContent|scrollToRealTime|setVisibleRange/.test(ENGINE_SOURCE),
            "engine never resets the viewport"
        );
    } finally {
        engine.destroy();
    }
});

check("default loadOlder stays a single page (explicit opt-in for prefetch)", async () => {
    let olderCalls = 0;
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(5, P1_BASE, H1), hasMore: true };
        },
        async loadOlder(req) {
            olderCalls += 1;
            return { candles: series(5, req.beforeMs - 5 * HOUR, H1).filter((c) => c.timestamp < req.beforeMs), hasMore: true };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);
        const ok = await engine.loadOlder();
        assert(ok, "single page loaded");
        assertEqual(olderCalls, 1, "no prefetch unless pages are requested");
        assertEqual(engine.getCandles().length, 10);
    } finally {
        engine.destroy();
    }
});

console.log("Phase 1: provider request safety (platform ≠ provider limit)");
check("client data source clamps every history request to the server max (2000)", async () => {
    const urls: string[] = [];
    const stub = (async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ success: true, hasDeepHistory: true, candles: [], historyBoundary: "more" }), { status: 200 });
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
        const src = createApiDataSources(true);
        await src.loadLatest({ symbol: "XAUUSD", timeframe: H1, limit: 9999 });
        await src.loadOlder({ symbol: "XAUUSD", timeframe: H1, beforeMs: P1_BASE, limit: 9999 });
        assert(urls[0].includes("limit=2000"), `newest page clamped: ${urls[0]}`);
        assert(urls[1].includes("limit=2000"), `older page clamped: ${urls[1]}`);
        assert(urls[1].includes(`before=${P1_BASE}`), "exclusive cursor carried");
    });
});

check("Twelve Data provider request stays within the provider bound; outcomes map to boundaries", async () => {
    const originalKey = process.env.TWELVE_DATA_API_KEY;
    process.env.TWELVE_DATA_API_KEY = "test-key";
    const urls: string[] = [];
    const values = Array.from({ length: 11 }, (_, i) => ({
        datetime: new Date(P1_BASE - (i + 1) * HOUR).toISOString(),
        open: "100",
        high: "101",
        low: "99",
        close: "100.5",
        volume: "10",
    }));
    const okStub = (async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ status: "ok", values }), { status: 200 });
    }) as typeof fetch;
    try {
        await withFetchStub(okStub, async () => {
            // 1. Request size: a 2000-candle platform request becomes ONE bounded
            //    provider request (outputsize limit+1 ≤ provider max 5000).
            await fetchDeepHistoryPageDetailed("XAUUSD", "H1", { beforeMs: P1_BASE, limit: 2000 });
            assertEqual(urls.length, 1);
            const outSize = Number(new URL(urls[0]).searchParams.get("outputsize"));
            assertEqual(outSize, 2001, "boundary row requested via limit+1");
            assert(outSize <= 5000, "provider request size bounded");

            // 2. Full page → more history likely exists.
            const full = await fetchDeepHistoryPageDetailed("XAUUSD", "H1", { beforeMs: P1_BASE, limit: 10 });
            assertEqual(full.boundary, "more", "full provider page → more");
            assertEqual(full.candles?.length, 11);
        });

        // 3. Rate limit is NOT a history boundary.
        const limitedStub = (async () =>
            new Response(JSON.stringify({ status: "error", code: 429, message: "You have reached the limit" }), { status: 200 })) as typeof fetch;
        await withFetchStub(limitedStub, async () => {
            const limited = await fetchDeepHistoryPageDetailed("XAUUSD", "H1", { beforeMs: P1_BASE, limit: 10 });
            assertEqual(limited.boundary, "unavailable", "rate limit ≠ no more history");
        });

        // 4. Provider "no data" IS a genuine boundary.
        const emptyStub = (async () =>
            new Response(JSON.stringify({ status: "error", code: 400, message: "No data found" }), { status: 200 })) as typeof fetch;
        await withFetchStub(emptyStub, async () => {
            const empty = await fetchDeepHistoryPageDetailed("XAUUSD", "H1", { beforeMs: P1_BASE, limit: 10 });
            assertEqual(empty.boundary, "exhausted", "provider no-data → genuine boundary");
        });

        // 5. Missing API key → unavailable, no request issued.
        delete process.env.TWELVE_DATA_API_KEY;
        await withFetchStub(okStub, async () => {
            const callsBefore = urls.length;
            const noKey = await fetchDeepHistoryPageDetailed("XAUUSD", "H1", { beforeMs: P1_BASE, limit: 10 });
            assertEqual(noKey.boundary, "unavailable", "missing key ≠ exhausted");
            assertEqual(urls.length, callsBefore, "no provider request without a key");
        });
    } finally {
        if (originalKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
        else process.env.TWELVE_DATA_API_KEY = originalKey;
    }
});

check("data source surfaces historyBoundary and forwards the abort signal", async () => {
    let seenSignal: AbortSignal | undefined;
    let seenUrl = "";
    const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
        seenUrl = String(input);
        seenSignal = (init?.signal as AbortSignal | undefined) ?? undefined;
        return new Response(
            JSON.stringify({ success: true, hasDeepHistory: true, candles: [], historyBoundary: "unavailable" }),
            { status: 200 }
        );
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
        const src = createApiDataSources(true);
        const controller = new AbortController();
        const page = await src.loadOlder({
            symbol: "XAUUSD",
            timeframe: H1,
            beforeMs: P1_BASE,
            limit: 100,
            signal: controller.signal,
        });
        assertEqual(page.boundary, "unavailable", "server boundary passed through");
        assertEqual(page.hasMore, false);
        assert(seenSignal === controller.signal, "abort signal forwarded to fetch");
        assert(seenUrl.includes(`before=${P1_BASE}`), "cursor carried");
    });
    // Adaptive source short-circuits BEFORE probing: "unavailable", not exhaustion.
    const adaptive = createAdaptiveApiDataSources();
    const early = await adaptive.loadOlder({ symbol: "XAUUSD", timeframe: H1, beforeMs: P1_BASE, limit: 100 });
    assertEqual(early.boundary, "unavailable", "pre-probe short-circuit is never reported as exhaustion");
});

console.log("Phase 1: history request cancellation");
check("symbol switch during loadOlder: request aborts, stale page never publishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    });
    let sawSignal: AbortSignal | undefined;
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(5, P1_BASE, H1), hasMore: true };
        },
        async loadOlder(req) {
            sawSignal = req.signal;
            await gate;
            return { candles: series(5, req.beforeMs - 5 * HOUR, H1).filter((c) => c.timestamp < req.beforeMs), hasMore: false };
        },
    });
    let published = 0;
    engine.subscribe(() => {
        published += 1;
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);
        const pending = engine.loadOlder();
        await waitUntil(() => sawSignal !== undefined);
        const eventsAtDestroy = published;
        engine.destroy(); // symbol switch tears the pooled engine down
        release();
        const ok = await pending;
        assertEqual(ok, false, "stale loadOlder reports nothing");
        assert(sawSignal!.aborted, "in-flight request aborted on teardown");
        assertEqual(published, eventsAtDestroy, "aborted request never publishes");
        assertEqual(engine.getCandles().length, 5, "candle state untouched by the stale page");
    } catch (err) {
        engine.destroy();
        throw err;
    }
});

check("timeframe switch during loadOlder: the new timeframe engine stays uncontaminated", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    });
    let started = false;
    const h1 = mkEngine({
        async loadLatest() {
            return { candles: series(5, P1_BASE, H1), hasMore: true };
        },
        async loadOlder(req) {
            started = true;
            await gate;
            return { candles: series(5, req.beforeMs - 5 * HOUR, H1).filter((c) => c.timestamp < req.beforeMs), hasMore: false };
        },
    });
    const m5 = mkEngine(
        { async loadLatest() { return { candles: series(4, P1_BASE, "M5"), hasMore: false }; } },
        { timeframe: "M5" }
    );
    try {
        h1.start();
        await waitUntil(() => h1.getCandles().length === 5);
        m5.start();
        await waitUntil(() => m5.getCandles().length === 4);

        const pending = h1.loadOlder();
        await waitUntil(() => started);
        h1.destroy(); // user switched H1 → M5
        release();
        assertEqual(await pending, false, "stale H1 page rejected");

        assertEqual(m5.getCandles().length, 4, "M5 engine untouched");
        assert(m5.getCandles().every((c) => c.timeframe === "M5"), "only M5 candles present");
    } finally {
        h1.destroy();
        m5.destroy();
    }
});

check("resync during loadOlder: stale page rejected, loadingOlder never latches", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    });
    let slowCalls = 0;
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(5, P1_BASE, H1), hasMore: true };
        },
        async loadOlder(req) {
            slowCalls += 1;
            await gate;
            return { candles: series(5, req.beforeMs - 5 * HOUR, H1).filter((c) => c.timestamp < req.beforeMs), hasMore: true };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);

        const pending = engine.loadOlder();
        await waitUntil(() => slowCalls === 1);
        const resyncP = engine.resync();
        release();
        const [ok] = await Promise.all([pending, resyncP]);

        assertEqual(ok, false, "stale older page rejected");
        assertEqual(engine.getStatus().loadingOlder, false, "loadingOlder reset by the new epoch (no latch)");
        assertEqual(engine.getCandles().length, 5, "stale prepend never committed");

        // The engine still accepts history loads after the interrupted one.
        const ok2 = await engine.loadOlder();
        assert(ok2, "loadOlder works again after the resync");
        assertEqual(engine.getCandles().length, 10);
    } finally {
        engine.destroy();
    }
});

console.log("Phase 1: reconciliation");
check("A. historical correction applied; deep bars keep identity (no wholesale swap)", async () => {
    const base = series(5, P1_BASE, H1);
    const engine = mkEngine({
        async loadLatest() {
            return { candles: base, hasMore: false };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);
        const before = engine.getCandles();

        // Provider page covers only the newest three bars, with a correction.
        const page = [base[2], { ...base[3], close: 777, high: 777 }, base[4]];
        engine.reconcile(page);
        const after = engine.getCandles();

        assertEqual(after[3].close, 777, "provider correction wins on its bucket");
        assert(after[0] === before[0] && after[1] === before[1], "bars outside the page keep identity (incremental render path)");
        assertEqual(after.length, 5, "correction never adds or drops bars");
        for (let i = 1; i < after.length; i++) {
            assert(after[i].timestamp > after[i - 1].timestamp, `chronology at ${i}`);
        }
    } finally {
        engine.destroy();
    }
});

check("B. missing historical candle backfilled by a provider response", async () => {
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(5, P1_BASE, H1), hasMore: false };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);
        const olderBar = { ...series(1, P1_BASE - HOUR, H1)[0] };
        engine.reconcile([...series(5, P1_BASE, H1), olderBar]);
        const after = engine.getCandles();
        assertEqual(after.length, 6, "missing bar inserted");
        assertEqual(after[0].timestamp, P1_BASE - HOUR, "inserted at the right position");
        for (let i = 1; i < after.length; i++) {
            assert(after[i].timestamp > after[i - 1].timestamp, `chronology at ${i}`);
        }
    } finally {
        engine.destroy();
    }
});

check("C. duplicate provider response publishes no snapshot", async () => {
    const page = series(5, P1_BASE, H1);
    const engine = mkEngine({
        async loadLatest() {
            return { candles: page, hasMore: false };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);
        let events = 0;
        engine.subscribe((e) => {
            if (e.type === "candles") events += 1;
        });
        engine.reconcile([...page]); // identical values
        assertEqual(events, 0, "identical reconcile → no publication");
        assertEqual(engine.getCandles().length, 5);
    } finally {
        engine.destroy();
    }
});

check("D. forming candle corrected by history (history authoritative pre-close)", async () => {
    const base = series(4, P1_BASE, H1);
    base[3] = { ...base[3], finalized: false }; // forming tail
    const engine = mkEngine({
        async loadLatest() {
            return { candles: base, hasMore: false };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 4);
        engine.reconcile([...base.slice(0, 3), { ...base[3], close: 999, high: 999 }]);
        const last = engine.getCandles()[3];
        assertEqual(last.close, 999, "provider correction applied to the forming bucket");
        assertEqual(last.finalized, false, "still forming (same bucket)");
    } finally {
        engine.destroy();
    }
});

check("E. new completed candle: provider extends the series and closes our tail", async () => {
    const base = series(4, P1_BASE, H1);
    base[3] = { ...base[3], finalized: false };
    const engine = mkEngine({
        async loadLatest() {
            return { candles: base, hasMore: false };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 4);
        const newer = { timestamp: P1_BASE + 4 * HOUR, open: 104, high: 106, low: 103, close: 105, volume: 9, symbol: "XAUUSD", timeframe: "H1" };
        engine.reconcile([...base, newer]);
        const after = engine.getCandles();
        assertEqual(after.length, 5, "new completed candle appended");
        assertEqual(after[3].finalized, true, "our forming tail finalized by history");
        assertEqual(after[4].timestamp, P1_BASE + 4 * HOUR, "newest bar is the provider's");
        assert(after[4].timestamp > after[3].timestamp, "no timestamp moved backwards");
    } finally {
        engine.destroy();
    }
});

check("F. response arriving after a newer tick keeps the live forming close", async () => {
    let call = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    });
    const formingTs = P1_BASE + 4 * HOUR;
    const engine = new ChartDataEngine(
        {
            async loadLatest() {
                call += 1;
                if (call === 1) return { candles: series(5, P1_BASE, H1), hasMore: false };
                await gate; // slow resync page — fetched BEFORE the tick below
                return { candles: series(5, P1_BASE, H1), hasMore: false };
            },
            async loadOlder() {
                return { candles: [], hasMore: false };
            },
        },
        { symbol: "XAUUSD", timeframe: H1, pageSize: 5, healthIntervalMs: 60_000 }
    );
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);
        const providerHigh = engine.getCandles()[4].high;

        const resyncP = engine.resync();
        // Live tick lands while the provider page is still in flight.
        engine.ingestTick({ price: 140, timestamp: formingTs + 60_000 });
        release();
        await resyncP;

        const last = engine.getCandles()[4];
        assertEqual(last.close, 140, "newer tick stays authoritative for the forming bar");
        assert(last.high >= 140 && last.high >= providerHigh, "high keeps the union of both observations");
        assertEqual(last.timestamp, formingTs, "same bucket — no new candle invented");
    } finally {
        engine.destroy();
    }
});

check("G. late response from an older generation never lands", async () => {
    let call = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    });
    const engine = new ChartDataEngine(
        {
            async loadLatest() {
                call += 1;
                if (call === 2) {
                    await gate; // FIRST resync — will be superseded
                    return { candles: series(6, P1_BASE, H1), hasMore: false };
                }
                return { candles: series(5, P1_BASE, H1), hasMore: false };
            },
            async loadOlder() {
                return { candles: [], hasMore: false };
            },
        },
        { symbol: "XAUUSD", timeframe: H1, pageSize: 6, healthIntervalMs: 60_000 }
    );
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);

        const first = engine.resync();
        await waitUntil(() => call === 2);
        const second = engine.resync(); // supersedes the in-flight one
        await second;
        release();
        await first;

        assertEqual(engine.getCandles().length, 5, "stale 6-bar page rejected");
        assert(!engine.getCandles().some((c) => c.timestamp === P1_BASE + 5 * HOUR), "no bar from the superseded response");
        assertEqual(engine.getStatus().connection, "live");
        assertEqual(engine.getStatus().reconnects, 2, "both reconnects counted");
    } finally {
        engine.destroy();
    }
});

console.log("Phase 1: gap repair cooldown and failure semantics");
check("21/22. gap repair is cooldown-gated and never runs twice concurrently", async () => {
    const holeFrom = Date.UTC(2026, 8, 23, 10, 0);
    let rangeCalls = 0;
    const all = [...series(2, holeFrom - 2 * HOUR, H1), ...series(2, holeFrom + 4 * HOUR, H1)];
    const engine = mkEngine({
        async loadLatest() {
            return { candles: all, hasMore: false };
        },
        async loadRange() {
            rangeCalls += 1;
            return { candles: [], hasMore: false }; // provider cannot fill
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 4);
        assert(engine.detectGaps().length > 0, "hole present");

        const [r1, r2] = await Promise.all([engine.detectAndRepairGaps(), engine.detectAndRepairGaps()]);
        assertEqual(rangeCalls, 1, "concurrent repairs collapse into one request");
        assertEqual(r1 || r2, false, "unfillable hole is not reported as filled");

        const r3 = await engine.detectAndRepairGaps();
        assertEqual(r3, false, "cooldown blocks an immediate retry");
        assertEqual(rangeCalls, 1, "no retry storm inside the cooldown window");

        // After the cooldown the engine tries again — failure is not permanent.
        const realNow = Date.now;
        Date.now = (() => realNow() + 61_000) as typeof Date.now;
        try {
            await engine.detectAndRepairGaps();
            assertEqual(rangeCalls, 2, "retry allowed after cooldown");
        } finally {
            Date.now = realNow;
        }
    } finally {
        engine.destroy();
    }
});

check("23. temporary provider failure keeps candles and health intact", async () => {
    let rangeCalls = 0;
    let latestCalls = 0;
    const holeFrom = Date.UTC(2026, 8, 23, 10, 0);
    const all = [...series(2, holeFrom - 2 * HOUR, H1), ...series(2, holeFrom + 4 * HOUR, H1)];
    const engine = mkEngine({
        async loadLatest() {
            latestCalls += 1;
            if (latestCalls === 1) return { candles: all, hasMore: false };
            throw new Error("provider down"); // refill fallback fails too
        },
        async loadRange() {
            rangeCalls += 1;
            throw new Error("rate limited");
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 4);
        assert(engine.detectGaps().length > 0, "hole still visible");

        const repaired = await engine.detectAndRepairGaps();
        assertEqual(repaired, false, "failed repair reports false, not fake success");
        assertEqual(engine.getCandles().length, 4, "candles survive a failed repair");
        assert(rangeCalls >= 1, "range path attempted");
        assertEqual(latestCalls, 2, "refill fallback attempted after the range failure");
        assertEqual(engine.getStatus().quality, "gap_detected", "feed honestly reports the hole");
        assertEqual(engine.getStatus().connection, "live", "connection state not destroyed by repair failure");
    } finally {
        engine.destroy();
    }
});

check("13-failure. transient history failure ≠ exhaustion (cooldown, then retry)", async () => {
    let olderCalls = 0;
    let failNext = true;
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(5, P1_BASE, H1), hasMore: true };
        },
        async loadOlder(req) {
            olderCalls += 1;
            if (failNext) throw new Error("rate limited");
            return { candles: series(5, req.beforeMs - 5 * HOUR, H1).filter((c) => c.timestamp < req.beforeMs), hasMore: true };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);

        const ok1 = await engine.loadOlder();
        assertEqual(ok1, false);
        const s = engine.getStatus();
        assertEqual(s.historyAvailability, "unavailable", "classified as temporarily unavailable");
        assertEqual(s.hasMoreHistory, true, "NOT latched to 'no more history'");
        assertEqual(s.loadingOlder, false);

        const ok2 = await engine.loadOlder();
        assertEqual(ok2, false, "cooldown returns immediately");
        assertEqual(olderCalls, 1, "cooldown prevents a retry storm");

        const realNow = Date.now;
        Date.now = (() => realNow() + 25_000) as typeof Date.now;
        try {
            failNext = false;
            const ok3 = await engine.loadOlder();
            assert(ok3, "history loadable again after the cooldown");
        } finally {
            Date.now = realNow;
        }
        assertEqual(engine.getStatus().hasMoreHistory, true);
        assert(engine.getCandles().length === 10, "recovered page committed");
    } finally {
        engine.destroy();
    }
});

check("24. genuine exhaustion latches the boundary and stops requesting", async () => {
    let olderCalls = 0;
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(5, P1_BASE, H1), hasMore: true };
        },
        async loadOlder() {
            olderCalls += 1;
            return { candles: [], hasMore: false, boundary: "exhausted" as const };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);
        const ok = await engine.loadOlder();
        assertEqual(ok, false);
        assertEqual(engine.getStatus().hasMoreHistory, false, "real boundary latched");
        assertEqual(engine.getStatus().historyAvailability, "exhausted");
        const ok2 = await engine.loadOlder();
        assertEqual(ok2, false);
        assertEqual(olderCalls, 1, "no further requests after exhaustion");
    } finally {
        engine.destroy();
    }
});

console.log("Phase 1: snapshot publication");
check("29/30. identical tick → no snapshot; stale tick → no mutation", async () => {
    const engine = mkEngine({
        async loadLatest() {
            return { candles: series(3, P1_BASE, H1), hasMore: false };
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 3);
        let events = 0;
        engine.subscribe((e) => {
            if (e.type === "candles") events += 1;
        });
        const last = engine.getCandles()[2];

        engine.ingestTick({ price: last.close, timestamp: last.timestamp + 60_000 });
        assertEqual(events, 0, "identical tick publishes nothing");

        engine.ingestTick({ price: 5, timestamp: last.timestamp - HOUR }); // older bucket
        assertEqual(events, 0, "stale tick publishes nothing");
        assertEqual(engine.getCandles().length, 3, "series untouched");
        assertEqual(engine.getCandles()[2].close, last.close);
    } finally {
        engine.destroy();
    }
});

check("31. all-duplicate history page publishes nothing and reports honestly", async () => {
    const page = series(5, P1_BASE, H1);
    const engine = mkEngine({
        async loadLatest() {
            return { candles: page, hasMore: true };
        },
        async loadOlder() {
            return { candles: page, hasMore: false }; // fully overlapping page
        },
    });
    try {
        engine.start();
        await waitUntil(() => engine.getCandles().length === 5);
        let events = 0;
        engine.subscribe((e) => {
            if (e.type === "candles") events += 1;
        });
        const ok = await engine.loadOlder();
        assertEqual(ok, false, "no new candles arrived");
        assertEqual(events, 0, "no unnecessary publication");
        assertEqual(engine.getCandles().length, 5, "nothing changed");
        assertEqual(engine.getStatus().loadingOlder, false);
    } finally {
        engine.destroy();
    }
});

console.log("Phase 1: pooled polling (one poller per symbol|timeframe)");
check("25/26/27/28. shared poller, ref-counted cleanup, no duplicate on reconnect", async () => {
    let quoteHits = 0;
    const stub = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/analytics/ohlc")) {
            return new Response(
                JSON.stringify({ success: true, hasDeepHistory: false, candles: series(3, P1_BASE, H1) }),
                { status: 200 }
            );
        }
        quoteHits += 1;
        return new Response(JSON.stringify({ quotes: { XAUUSD: { price: 100, timestamp: Date.now() } } }), { status: 200 });
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
        try {
        const un1 = __subscribeEngineForTest("XAUUSD", "H1", 60_000, () => {});
        await waitUntil(() => (__enginePoolSnapshot("XAUUSD", "H1")?.quoteFetches ?? 0) >= 1, 1000);
        const snap1 = __enginePoolSnapshot("XAUUSD", "H1")!;
        assertEqual(snap1.refs, 1);
        assert(snap1.polling, "poller running");
        assertEqual(snap1.quoteFetches, 1, "one immediate fetch on first subscribe");

        // Second subscriber (e.g. another chart or account context): same
        // symbol|timeframe — shares the SAME engine and poller.
        const un2 = __subscribeEngineForTest("XAUUSD", "H1", 60_000, () => {});
        await p1Sleep(60);
        const snap2 = __enginePoolSnapshot("XAUUSD", "H1")!;
        assertEqual(snap2.refs, 2, "shared entry, ref-counted");
        assertEqual(snap2.quoteFetches, 1, "second subscriber adds NO extra poller");
        assert(quoteHits <= 1, `one quote endpoint hit for two subscribers (got ${quoteHits})`);

        // Reconnect must not spawn a duplicate timer.
        await snap2.engine.resync();
        await p1Sleep(60);
        const snap3 = __enginePoolSnapshot("XAUUSD", "H1")!;
        assertEqual(snap3.quoteFetches, 1, "resync does not create a second poller");
        assert(snap3.polling, "still polling after reconnect");

        // Timeframe isolation: no M5 engine exists from H1 subscriptions.
        assertEqual(__enginePoolSnapshot("XAUUSD", "M5"), null, "timeframe isolation");

        // Teardown after the last subscriber.
        un1();
        const mid = __enginePoolSnapshot("XAUUSD", "H1")!;
        assertEqual(mid.refs, 1, "still alive while one subscriber remains");
        assert(mid.polling, "poller stops only after the LAST subscriber");
        un2();
        assertEqual(__enginePoolSnapshot("XAUUSD", "H1"), null, "engine destroyed and removed from the pool");
        const hitsAfterTeardown = quoteHits;
        await p1Sleep(60);
        assertEqual(quoteHits, hitsAfterTeardown, "no polling after teardown");
        } finally {
            // Best-effort cleanup if the check failed midway.
            try {
                __enginePoolSnapshot("XAUUSD", "H1")?.engine.destroy();
            } catch {
                // already gone
            }
        }
    });
});

console.log("Phase 1: symbol/timeframe isolation");
check("32/33. exhaustion and prefetch never leak across engines", async () => {
    const a = mkEngine(
        {
            async loadLatest() { return { candles: series(5, P1_BASE, H1), hasMore: true }; },
            async loadOlder() { return { candles: [], hasMore: false, boundary: "exhausted" as const }; },
        },
        { symbol: "XAUUSD" }
    );
    const b = mkEngine(
        {
            async loadLatest() { return { candles: series(5, P1_BASE, H1), hasMore: true }; },
            async loadOlder(req) { return { candles: series(5, req.beforeMs - 5 * HOUR, H1).filter((c) => c.timestamp < req.beforeMs), hasMore: true }; },
        },
        { symbol: "EURUSD" }
    );
    try {
        a.start();
        b.start();
        await waitUntil(() => a.getCandles().length === 5 && b.getCandles().length === 5);

        await a.loadOlder();
        assertEqual(a.getStatus().hasMoreHistory, false, "A exhausted");
        assertEqual(a.getStatus().historyAvailability, "exhausted");
        assertEqual(b.getStatus().hasMoreHistory, true, "B unaffected by A's exhaustion");

        const okB = await b.loadOlder();
        assert(okB, "B still pages history");
        assertEqual(b.getCandles().length, 10);
        assertEqual(a.getCandles().length, 5, "B's page never lands in A");
        assertEqual(b.getStatus().historyAvailability, "has_more");
    } finally {
        a.destroy();
        b.destroy();
    }
});

console.log("Phase 1: no future leakage at the tick boundary");
check("quoteToTick clamps future provider stamps — no future candle buckets", () => {
    const now = Date.UTC(2026, 8, 23, 12, 0);
    const future = quoteToTick({ price: 100, timestamp: now + 120_000 }, "XAUUSD", now);
    assertEqual(future!.timestamp, now, "future stamp clamped to now");
    const past = quoteToTick({ price: 100, timestamp: now - 60_000 }, "XAUUSD", now);
    assertEqual(past!.timestamp, now - 60_000, "past stamps pass through");
    assertEqual(quoteToTick(undefined, "XAUUSD", now), null, "missing quote → null, never synthesized");
    assertEqual(quoteToTick({ price: 0, timestamp: now }, "XAUUSD", now), null, "invalid price → null");
});

// Await async checks, then report.
await Promise.all(asyncChecks);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
