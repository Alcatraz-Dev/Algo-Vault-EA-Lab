/**
 * Phase 2 — Pro Terminal viewport state machine.
 *
 * Runs with:
 *
 *     npx jiti tests/viewport-state-machine.test.ts
 *
 * Covers the ViewportController contract against a deterministic mocked
 * lightweight-charts TimeScaleApi: initial fit, live-follow vs user-pan,
 * go-live, append/prepend/repair/reconciliation preservation, focus, context
 * resets, resize, bar-spacing survival, generation staleness, detach and
 * instance isolation. No screenshots, no pixels — logical coordinates only.
 */

import {
    FOCUS_HALF_BARS,
    LIVE_EDGE_TOLERANCE_BARS,
    ViewportController,
    isNearLiveEdge,
    type ViewportSnapshot,
    type ViewportTimeScaleLike,
} from "../lib/chart-engine/viewport";
import type { LogicalRange } from "../lib/chart-engine/coordinate-mapping";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
    try {
        fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg?: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`${msg ?? "values differ"} — expected ${e}, got ${a}`);
    }
}

// ── deterministic TimeScale mock ────────────────────────────────────────────

const RIGHT_OFFSET_BARS = 6; // mirrors the ProTerminalChart chart options

class MockTimeScale implements ViewportTimeScaleLike {
    range: LogicalRange | null = null;
    barCount = 0;
    /** Mirrors native behaviour: fitContent re-picks the spacing. */
    barSpacing = 8;
    readonly calls = { fitContent: 0, scrollToRealTime: 0, setVisibleLogicalRange: 0 };
    readonly writtenRanges: LogicalRange[] = [];
    private readonly subscribers: Array<(range: LogicalRange | null) => void> = [];

    subscribe(fn: (range: LogicalRange | null) => void): void {
        this.subscribers.push(fn);
    }

    /** Synchronous echo, exactly like lightweight-charts emits on change. */
    private emit(): void {
        const snapshot = this.range ? { ...this.range } : null;
        for (const fn of this.subscribers) fn(snapshot);
    }

    getVisibleLogicalRange(): LogicalRange | null {
        return this.range ? { ...this.range } : null;
    }

    setVisibleLogicalRange(range: LogicalRange): void {
        this.calls.setVisibleLogicalRange += 1;
        this.writtenRanges.push({ ...range });
        this.range = { ...range };
        this.emit();
    }

    fitContent(): void {
        this.calls.fitContent += 1;
        this.barSpacing = 4; // fitting the whole dataset shrinks the bars
        this.range = this.barCount > 0 ? { from: 0, to: this.barCount - 1 + RIGHT_OFFSET_BARS } : null;
        this.emit();
    }

    scrollToRealTime(): void {
        this.calls.scrollToRealTime += 1;
        if (this.barCount <= 0) return;
        const to = this.barCount - 1 + RIGHT_OFFSET_BARS;
        const span = this.range ? this.range.to - this.range.from : 100;
        this.range = { from: to - span, to };
        this.emit();
    }

    /** Test-only: the user pans/zooms natively → range event fires. */
    userSetsRange(range: LogicalRange): void {
        this.range = { ...range };
        this.emit();
    }

    mutatingCalls(): number {
        return this.calls.fitContent + this.calls.scrollToRealTime + this.calls.setVisibleLogicalRange;
    }

    resetCalls(): void {
        this.calls.fitContent = 0;
        this.calls.scrollToRealTime = 0;
        this.calls.setVisibleLogicalRange = 0;
        this.writtenRanges.length = 0;
    }
}

const HOUR = 3_600;
const T0 = 1_700_000_000; // fixed past timestamp (seconds)

function makeTimes(count: number, start = T0, step = HOUR): number[] {
    return Array.from({ length: count }, (_, i) => start + i * step);
}

interface Harness {
    ts: MockTimeScale;
    vp: ViewportController;
    followingLog: boolean[];
    setBars(n: number): void;
}

