// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — test suite runner (repo jiti-runner convention).
//
// Run: npm run test:arena
//   or: node scripts/jiti-tsrun.mjs lib/performance-arena/__tests__/run-performance-arena-tests.ts
//
// Pure domain coverage — no RTDB writes, no network, no AI calls:
//   money/precision · lifecycle · rules · metrics · execution · settlement ·
//   rewards (idempotency + AV points) · cash-reward invariant · leaderboard ·
//   fraud flags · feature flags · compatibility · profile · entitlement
//   (Pro gating) · static security (RTDB rules, route auth, no Firestore).
// ─────────────────────────────────────────────────────────────────────────────

import { runMoneyTests } from "./money.test";
import { runLifecycleTests } from "./lifecycle.test";
import { runRuleTests } from "./rules.test";
import { runMetricsTests } from "./metrics.test";
import { runExecutionTests } from "./execution.test";
import { runSettlementTests } from "./settlement.test";
import { runRewardsTests } from "./rewards.test";
import { runCashInvariantTests } from "./cash-invariant.test";
import { runLeaderboardTests } from "./leaderboard.test";
import { runFraudTests } from "./fraud.test";
import { runFlagsCompatTests } from "./flags-compat.test";
import { runEntitlementTests } from "./entitlement.test";
import { runSecurityTests } from "./security.test";

async function main() {
    console.log("==================================================");
    console.log("   AlgoVault Performance Arena — Test Suite       ");
    console.log("==================================================");

    const results: Array<[string, boolean]> = [];

    const suites: Array<[string, () => Promise<boolean>]> = [
        ["money", runMoneyTests],
        ["lifecycle", runLifecycleTests],
        ["rules", runRuleTests],
        ["metrics", runMetricsTests],
        ["execution", runExecutionTests],
        ["settlement", runSettlementTests],
        ["rewards", runRewardsTests],
        ["cash-invariant", runCashInvariantTests],
        ["leaderboard", runLeaderboardTests],
        ["fraud", runFraudTests],
        ["flags-compatibility-profile", runFlagsCompatTests],
        ["entitlement-pro-gating", runEntitlementTests],
        ["security", runSecurityTests],
    ];

    for (const [name, run] of suites) {
        try {
            results.push([name, await run()]);
        } catch (error) {
            console.error(`\n  SUITE CRASHED: ${name}`);
            console.error(error);
            results.push([name, false]);
        }
    }

    console.log("\n==================================================");
    let allPassed = true;
    for (const [name, ok] of results) {
        console.log(`  ${ok ? "✅" : "❌"} ${name}`);
        if (!ok) allPassed = false;
    }
    console.log("==================================================");

    if (allPassed) {
        console.log("🎉 ALL PERFORMANCE ARENA TESTS PASSED (100%)");
        process.exit(0);
    } else {
        console.error("❌ PERFORMANCE ARENA TEST SUITE FAILED");
        process.exit(1);
    }
}

void main();
