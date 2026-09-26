/**
 * Pro Scalping Terminal — self-verifying checks for the pure modules.
 *
 * The repo has no global test-runner install (bare describe/it files elsewhere
 * under tests/ are not type-clean either), so this suite is a standalone
 * runnable: `npx jiti tests/pro-scalping-terminal.test.ts` executes every
 * check and exits non-zero on the first failure. The pure modules under test
 * are exactly the ones the terminal UI depends on.
 */

import {
    computeJournalAnalytics,
    fmtPrice,
    parseTrades,
    positionSize,
    sessionState,
    type TerminalTrade,
} from "../components/pro-scalping-terminal/terminal-utils";
import { CHART_LAYERS, defaultLayerState } from "../components/pro-scalping-terminal/chart-layers";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
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

function assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = ""): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message} Expected ${b} but got ${a}`);
}

console.log("Terminal price formatting");
check("uses broker-style digits per symbol family", () => {
    assertEqual(fmtPrice(2358.4, "XAUUSD"), "2358.40");
    assertEqual(fmtPrice(1.084523, "EURUSD"), "1.08452");
    assertEqual(fmtPrice(155.3216, "USDJPY"), "155.322");
    assertEqual(fmtPrice(20120.123, "NAS100"), "20120.12");
});
check("renders em-dash for missing values instead of a fabricated number", () => {
    assertEqual(fmtPrice(null, "EURUSD"), "—");
    assertEqual(fmtPrice(undefined, "EURUSD"), "—");
    assertEqual(fmtPrice(Number.NaN, "EURUSD"), "—");
});

console.log("Session state");
check("marks the active UTC windows and names the overlap", () => {
    // 2026-09-23 is a Wednesday; 14:00 UTC is London + NY + overlap.
    const wed = sessionState(Date.UTC(2026, 8, 23, 14, 0));
    const byKey = new Map(wed.rows.map((r) => [r.key, r]));
    assert(byKey.get("london")?.active === true, "London should be active at 14:00 UTC");
    assert(byKey.get("new_york")?.active === true, "NY should be active at 14:00 UTC");
    assert(byKey.get("overlap")?.active === true, "Overlap should be active at 14:00 UTC");
    assert(byKey.get("asian")?.active === false, "Asia should be closed at 14:00 UTC");
    assertEqual(wed.weekend, false);
    assertEqual(wed.activeLabel, "London / NY overlap");
});
check("flags the weekend with a positive Asia-open countdown", () => {
    // 2026-09-26 is a Saturday.
    const sat = sessionState(Date.UTC(2026, 8, 26, 12, 0));
    assertEqual(sat.weekend, true);
    assertEqual(sat.activeLabel, "Weekend — market closed");
    assertEqual(sat.nextEventLabel, "Asia opens");
    assert((sat.nextEventInMin ?? 0) > 0, "Countdown to Monday open should be positive");
});
check("always reports a next event during the week", () => {
    const st = sessionState(Date.UTC(2026, 8, 23, 3, 30)); // Asia, Wednesday
    assert(st.nextEventInMin !== null, "nextEventInMin should be set");
    assert((st.nextEventInMin as number) > 0, "Countdown should be positive");
});

console.log("Journal parsing and analytics");
const trades: TerminalTrade[] = [
    { id: "1", symbol: "XAUUSD", direction: "long", setup: "Sweep", result: "win", r: 2.0, createdAt: 1, session: "NY", timeframe: "M5" },
    { id: "2", symbol: "XAUUSD", direction: "long", setup: "Sweep", result: "loss", r: -1.0, createdAt: 2, session: "NY", timeframe: "M5" },
    { id: "3", symbol: "EURUSD", direction: "long", setup: "FVG", result: "win", r: 1.5, createdAt: 3, session: "London", timeframe: "M1" },
];
check("derives win rate over decided trades and real R sums", () => {
    const a = computeJournalAnalytics(trades);
    assertEqual(a.total, 3);
    assert(a.winRate !== null && Math.abs(a.winRate - 66.666) < 0.1, `winRate ${a.winRate} should be ~66.7`);
    assert(a.netR !== null && Math.abs(a.netR - 2.5) < 1e-9, `netR ${a.netR} should be 2.5`);
    assert(a.profitFactor !== null && Math.abs(a.profitFactor - 3.5) < 1e-9, `profitFactor ${a.profitFactor} should be 3.5`);
    assertEqual(a.best, 2.0);
    assertEqual(a.worst, -1.0);
});
check("tracks the current streak from the newest entry", () => {
    assertEqual(computeJournalAnalytics(trades).streak, { kind: "win", count: 1 });
});
check("groups by setup with per-group net R", () => {
    const sweep = computeJournalAnalytics(trades).bySetup.find((b) => b.key === "Sweep");
    assertEqual(sweep?.n, 2);
    assert(sweep && Math.abs(sweep.netR - 1.0) < 1e-9, `sweep netR ${sweep?.netR} should be 1.0`);
});
check("returns null metrics on an empty journal instead of zeros", () => {
    const a = computeJournalAnalytics([]);
    assertEqual(a.total, 0);
    assertEqual(a.winRate, null);
    assertEqual(a.netR, null);
    assertEqual(a.streak, null);
});
check("parses raw API records and skips unlabelled rows", () => {
    const raw = [
        { id: "a", symbol: "XAUUSD", result: "WIN", resultR: 2.1, createdAt: 10 },
        { id: "b", symbol: "BTCUSD", outcome: "LOSS", r: -0.8 },
        { id: "c", symbol: "EURUSD", note: "no result yet" },
        null,
    ];
    const parsed = parseTrades(raw);
    assertEqual(parsed.length, 2);
    assertEqual(parsed[0].result, "win");
    assert(parsed[0].r !== null && Math.abs(parsed[0].r - 2.1) < 1e-9, "first trade R should be 2.1");
    assertEqual(parsed[1].result, "loss");
});

console.log("Position sizing");
check("sizes a long from balance, risk % and stop distance", () => {
    const s = positionSize(10_000, 1, 2358.5, 2350.0, "XAUUSD");
    assert(s !== null, "sizing should resolve");
    if (!s) return;
    assert(Math.abs(s.riskAmount - 100) < 1e-9, "risk amount should be 100");
    assert(Math.abs(s.stopDistance - 8.5) < 1e-9, "stop distance should be 8.5");
    assert(Math.abs(s.lots - 100 / (8.5 * 100)) < 1e-9, "lots should be risk / (distance × 100 oz)");
});
check("refuses degenerate inputs instead of returning a size", () => {
    assertEqual(positionSize(0, 1, 100, 90, "EURUSD"), null);
    assertEqual(positionSize(10_000, 0, 100, 90, "EURUSD"), null);
    assertEqual(positionSize(10_000, 1, 100, 100, "EURUSD"), null);
    assertEqual(positionSize(Number.NaN, 1, 100, 90, "EURUSD"), null);
});

console.log("Chart layer vocabulary");
check("exposes every layer id in the default state map", () => {
    const state = defaultLayerState();
    for (const layer of CHART_LAYERS) {
        assert(typeof state[layer.id] === "boolean", `layer ${layer.id} missing from default state`);
    }
});
check("does not default-on an unavailable layer", () => {
    for (const layer of CHART_LAYERS) {
        if (!layer.available) assertEqual(layer.defaultOn, false);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