/** Mirrors the renderer wiring: range events feed the controller. */
function harness(barCount = 400): Harness {
    const ts = new MockTimeScale();
    ts.barCount = barCount;
    const vp = new ViewportController();
    const followingLog: boolean[] = [];
    vp.subscribe((following) => {
        followingLog.push(following);
    });
    ts.subscribe((range) => vp.handleRangeChange(range));
    vp.attach(ts);
    vp.setBarCount(barCount);
    return {
        ts,
        vp,
        followingLog,
        setBars: (n: number) => {
            ts.barCount = n;
            vp.setBarCount(n);
        },
    };
}

/** A viewport sitting at the live edge (what scrollToRealTime leaves). */
function atRest(h: Harness): void {
    h.ts.userSetsRange({ from: h.ts.barCount - 101 + RIGHT_OFFSET_BARS, to: h.ts.barCount - 1 + RIGHT_OFFSET_BARS });
    h.vp.handleRangeChange(h.ts.getVisibleLogicalRange());
}

/** A viewport panned deep into history (well left of the live edge). */
function panned(h: Harness, from = 100, to = 200): void {
    h.ts.userSetsRange({ from, to });
    h.vp.handleRangeChange(h.ts.getVisibleLogicalRange());
}

console.log("Live-edge rule");
check("isNearLiveEdge is purely logical and tolerance-bounded", () => {
    assert(isNearLiveEdge({ from: 300, to: 405 }, 400), "rest position (to = barCount - 1 + rightOffset) is at the edge");
    assert(isNearLiveEdge({ from: 300, to: 398.5 }, 400), "exactly at the tolerance threshold");
    assert(!isNearLiveEdge({ from: 100, to: 200 }, 400), "deep history is not at the edge");
    assert(isNearLiveEdge({ from: 0, to: 10 }, 0), "empty dataset trivially follows live");
    // Tolerance behaves identically regardless of bar spacing / window size.
    const tolerance = LIVE_EDGE_TOLERANCE_BARS;
    assertEqual(tolerance, 1.5, "tolerance is a named logical constant");
});

console.log("Initial view");
check("1. initial fit runs the single fit policy", () => {
    const h = harness();
    h.vp.reset("initial");
    h.vp.initialFit();
    assertEqual(h.ts.calls.fitContent, 1, "exactly one fitContent");
    assertEqual(h.ts.getVisibleLogicalRange(), { from: 0, to: 399 + RIGHT_OFFSET_BARS }, "fits the loaded dataset");
});
check("2. initial live-follow state is FOLLOWING_LIVE", () => {
    const h = harness();
    assert(h.vp.isFollowingLive(), "a fresh controller follows live by default");
    h.vp.reset("initial");
    h.vp.initialFit();
    assert(h.vp.isFollowingLive(), "still following after the initial fit");
    assertEqual(h.vp.getPhase(), "FOLLOWING_LIVE", "phase is explicit");
});

console.log("Follow / pan / go-live");
check("3. user pan disengages follow", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 50, 120);
    assert(!h.vp.isFollowingLive(), "follow disengaged past the tolerance");
    assertEqual(h.vp.getPhase(), "USER_PANNED", "explicit USER_PANNED phase");
    assertEqual(h.followingLog[h.followingLog.length - 1], false, "subscriber notified of the flip");
});
check("4. go-live re-engages follow deterministically", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 10, 60);
    h.vp.enterLiveFollow();
    assert(h.vp.isFollowingLive(), "following again");
    assertEqual(h.vp.getPhase(), "FOLLOWING_LIVE", "phase transition");
    assertEqual(h.ts.calls.scrollToRealTime, 1, "scrolls the native scale to real time");
    assertEqual(h.ts.getVisibleLogicalRange(), { from: 399 + RIGHT_OFFSET_BARS - 50, to: 399 + RIGHT_OFFSET_BARS }, "lands exactly at the latest area");
});

