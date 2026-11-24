// ─────────────────────────────────────────────────────────────────────────────
// Notional accounting + breaker persistence — pure algebra, no RTDB.
//
// Run: npm run test:risk:accounting
// ─────────────────────────────────────────────────────────────────────────────

import {
    applyFillToNotionalLedger,
    effectiveDailyNotional,
    emptyNotionalLedger,
    normalizeNotionalLedger,
    notionalAccountingIncomplete,
    notionalDayKey,
    releaseInNotionalLedger,
    reserveInNotionalLedger,
    type FillObservation,
} from "../notional-ledger";
import { decideBreakerPersistence } from "../breaker-persistence";
import { createDrawdownBreaker } from "../drawdown-breaker";
import { evaluateOrder, type OrderIntent, type RiskLimits } from "../risk-engine";

let failures = 0;
function check(cond: boolean, label: string, detail?: unknown): void {
    if (cond) console.log(`  PASS: ${label}`);
    else {
        failures++;
        console.error(`  FAIL: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
}
function section(name: string): void {
    console.log(`\n${name}`);
}

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const DAY = "2026-11-24";

// ── Day boundary ─────────────────────────────────────────────────────────
section("day boundary");
check(notionalDayKey(NOW) === DAY, "UTC day key is ISO", notionalDayKey(NOW));
check(
    notionalDayKey(Date.UTC(2026, 10, 24, 23, 59, 59)) === "2026-11-24",
    "23:59:59 UTC is still the same day",
);
check(
    notionalDayKey(Date.UTC(2026, 10, 25, 0, 0, 0)) === "2026-11-25",
    "00:00 UTC starts a new day",
);
check(
    notionalDayKey(Date.UTC(2026, 10, 24, 16, 0, 0), "Asia/Tokyo") === "2026-11-25",
    "a configurable timezone moves the boundary (16:00 UTC = 01:00 JST next day)",
);
check(notionalDayKey(NOW, "Not/AZone") === DAY, "an invalid timezone falls back to UTC instead of throwing");

// ── Ledger normalization ─────────────────────────────────────────────────
section("ledger normalization");
const stale = normalizeNotionalLedger(
    { day: "2026-11-23", used: 50_000, reserved: 10_000, reservations: { a: { amount: 1 } } },
    DAY,
);
check(stale.used === 0 && stale.reserved === 0, "a previous day's ledger resets on first observation today");
check(Object.keys(stale.reservations).length === 0, "previous-day reservations do not survive the reset");

const garbage = normalizeNotionalLedger(
    { day: DAY, used: "not-a-number", reserved: -5, reservations: { bad: { amount: "x" } } },
    DAY,
);
check(garbage.used === 0 && garbage.reserved === 0, "non-numeric / negative totals are dropped, never coerced");
check(Object.keys(garbage.reservations).length === 0, "invalid reservations are dropped");

const legacy = normalizeNotionalLedger(
    { day: DAY, used: "108000", reserved: 0, fills: {}, unaccounted: {} },
    DAY,
);
check(legacy.used === 108_000, "an RTDB numeric string is accepted when finite and non-negative");

// ── Reservations ─────────────────────────────────────────────────────────
section("reservations");
let ledger = emptyNotionalLedger(DAY);
const noBudget = reserveInNotionalLedger(ledger, "req-1", 50_000, undefined, NOW);
check(noBudget.ok && !noBudget.reserved, "no configured budget → no reservation is written");

const first = reserveInNotionalLedger(ledger, "req-1", 60_000, 100_000, NOW);
check(first.ok && first.reserved, "60k reservation under a 100k budget is accepted");
if (first.ok) ledger = first.ledger;
check(ledger.reserved === 60_000 && effectiveDailyNotional(ledger) === 60_000, "reserved counts as in-flight usage");

const retry = reserveInNotionalLedger(ledger, "req-1", 60_000, 100_000, NOW + 1);
check(retry.ok && retry.idempotent === true, "the same reservation id is idempotent");
check(retry.ok && retry.ledger.reserved === 60_000, "a retried submission does not reserve twice");

const over = reserveInNotionalLedger(ledger, "req-2", 50_000, 100_000, NOW + 2);
check(!over.ok && over.code === "BUDGET_EXCEEDED", "a second submission cannot exceed the shared budget");
if (!over.ok) check(/budget reached/i.test(over.reason), "rejection explains the budget arithmetic", over.reason);

const unknownAmount = reserveInNotionalLedger(ledger, "req-3", undefined, 100_000, NOW + 3);
check(
    !unknownAmount.ok,
    "a configured budget + uncomputable notional fails closed rather than passing silently",
);

const released = releaseInNotionalLedger(ledger, "req-1", NOW + 4);
check(released.released && released.ledger.reserved === 0, "releasing a reservation frees the budget");
const releaseAgain = releaseInNotionalLedger(released.ledger, "req-1", NOW + 5);
check(!releaseAgain.released, "releasing twice is a no-op");
const nowFits = reserveInNotionalLedger(released.ledger, "req-2", 50_000, 100_000, NOW + 6);
check(nowFits.ok, "after release the previously rejected order fits");
if (nowFits.ok) ledger = nowFits.ledger;

// ── Fill accounting ──────────────────────────────────────────────────────
section("fill accounting");
const eurFill: FillObservation = {
    fillId: "req-2:555",
    orderId: "req-2",
    symbol: "EURUSD",
    volume: 1,
    price: 1.08,
    at: NOW + 10,
};
const applied = applyFillToNotionalLedger(ledger, eurFill, NOW + 10);
check(applied.valid && applied.added === 108_000, "notional = volume × contractSize × price", applied.added);
check(applied.ledger.used === 108_000, "a confirmed fill becomes committed usage");
check(applied.ledger.reserved === 0, "the fill releases the order's reservation");
check(!applied.duplicate, "first application is not a duplicate");

const replayed = applyFillToNotionalLedger(applied.ledger, eurFill, NOW + 11);
check(replayed.duplicate && replayed.added === 0, "a re-posted fill report charges nothing");
check(replayed.ledger.used === 108_000, "usage is unchanged after a duplicate report");

const partialFirst = applyFillToNotionalLedger(
    emptyNotionalLedger(DAY),
    { ...eurFill, fillId: "req-9:700", volume: 0.5 },
    NOW + 12,
);
check(partialFirst.added === 54_000, "a partial fill charges its own volume");
const partialSecond = applyFillToNotionalLedger(partialFirst.ledger, { ...eurFill, fillId: "req-9:700", volume: 1 }, NOW + 13);
check(partialSecond.added === 54_000, "a larger cumulative report charges only the delta");
check(partialSecond.ledger.used === 108_000, "partial fills sum to the full order notional");
const partialShrink = applyFillToNotionalLedger(partialSecond.ledger, { ...eurFill, fillId: "req-9:700", volume: 0.75 }, NOW + 14);
check(partialShrink.duplicate && partialShrink.ledger.used === 108_000, "usage never decreases intraday");

const unaccounted = applyFillToNotionalLedger(
    emptyNotionalLedger(DAY),
    { ...eurFill, fillId: "req-5:1", orderId: "req-5", symbol: "NOT_A_REAL_SYMBOL" },
    NOW + 15,
);
check(unaccounted.unaccounted && unaccounted.added === 0, "a symbol without a contract size is never priced by guess");
check(notionalAccountingIncomplete(unaccounted.ledger), "the day is marked incomplete so a budget cannot be silently wrong");

const invalid = applyFillToNotionalLedger(
    emptyNotionalLedger(DAY),
    { ...eurFill, fillId: "req-6:1", orderId: "req-6", volume: 0 },
    NOW + 16,
);
check(!invalid.valid && notionalAccountingIncomplete(invalid.ledger), "a fill with no usable volume is recorded as unaccounted");

// ── Risk engine: incomplete accounting ───────────────────────────────────
section("risk engine fails closed on incomplete accounting");
const entry: OrderIntent = { symbol: "EURUSD", direction: "BUY", entryKind: "LIMIT", price: 1.08, volume: 0.1, sl: 1.07, tp: 1.09 };
const budget: RiskLimits = { minLot: 0.01, lotStep: 0.01, maxLot: 10, maxDailyNotional: 1_000_000 };
const incomplete = evaluateOrder(entry, budget, { dailyNotionalUsed: 1_000, dailyNotionalIncomplete: true }, NOW);
check(incomplete.code === "DAILY_NOTIONAL_UNKNOWN", "incomplete accounting blocks new entries", incomplete);
check(
    evaluateOrder({ ...entry, protective: true }, budget, { dailyNotionalIncomplete: true }, NOW).approved,
    "incomplete accounting never blocks protective actions",
);
check(
    evaluateOrder(entry, { minLot: 0.01, lotStep: 0.01, maxLot: 10 }, { dailyNotionalIncomplete: true }, NOW).approved,
    "without a configured budget, incomplete accounting does not block",
);

// ── Breaker persistence ──────────────────────────────────────────────────
section("breaker persistence decisions");
const breakerLimits = { maxDrawdownPercent: 10, warningFraction: 0.75 };

const noLimit = decideBreakerPersistence({
    previous: null,
    limits: { maxDrawdownPercent: 0 },
    equity: 10_000,
    now: NOW,
});
check(!noLimit.shouldWrite && noLimit.record === null, "no configured limit → nothing persisted");

const noEquity = decideBreakerPersistence({ previous: null, limits: breakerLimits, equity: undefined, now: NOW });
check(!noEquity.shouldWrite, "missing equity writes nothing");
for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    const decision = decideBreakerPersistence({ previous: null, limits: breakerLimits, equity: bad, now: NOW });
    check(!decision.shouldWrite, `invalid equity (${String(bad)}) writes nothing`);
}

const seeded = decideBreakerPersistence({ previous: null, limits: breakerLimits, equity: 10_000, now: NOW });
check(seeded.shouldWrite && seeded.record?.state === "NORMAL", "first observation seeds the breaker");
check(seeded.record?.peakEquity === 10_000, "the seed records the current equity peak");

let stored = seeded.record!;
const quiet = decideBreakerPersistence({ previous: stored, limits: breakerLimits, equity: 9_990, now: NOW + 1 });
check(!quiet.shouldWrite, "a sub-threshold move does not create a heartbeat write storm");

const warned = decideBreakerPersistence({ previous: stored, limits: breakerLimits, equity: 9_200, now: NOW + 2 });
check(warned.shouldWrite && warned.record?.state === "WARNING", "8% drawdown persists WARNING");
stored = warned.record!;

const tripped = decideBreakerPersistence({ previous: stored, limits: breakerLimits, equity: 8_900, now: NOW + 3 });
check(tripped.shouldWrite && tripped.record?.state === "TRIPPED", "11% drawdown persists TRIPPED");
check(tripped.record?.trippedAt === NOW + 3, "the trip timestamp is recorded");
stored = tripped.record!;

const recovered = decideBreakerPersistence({ previous: stored, limits: breakerLimits, equity: 12_000, now: NOW + 4 });
check(!recovered.shouldWrite, "a recovered equity curve does not rewrite the latched record");
check(recovered.record?.state === "TRIPPED", "TRIPPED survives recovery (latched)");

const corruptPeak = decideBreakerPersistence({
    previous: { ...createDrawdownBreaker(10_000, NOW), peakEquity: 0 },
    limits: breakerLimits,
    equity: 9_500,
    now: NOW + 6,
});
check(
    corruptPeak.shouldWrite && corruptPeak.record?.peakEquity === 9_500 && corruptPeak.record?.state === "NORMAL",
    "a record with no usable peak is repaired and persisted instead of masking drawdown",
);
check(corruptPeak.record?.history.length === 0, "repairing the peak does not invent a transition");

const peakWrite = decideBreakerPersistence({
    previous: createDrawdownBreaker(10_000, NOW),
    limits: breakerLimits,
    equity: 10_200,
    now: NOW + 5,
});
check(peakWrite.shouldWrite && peakWrite.record?.peakEquity === 10_200, "a new high watermark is persisted");

console.log(`\n${failures === 0 ? "🎉 ALL NOTIONAL-ACCOUNTING TESTS PASSED" : `❌ ${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
