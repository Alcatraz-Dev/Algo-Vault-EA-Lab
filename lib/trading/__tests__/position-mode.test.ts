/**
 * MT5 position-accounting mode — unit tests (pure, no I/O).
 *
 * These lock the safety rule that matters most: an account whose accounting
 * mode is netting or unknown must never be treated as hedge-capable, and an
 * opposing entry on a netting account is blocked rather than silently netted.
 */

import {
    MT5_MARGIN_MODE,
    MT5_TRADE_MODE,
    decideOpposingEntry,
    describePositionMode,
    normalizePositionMode,
    positionModeRestrictsDirection,
    supportsIndependentOpposingPositions,
} from "../position-mode";

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`FAIL: ${message}`);
}

let checks = 0;
function check(name: string, condition: boolean): void {
    checks += 1;
    assert(condition, name);
    console.log(`  ok ${name}`);
}

console.log("\nMT5 position mode\n");

check("hedging margin mode code maps to HEDGING", normalizePositionMode(MT5_MARGIN_MODE.RETAIL_HEDGING) === "HEDGING");
check("netting margin mode code maps to NETTING", normalizePositionMode(MT5_MARGIN_MODE.RETAIL_NETTING) === "NETTING");
check("exchange margin mode code maps to EXCHANGE", normalizePositionMode(MT5_MARGIN_MODE.EXCHANGE) === "EXCHANGE");
check("numeric string is parsed", normalizePositionMode("2") === "HEDGING");
check("lowercase name is parsed", normalizePositionMode("hedging") === "HEDGING");
check("empty input is UNKNOWN", normalizePositionMode("") === "UNKNOWN");
check("null input is UNKNOWN", normalizePositionMode(null) === "UNKNOWN");
check("unrecognised code is UNKNOWN", normalizePositionMode(99) === "UNKNOWN");
check("garbage string is UNKNOWN", normalizePositionMode("retail") === "UNKNOWN");
check(
    "trade mode (DEMO=0) is not misread as margin mode",
    normalizePositionMode(MT5_TRADE_MODE.DEMO) === "NETTING" && normalizePositionMode(MT5_TRADE_MODE.REAL) === "HEDGING",
);

check("only HEDGING supports independent opposing positions", supportsIndependentOpposingPositions("HEDGING"));
check("NETTING does not", !supportsIndependentOpposingPositions("NETTING"));
check("EXCHANGE does not", !supportsIndependentOpposingPositions("EXCHANGE"));
check("UNKNOWN does not", !supportsIndependentOpposingPositions("UNKNOWN"));
check("restriction helper mirrors support", positionModeRestrictsDirection("NETTING") && !positionModeRestrictsDirection("HEDGING"));
check("description is honest about netting", /reduc\w* or revers\w*/i.test(describePositionMode("NETTING")));

console.log("\nOpposing-entry policy\n");

const hedgingOpposite = decideOpposingEntry({ mode: "HEDGING", side: "short", openLong: 1, openShort: 0 });
check("hedging permits the opposing entry", hedgingOpposite.allowed && hedgingOpposite.policy === "independent");

const hedgingFlat = decideOpposingEntry({ mode: "HEDGING", side: "long", openLong: 0, openShort: 0 });
check("hedging flat symbol is a no-conflict entry", hedgingFlat.allowed && hedgingFlat.policy === "no_conflict");

const nettingFlat = decideOpposingEntry({ mode: "NETTING", side: "long", openLong: 0, openShort: 0 });
check("netting flat symbol permits the entry", nettingFlat.allowed && nettingFlat.policy === "no_conflict");

const nettingOpposite = decideOpposingEntry({ mode: "NETTING", side: "short", openLong: 1, openShort: 0 });
check("netting blocks the opposing entry", !nettingOpposite.allowed && nettingOpposite.policy === "netting_blocked");
check("netting reason explains reduction/reversal", /reduced or reversed/i.test(nettingOpposite.reason));

const nettingSameSide = decideOpposingEntry({ mode: "NETTING", side: "long", openLong: 1, openShort: 0 });
check("netting blocks adding to an existing position", !nettingSameSide.allowed && nettingSameSide.policy === "netting_blocked");

const unknownOpen = decideOpposingEntry({ mode: "UNKNOWN", side: "long", openLong: 0, openShort: 1 });
check("unknown mode with exposure fails closed", !unknownOpen.allowed && unknownOpen.policy === "unknown_blocked");

const exchangeOpen = decideOpposingEntry({ mode: "EXCHANGE", side: "long", openLong: 0, openShort: 1 });
check("exchange accounting fails closed", !exchangeOpen.allowed && exchangeOpen.policy === "unknown_blocked");

console.log(`\n${checks} position-mode checks passed.\n`);