console.log("Append behaviour");
check("5. append while following live re-asserts the live edge", () => {
    const h = harness();
    h.vp.initialFit();
    h.ts.resetCalls();
    h.vp.handleDataAppend(400, 401);
    h.setBars(401);
    assertEqual(h.ts.calls.scrollToRealTime, 1, "live edge re-asserted once");
    assertEqual(h.ts.calls.fitContent, 0, "never fits");
    assert(h.vp.isFollowingLive(), "still following");
});
check("6. append while user-panned performs zero mutating viewport calls", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 100, 200);
    const before = h.ts.getVisibleLogicalRange();
    h.ts.resetCalls();
    h.vp.handleDataAppend(400, 401);
    h.setBars(401);
    assertEqual(h.ts.mutatingCalls(), 0, "no fit, no scroll, no range write");
    assertEqual(h.ts.getVisibleLogicalRange(), before, "viewport untouched");
    assert(!h.vp.isFollowingLive(), "remains user-panned");
});
check("24. no fitContent on ordinary append (either mode)", () => {
    const following = harness();
    following.vp.initialFit();
    following.ts.resetCalls();
    following.vp.handleDataAppend(400, 401);
    const pannedH = harness();
    pannedH.vp.initialFit();
    panned(pannedH, 100, 200);
    pannedH.ts.resetCalls();
    pannedH.vp.handleDataAppend(400, 401);
    assertEqual(following.ts.calls.fitContent, 0, "following: no fit");
    assertEqual(pannedH.ts.calls.fitContent, 0, "panned: no fit");
});

console.log("Prepend / deep history");
function prependFixture(barCount = 400, prependCount = 300): { h: Harness; prevTimes: number[]; newTimes: number[] } {
    const h = harness(barCount);
    h.vp.initialFit();
    const prevTimes = makeTimes(barCount);
    const newTimes = [...makeTimes(prependCount, T0 - prependCount * HOUR), ...prevTimes];
    return { h, prevTimes, newTimes };
}
check("7. prepend while following live preserves the live edge", () => {
    const { h, prevTimes, newTimes } = prependFixture();
    atRest(h);
    h.ts.resetCalls();
    const snap = h.vp.prependStarted(prevTimes);
    assert(snap !== null, "snapshot captured");
    h.setBars(newTimes.length);
    const shift = h.vp.prependCompleted(snap!, newTimes);
    assertEqual(shift, 300, "shift equals the prepended bars");
    assertEqual(h.ts.calls.setVisibleLogicalRange, 1, "exactly one compensation");
    assertEqual(h.ts.calls.fitContent, 0, "never fits");
    assert(h.vp.isFollowingLive(), "remains FOLLOWING_LIVE");
    const range = h.ts.getVisibleLogicalRange()!;
    assertEqual(range.to, newTimes.length - 1 + RIGHT_OFFSET_BARS, "right edge sits at the new live edge");
});
check("8. prepend while user-panned keeps the user's market area and stays panned", () => {
    const { h, prevTimes, newTimes } = prependFixture();
    panned(h, 100, 200);
    h.ts.resetCalls();
    const snap = h.vp.prependStarted(prevTimes)!;
    h.setBars(newTimes.length);
    const shift = h.vp.prependCompleted(snap, newTimes);
    assertEqual(shift, 300, "one shift of 300");
    assertEqual(h.ts.calls.setVisibleLogicalRange, 1, "single compensation");
    const range = h.ts.getVisibleLogicalRange()!;
    assertEqual(range.from, 400, "same market bars at the same screen positions");
    assertEqual(range.to, 500, "width unchanged");
    assert(!h.vp.isFollowingLive(), "remains USER_PANNED");
});
check("9. multi-page prepend causes exactly one compensation", () => {
    // Three pages (100 bars each) committed as ONE canonical update.
    const { h, prevTimes, newTimes } = prependFixture(400, 300);
    atRest(h);
    h.ts.resetCalls();
    const snap = h.vp.prependStarted(prevTimes)!;
    h.setBars(newTimes.length);
    h.vp.prependCompleted(snap, newTimes);
    assertEqual(h.ts.calls.setVisibleLogicalRange, 1, "one write for the whole batch");
    assertEqual(h.ts.writtenRanges[0], { from: 305 + 300, to: 405 + 300 }, "single shift by the full batch size");
});
check("10. prepend preserves the same market anchor", () => {
    const { h, prevTimes, newTimes } = prependFixture();
    panned(h, 100, 200);
    const snap = h.vp.prependStarted(prevTimes)!;
    h.setBars(newTimes.length);
    h.vp.prependCompleted(snap, newTimes);
    const range = h.ts.getVisibleLogicalRange()!;
    assertEqual(newTimes[range.from], prevTimes[100], "leftmost visible bar is the same candle after the prepend");
    assertEqual(newTimes[range.to - 1], prevTimes[199], "rightmost visible bar is the same candle after the prepend");
});
check("32. prepend does not accidentally enable live-follow", () => {
    const { h, prevTimes, newTimes } = prependFixture();
    panned(h, 0, 50); // hard left, deep history
    const snap = h.vp.prependStarted(prevTimes)!;
    h.setBars(newTimes.length);
    h.vp.prependCompleted(snap, newTimes);
    assert(!h.vp.isFollowingLive(), "still USER_PANNED after compensation");
    assertEqual(h.vp.getPhase(), "USER_PANNED", "no hidden transition to FOLLOWING_LIVE");
});
check("22. bar spacing survives prepend", () => {
    const { h, prevTimes, newTimes } = prependFixture();
    atRest(h);
    h.ts.barSpacing = 17; // user zoomed in
    h.ts.resetCalls();
    const snap = h.vp.prependStarted(prevTimes)!;
    h.setBars(newTimes.length);
    h.vp.prependCompleted(snap, newTimes);
    assertEqual(h.ts.barSpacing, 17, "prepend never touches bar spacing");
    assertEqual(h.ts.calls.fitContent, 0, "no fit during prepend");
});

