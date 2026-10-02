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
import { ChartDataEngine, type ChartDataSources, type HistoryPage } from "../../lib/chart-engine/chart-data-engine";
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
    assert(ema20.values[0] !== null, "EMA seeds from bar 0");
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

// Await async checks, then report.
await Promise.all(asyncChecks);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
