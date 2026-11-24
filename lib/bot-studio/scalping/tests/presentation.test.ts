/**
 * Bot UI presentation + broker sizing rules (pure, no browser).
 */

import { directionAllows, formatVolume, laneStatusLabel, checkVolumeInput, positionModeSummary } from "../presentation";
import { isValidVolume, resolveBrokerSizingSpec } from "../broker-sizing";

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`FAIL: ${message}`);
}

let checks = 0;
function check(name: string, condition: boolean): void {
    checks += 1;
    assert(condition, name);
    console.log(`  ok ${name}`);
}

console.log("\nBot UI presentation\n");

check("both enables long", directionAllows("both", "long"));
check("both enables short", directionAllows("both", "short"));
check("long_only disables short", !directionAllows("long_only", "short"));
check("short_only disables long", !directionAllows("short_only", "long"));
check("unknown direction claims neither lane", !directionAllows(null, "long") && !directionAllows(null, "short"));

check("open label", laneStatusLabel("POSITION_OPEN") === "Position open");
check("waiting label", laneStatusLabel("WAITING") === "Waiting for signal");
check("disabled label", laneStatusLabel("NOT_EVALUATED") === "Disabled");

check("hedging allows both", positionModeSummary("HEDGING").canHedge);
check("netting does not", !positionModeSummary("NETTING").canHedge);
check("unknown does not", !positionModeSummary("UNKNOWN").canHedge);
check(
    "netting restriction explains reduction",
    /reduc\w* or revers\w*/i.test(positionModeSummary("NETTING").restriction),
);

check("volume precision follows step", formatVolume(0.1, 0.01) === "0.10");
check("unavailable volume is labelled", formatVolume(null, 0.01) === "unavailable");

const unavailable = resolveBrokerSizingSpec({});
check("missing constraints are unavailable", !unavailable.available && unavailable.reason.length > 0);

const missingStep = resolveBrokerSizingSpec({ minLot: 0.01 });
check("missing step is unavailable", !missingStep.available);

const spec = resolveBrokerSizingSpec({ minLot: 0.01, maxLot: 5, lotStep: 0.01, currency: "USD" });
check("complete constraints are available", spec.available && spec.volumeStep === 0.01);
check("valid volume passes", isValidVolume(0.25, spec).valid);
check("below-minimum volume is rejected", !isValidVolume(0.005, spec).valid);
check("off-step volume is rejected", !isValidVolume(0.255, spec).valid);
check("above-maximum volume is rejected", !isValidVolume(6, spec).valid);
check("unavailable spec rejects every volume", !isValidVolume(0.1, unavailable).valid);

check("input check accepts a step multiple", checkVolumeInput("0.25", spec).ok);
check("input check rejects a non-numeric value", !checkVolumeInput("abc", spec).ok);
check("input check blocks when unavailable", !checkVolumeInput("0.1", unavailable).ok);

console.log(`\n${checks} presentation checks passed.\n`);