console.log("Repair / reconciliation preservation");
check("11. missing historical candle inserted preserves the visible market area", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 100, 200);
    const prevTimes = makeTimes(400);
    // Gap repair: 10 bars materialise between index 49 and 50.
    const repairTimes = Array.from({ length: 10 }, (_, k) => prevTimes[49] + (k + 1) * 600);
    const newTimes = [...prevTimes.slice(0, 50), ...repairTimes, ...prevTimes.slice(50)];
    h.ts.resetCalls();
    const snap = h.vp.capture(prevTimes)!;
    h.setBars(newTimes.length);
    const shift = h.vp.restore(snap, newTimes);
    assertEqual(shift, 10, "anchor shifted by exactly the inserted bars");
    const range = h.ts.getVisibleLogicalRange()!;
    assertEqual(newTimes[range.from], prevTimes[100], "same leftmost candle stays on screen");
    assertEqual(h.ts.calls.fitContent, 0, "no fitContent on gap repair");
    assert(!h.vp.isFollowingLive(), "stays USER_PANNED");
});
check("6b. gap repair while following live stays following live", () => {
    const h = harness();
    h.vp.initialFit();
    atRest(h);
    const prevTimes = makeTimes(400);
    const repairTimes = Array.from({ length: 50 }, (_, k) => prevTimes[99] + (k + 1) * 600);
    const newTimes = [...prevTimes.slice(0, 100), ...repairTimes, ...prevTimes.slice(100)];
    h.ts.resetCalls();
    const snap = h.vp.capture(prevTimes)!;
    h.setBars(newTimes.length);
    h.vp.restore(snap, newTimes);
    assert(h.vp.isFollowingLive(), "right-edge anchor keeps the user glued to the live edge");
    assertEqual(h.ts.calls.fitContent, 0, "no fitContent on repair");
});
check("12. reconciliation (same candles) preserves the viewport", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 120, 220);
    const times = makeTimes(400);
    const before = h.ts.getVisibleLogicalRange();
    h.ts.resetCalls();
    const snap = h.vp.capture(times)!;
    h.setBars(400);
    const shift = h.vp.restore(snap, times);
    h.vp.handleDataMutation(400);
    assertEqual(shift, 0, "identical timeline → no shift");
    assertEqual(h.ts.mutatingCalls(), 0, "zero viewport mutations");
    assertEqual(h.ts.getVisibleLogicalRange(), before, "range byte-identical");
    assert(!h.vp.isFollowingLive(), "remains USER_PANNED");
});
check("13. corrected candle (OHLC rewrite, same timeline) preserves the viewport", () => {
    const h = harness();
    h.vp.initialFit();
    atRest(h);
    const times = makeTimes(400);
    h.ts.resetCalls();
    const snap = h.vp.capture(times)!; // provider corrected some OHLC values
    h.setBars(400);
    h.vp.restore(snap, times);
    h.vp.handleDataMutation(400);
    assertEqual(h.ts.mutatingCalls(), 0, "corrections never move the viewport");
    assert(h.vp.isFollowingLive(), "still following after the correction");
});
check("14. duplicate history row causes no viewport mutation", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 100, 200);
    // Provider returned 401 rows with one duplicate; the renderer dedupes
    // before commit, so the controller sees an identical timeline — the
    // ignored duplicate must not move anything.
    const rawRows = [...makeTimes(400), makeTimes(400)[37]];
    const deduped = [...new Set(rawRows)].sort((a, b) => a - b);
    assertEqual(deduped.length, 400, "fixture sanity");
    h.ts.resetCalls();
    const snap = h.vp.capture(deduped)!;
    h.setBars(400);
    const shift = h.vp.restore(snap, deduped);
    assertEqual(shift, 0, "no shift for an unchanged timeline");
    assertEqual(h.ts.mutatingCalls(), 0, "no viewport mutation");
});
check("25. no fitContent on reconciliation", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 100, 200);
    const times = makeTimes(400);
    h.ts.resetCalls();
    const snap = h.vp.capture(times)!;
    h.vp.restore(snap, times);
    h.vp.handleDataMutation(405); // reconcile added closed bars
    assertEqual(h.ts.calls.fitContent, 0, "fitContent never runs for mutations");
});
check("26. no fitContent on gap repair", () => {
    const h = harness();
    h.vp.initialFit();
    atRest(h);
    const prevTimes = makeTimes(400);
    const newTimes = [...makeTimes(20, T0 - 20 * HOUR), ...prevTimes];
    h.ts.resetCalls();
    const snap = h.vp.capture(prevTimes)!;
    h.setBars(newTimes.length);
    h.vp.restore(snap, newTimes);
    assertEqual(h.ts.calls.fitContent, 0, "repair preserves, never fits");
});
check("23. zoom (bar spacing) survives reconciliation", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 100, 200);
    h.ts.barSpacing = 21;
    h.ts.resetCalls();
    const times = makeTimes(400);
    const snap = h.vp.capture(times)!;
    h.vp.restore(snap, times);
    h.vp.handleDataMutation(400);
    assertEqual(h.ts.barSpacing, 21, "reconciliation must not silently re-zoom");
    assertEqual(h.ts.calls.fitContent, 0, "no fit");
});

