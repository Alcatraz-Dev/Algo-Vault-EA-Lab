// ─────────────────────────────────────────────────────────────────────────────
// Paid-tool capability audit tests.
//
// Proves the integrity rule: a capability marked IMPLEMENTED has a real code
// path AND runs, and a capability marked NOT_IMPLEMENTED / UNAVAILABLE is not
// rendered as a Pro entitlement.
//
// Run: npm run test:capabilities
// ─────────────────────────────────────────────────────────────────────────────

import {
    CAPABILITY_AUDIT,
    advertisableFeatures,
    capabilityAuditSummary,
    lookupCapability,
} from "../../lib/tools-capability-audit";
import { verifyImplementedCapabilities } from "../../lib/tools-capability-audit.runtime";
import { TOOL_BY_ID } from "../../lib/tools-catalog";

let failures = 0;
function check(cond: boolean, label: string, detail?: unknown): void {
    if (cond) {
        console.log(`  PASS: ${label}`);
    } else {
        failures++;
        console.error(`  FAIL: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
}

console.log("\ncapability audit");

// ── Registry shape ────────────────────────────────────────────────────────
check(CAPABILITY_AUDIT.length > 0, "audit registry is populated", CAPABILITY_AUDIT.length);
check(new Set(CAPABILITY_AUDIT.map((e) => e.id)).size === CAPABILITY_AUDIT.length, "capability ids are unique");
check(new Set(CAPABILITY_AUDIT.map((e) => e.label)).size === CAPABILITY_AUDIT.length, "capability labels are unique");

for (const entry of CAPABILITY_AUDIT) {
    if (entry.status === "IMPLEMENTED") {
        check(entry.implementation.length > 0, `IMPLEMENTED capability "${entry.id}" names its implementation`);
    } else {
        check(true, `${entry.status} capability "${entry.id}" is documented`);
    }
    if (entry.status === "NOT_IMPLEMENTED") {
        check(entry.implementation.length === 0, `NOT_IMPLEMENTED capability "${entry.id}" claims no implementation`);
    }
}

const summary = capabilityAuditSummary();
check(
    summary.total === summary.implemented + summary.partial + summary.missing + summary.unavailable,
    "summary partitions every entry",
    summary,
);
check(summary.missing > 0, "the audit contains real negatives (it is not a rubber stamp)", summary);

// ── Implemented capabilities actually execute ─────────────────────────────
const runtime = verifyImplementedCapabilities();
check(runtime.length > 0, "runtime verification produced results");
check(runtime.every((r) => r.ok), "every IMPLEMENTED quantitative capability executes on synthetic input", runtime);

// ── Advertising enforcement ───────────────────────────────────────────────
const kellyLabel = "Kelly criterion & half-Kelly position sizing";
const saveLabel = "Save scenarios to your account";
const mcDrawdownLabel = "Monte-Carlo drawdown distribution (1000 paths)";

check(lookupCapability(kellyLabel)?.status === "IMPLEMENTED", "Kelly is registered as implemented");
check(lookupCapability(saveLabel)?.status === "NOT_IMPLEMENTED", "unbacked 'save scenarios' claim is registered as missing");
check(lookupCapability(mcDrawdownLabel)?.status === "PARTIALLY_IMPLEMENTED", "drawdown MC is honestly partial");

const filtered = advertisableFeatures([kellyLabel, saveLabel, mcDrawdownLabel]);
check(
    JSON.stringify(filtered) === JSON.stringify([kellyLabel]),
    "only the operational capability survives the Pro filter",
    filtered,
);
check(advertisableFeatures([saveLabel]).length === 0, "an all-missing list filters to empty (CTA hides)");
check(advertisableFeatures([kellyLabel]).length === 1, "implemented capability is kept");

// ── Catalog truth ─────────────────────────────────────────────────────────
const ruinTool = TOOL_BY_ID["risk-of-ruin"];
check(!!ruinTool, "risk-of-ruin catalog entry exists");
if (ruinTool) {
    check(
        ruinTool.proFeatures.every((f) => lookupCapability(f)?.status === "IMPLEMENTED"),
        "every risk-of-ruin Pro feature is implemented",
        ruinTool.proFeatures,
    );
    check(ruinTool.proFeatures.length === 3, "the unimplemented 'save scenarios' claim was removed", ruinTool.proFeatures);
}

const drawdownTool = TOOL_BY_ID["drawdown-calculator"];
check(!!drawdownTool && drawdownTool.proFeatures.length === 0, "drawdown calculator advertises no unbacked Pro feature", drawdownTool?.proFeatures);

console.log(`\n${failures === 0 ? "🎉 ALL CAPABILITY-AUDIT TESTS PASSED" : `❌ ${failures} CAPABILITY-AUDIT TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
