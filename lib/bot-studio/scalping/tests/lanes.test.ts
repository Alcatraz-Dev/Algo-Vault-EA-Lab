/**
 * Bidirectional scalping lanes — unit tests (pure, no I/O).
 *
 * Locks the product requirement: one bot, two independent lanes. Both may
 * enter on the same bar on a hedging account; neither is silently discarded.
 * A netting or unknown account never reports simultaneous opposing positions.
 */

import { planDirectionalLanes, summarizeLanes, type LanePlanInput } from "../lanes";
import { defaultScalpingConfig, type ScalpingBotConfig } from "../profiles";
import type { DirectionalScalpingEvaluation, ScalpingSideEvaluation } from "../directional";

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`FAIL: ${message}`);
}

let checks = 0;
function check(name: string, condition: boolean): void {
    checks += 1;
    assert(condition, name);
    console.log(`  ok ${name}`);
}

function side(
    sideId: "long" | "short",
    fired: boolean,
    confidence = 0.8,
    overrides: Partial<ScalpingSideEvaluation> = {},
): ScalpingSideEvaluation {
    return {
        side: sideId,
        evaluated: true,
        fired,
        confidence: fired ? confidence : 0,
        blockedBy: fired ? null : "entry_rules",
        conditions: [],
        breakdown: [],
        ...overrides,
    };
}

function evaluation(longFired: boolean, shortFired: boolean): DirectionalScalpingEvaluation {
    return {
        decision: "WAIT",
        direction: null,
        reason: null,
        detail: "",
        confidence: 0,
        atr: 1,
        regime: "transitional",
        session: "london",
        trend: "neutral",
        barTimestamp: 1_700_000_000_000,
        barAgeMs: 0,
        symbol: "XAUUSD",
        timeframe: "M5",
        sides: { long: side("long", longFired), short: side("short", shortFired) },
    };
}

function plan(overrides: Partial<LanePlanInput> = {}) {
    const config: ScalpingBotConfig = defaultScalpingConfig("balanced");
    return planDirectionalLanes({
        config,
        evaluation: evaluation(false, false),
        positionMode: "HEDGING",
        open: { long: 0, short: 0 },
        now: 1_700_000_000_000,
        ...overrides,
    });
}

console.log("\nBidirectional lanes\n");

const bothHedging = plan({ evaluation: evaluation(true, true), positionMode: "HEDGING" });
check("hedging: long lane enters", bothHedging.intents.long.enter);
check("hedging: short lane enters", bothHedging.intents.short.enter);
check("hedging: simultaneous is reported", bothHedging.simultaneous);
check("hedging: neither signal is discarded", bothHedging.detail.includes("both"));

const bothNetting = plan({ evaluation: evaluation(true, true), positionMode: "NETTING" });
check("netting: long lane blocked", bothNetting.intents.long.status === "BLOCKED" && bothNetting.intents.long.reason === "netting_blocked");
check("netting: short lane blocked", bothNetting.intents.short.status === "BLOCKED" && bothNetting.intents.short.reason === "netting_blocked");
check("netting: never reports simultaneous", !bothNetting.simultaneous);

const bothUnknown = plan({ evaluation: evaluation(true, true), positionMode: "UNKNOWN" });
check("unknown mode: both lanes blocked", !bothUnknown.intents.long.enter && !bothUnknown.intents.short.enter);
check("unknown mode: reason is explicit", bothUnknown.intents.long.reason === "unknown_position_mode");

const longOnlyNetting = plan({ evaluation: evaluation(true, false), positionMode: "NETTING" });
check("netting flat: single qualifying lane may enter", longOnlyNetting.intents.long.enter);
check("netting flat: other lane waits", !longOnlyNetting.intents.short.enter && longOnlyNetting.intents.short.status === "WAIT");

const shortAgainstOpenLong = plan({
    evaluation: evaluation(false, true),
    positionMode: "NETTING",
    open: { long: 1, short: 0 },
});
check(
    "netting: opposing entry blocked while a position is open",
    shortAgainstOpenLong.intents.short.reason === "netting_blocked",
);

const shortAgainstOpenLongHedging = plan({
    evaluation: evaluation(false, true),
    positionMode: "HEDGING",
    open: { long: 1, short: 0 },
});
check(
    "hedging: opposing entry allowed while the other lane is open",
    shortAgainstOpenLongHedging.intents.short.enter,
);

const maxed = plan({
    evaluation: evaluation(true, false),
    positionMode: "HEDGING",
    open: { long: 1, short: 0 },
});
check("per-direction position limit is enforced", maxed.intents.long.reason === "max_positions");

const cooling = plan({
    evaluation: evaluation(true, false),
    positionMode: "HEDGING",
    pacing: { long: { cooldownUntil: 1_700_000_060_000 } },
    now: 1_700_000_000_000,
});
check("direction-specific cooldown blocks only that lane", cooling.intents.long.reason === "cooldown");

const forbidden = plan({
    evaluation: {
        ...evaluation(true, false),
        sides: { long: side("long", true), short: side("short", true, 0, { evaluated: false }) },
    },
    positionMode: "HEDGING",
});
check("disabled direction is reported, not evaluated", forbidden.intents.short.reason === "direction_not_allowed");

const summary = summarizeLanes(bothHedging, { long: 1, short: 0 });
check("summary keeps both lanes visible", summary.long.status === "POSITION_OPEN" && summary.short.status === "SIGNAL_READY");
check("summary states whether both sides can coexist", summary.canHoldBothDirections);

const nettingSummary = summarizeLanes(bothNetting, { long: 0, short: 0 });
check("netting summary denies simultaneous capacity", !nettingSummary.canHoldBothDirections);

console.log(`\n${checks} lane checks passed.\n`);