console.log("Focus");
check("15. focus on a historical candle lands the window and leaves live", () => {
    const h = harness();
    h.vp.initialFit();
    h.ts.resetCalls();
    const ok = h.vp.focus({ index: 50 });
    assert(ok, "focus applied");
    assertEqual(h.ts.getVisibleLogicalRange(), { from: 50 - FOCUS_HALF_BARS, to: 50 + FOCUS_HALF_BARS }, "±12-bar window on the target");
    assert(!h.vp.isFollowingLive(), "focusing history leaves live follow");
    assertEqual(h.vp.getPhase(), "USER_PANNED", "explicit, testable end state (not stuck in FOCUSING)");
    assertEqual(h.ts.calls.fitContent, 0, "focus never fits");
});
check("16. focus on the latest candle stays following live", () => {
    const h = harness();
    h.vp.initialFit();
    h.vp.focus({ index: 399 });
    assert(h.vp.isFollowingLive(), "focusing the live area keeps follow");
    assertEqual(h.vp.getPhase(), "FOLLOWING_LIVE", "explicit end state");
});
check("17. focus state transition is deterministic and reversible", () => {
    const h = harness();
    h.vp.initialFit();
    assertEqual(h.vp.getPhase(), "FOLLOWING_LIVE", "starts following");
    h.vp.focus({ index: 10 });
    assertEqual(h.vp.getPhase(), "USER_PANNED", "historical focus → panned");
    h.vp.enterLiveFollow();
    assertEqual(h.vp.getPhase(), "FOLLOWING_LIVE", "go-live → following");
    h.vp.focus({ index: 15 }); // away from live again
    assertEqual(h.vp.getPhase(), "USER_PANNED", "historical focus disengages again");
});
check("17b. focus by timestamp resolves against the candle series", () => {
    const h = harness();
    h.vp.initialFit();
    const bars = makeTimes(400).map((t) => ({ timestamp: t * 1000 }));
    const target = bars[200].timestamp;
    const ok = h.vp.focus({ timeMs: target, bars, intervalMs: HOUR * 1000 });
    assert(ok, "focus resolved");
    assertEqual(h.ts.getVisibleLogicalRange(), { from: 200 - FOCUS_HALF_BARS, to: 200 + FOCUS_HALF_BARS }, "centre bar index found by timestamp");
});

console.log("Symbol / timeframe reset");
check("18. symbol change resets the viewport context", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 100, 200);
    const staleSnap: ViewportSnapshot | null = h.vp.capture(makeTimes(400));
    const epochBefore = h.vp.getEpoch();
    const epoch = h.vp.reset("symbol");
    assertEqual(epoch, epochBefore + 1, "generation bumped");
    assertEqual(h.vp.getPhase(), "RESETTING_SYMBOL", "explicit reset phase");
    assert(h.vp.isFollowingLive(), "new context establishes live-follow");
    assertEqual(h.vp.getBarCount(), 0, "old bar count forgotten");
    assertEqual(h.vp.getVisibleRange(), null, "old logical range dropped — never restored blindly");
    // The stale snapshot from the previous symbol must be inert.
    h.ts.resetCalls();
    const shift = h.vp.restore(staleSnap!, makeTimes(400));
    assertEqual(shift, 0, "stale snapshot ignored");
    assertEqual(h.ts.mutatingCalls(), 0, "stale snapshot performs no viewport calls");
    // New dataset arrives → the single initial-fit policy runs once.
    h.setBars(250);
    h.vp.initialFit();
    assertEqual(h.ts.calls.fitContent, 1, "one initial fit for the new dataset");
    assertEqual(h.vp.getPhase(), "FOLLOWING_LIVE", "correct live-follow established");
});
check("19. timeframe change resets the viewport context", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 40, 90);
    const epochBefore = h.vp.getEpoch();
    h.vp.reset("timeframe");
    assertEqual(h.vp.getPhase(), "RESETTING_TIMEFRAME", "explicit timeframe reset phase");
    assertEqual(h.vp.getEpoch(), epochBefore + 1, "new generation — stale logical indices cannot leak");
    assertEqual(h.vp.getBarCount(), 0, "no stale bar count carried over");
    assert(h.vp.isFollowingLive(), "fresh timeframe starts following live");
});

console.log("Resize");
check("20. resize preserves the market area (panned viewport is untouched)", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 100, 200);
    const before = h.ts.getVisibleLogicalRange();
    h.ts.resetCalls();
    h.vp.handleResize();
    assertEqual(h.ts.mutatingCalls(), 0, "panned resize performs no viewport mutation");
    assertEqual(h.ts.getVisibleLogicalRange(), before, "same market region");
    assertEqual(h.vp.getPhase(), "USER_PANNED", "state unchanged");
});
check("20b. resize while following re-asserts the live edge without fitting", () => {
    const h = harness();
    h.vp.initialFit();
    h.ts.resetCalls();
    h.vp.handleResize();
    assertEqual(h.ts.calls.scrollToRealTime, 1, "live edge re-asserted");
    assertEqual(h.ts.calls.fitContent, 0, "resize is never a reason to fit");
    assert(h.vp.isFollowingLive(), "still following");
});

console.log("Generations, detach, isolation, cleanup");
check("27. stale viewport generations are ignored", () => {
    const h = harness();
    h.vp.initialFit();
    const times = makeTimes(400);
    const snap = h.vp.prependStarted(times)!;
    const staleEpoch = snap.epoch;
    h.vp.reset("symbol"); // generation changes before the commit lands
    h.ts.resetCalls();
    const shift = h.vp.prependCompleted(snap, [...makeTimes(100, T0 - 100 * HOUR), ...times]);
    assertEqual(shift, 0, "stale prepend compensation dropped");
    assertEqual(h.ts.mutatingCalls(), 0, "no viewport call from stale work");
    const applied = h.vp.focus({ index: 5 }, { epoch: staleEpoch });
    assertEqual(applied, false, "stale focus request rejected");
    assertEqual(h.ts.mutatingCalls(), 0, "stale focus performs no viewport call");
});
check("28. detached chart receives no viewport calls", () => {
    const h = harness();
    h.vp.initialFit();
    const snap = h.vp.capture(makeTimes(400))!;
    h.vp.detach();
    assert(!h.vp.isAttached(), "detached");
    h.ts.resetCalls();
    h.vp.initialFit();
    h.vp.refit();
    h.vp.enterLiveFollow();
    h.vp.handleDataAppend(400, 401);
    h.vp.handleResize();
    h.vp.focus({ index: 10 });
    h.vp.restore(snap, makeTimes(400));
    assertEqual(h.ts.mutatingCalls(), 0, "every operation after detach is a no-op on the chart");
    assertEqual(h.vp.getPhase(), "FOLLOWING_LIVE", "detach unlocks the phase instead of leaving it programmatic");
    assert(!h.vp.isProgrammatic(), "no phase stuck locked after detach");
});
check("29. multiple chart instances do not share viewport state", () => {
    const a = harness();
    const b = harness();
    a.vp.initialFit();
    b.vp.initialFit();
    const bEpoch = b.vp.getEpoch();
    panned(a, 100, 200);
    assert(!a.vp.isFollowingLive(), "instance A panned away");
    assert(b.vp.isFollowingLive(), "instance B unaffected — still following");
    assertEqual(b.vp.getPhase(), "FOLLOWING_LIVE", "independent phase");
    a.vp.reset("symbol");
    assertEqual(b.vp.getEpoch(), bEpoch, "instance B epoch untouched by A's reset");
    b.vp.enterLiveFollow();
    assertEqual(a.vp.getPhase(), "RESETTING_SYMBOL", "A's state untouched by B's go-live");
});
check("30. live-follow survives forming-candle updates", () => {
    const h = harness();
    h.vp.initialFit();
    atRest(h);
    h.ts.resetCalls();
    // Renderer contract: a forming-candle update calls no data handler at all
    // (same bar count). A subsequent native range echo re-evaluates cleanly.
    h.ts.userSetsRange({ from: 305, to: 405 });
    assert(h.vp.isFollowingLive(), "still following after the forming update");
    assertEqual(h.ts.mutatingCalls(), 0, "forming updates perform zero viewport mutations");
});
check("31. user pan survives forming-candle updates", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 100, 200);
    const before = h.ts.getVisibleLogicalRange();
    h.ts.resetCalls();
    // Forming-candle update → no data handler; a range echo keeps the state.
    h.ts.userSetsRange({ from: 100, to: 200 });
    assert(!h.vp.isFollowingLive(), "remains USER_PANNED");
    assertEqual(h.ts.getVisibleLogicalRange(), before, "viewport unchanged");
    assertEqual(h.ts.mutatingCalls(), 0, "zero mutating calls");
});
check("33. go-live moves to the latest area deterministically", () => {
    const h = harness();
    h.vp.initialFit();
    panned(h, 10, 60);
    h.ts.resetCalls();
    h.vp.enterLiveFollow();
    const range = h.ts.getVisibleLogicalRange()!;
    assertEqual(range.to, 399 + RIGHT_OFFSET_BARS, "right edge exactly at the newest bar + configured margin");
    assertEqual(range.to - range.from, 50, "visible span preserved across the jump");
    assertEqual(h.vp.getPhase(), "FOLLOWING_LIVE", "explicit post-condition");
});
check("34. viewport operations are cleaned up on unmount", () => {
    const h = harness();
    h.vp.initialFit();
    const seen: boolean[] = [];
    const unsub = h.vp.subscribe((f) => seen.push(f));
    panned(h, 100, 200); // flip → listener fired
    assertEqual(seen.length, 1, "listener notified while subscribed");
    unsub();
    unsub(); // idempotent
    h.vp.enterLiveFollow(); // flip → listener must NOT fire
    assertEqual(seen.length, 1, "no notifications after unsubscribe");
    h.vp.detach();
    h.vp.detach(); // idempotent unmount
    assert(!h.vp.isAttached(), "stays detached");
    assert(!h.vp.isProgrammatic(), "no programmatic phase left behind");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
