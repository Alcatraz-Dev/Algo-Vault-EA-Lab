// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Strategy Engine — test suite (repo jiti-runner convention).
//
// Run: node scripts/jiti-tsrun.mjs lib/strategy-engine/__tests__/run-strategy-engine-tests.ts
//   or: npm run test:strategy-engine
//
// Covers: acceptance strategy decision parity across chart/backtest/replay/
// paper · no look-ahead (feature causality, decision invariance, hidden
// future) · execution model (spread/slippage/commission/gaps/limits/stops) ·
// order & position lifecycle · sizing · risk engine · replay transport and
// state restore · paper isolation and fail-closed guards · experiment
// reproducibility · analytics (MAE/MFE, segments, drawdown attribution) ·
// validation · chart markers · alert bridge.
//
// No network, no RTDB, no AI, no Math.random.
// ─────────────────────────────────────────────────────────────────────────────

import { resetHarness, summary } from "./harness";
import { runAcceptanceTests } from "./acceptance.test";
import { runLeakageTests } from "./leakage.test";
import { runCoreTests } from "./core.test";
import { runEnvironmentTests } from "./environments.test";
import { runResearchTests } from "./research.test";

function main(): void {
    console.log("==================================================");
    console.log("   AlgoVault Strategy Engine — Test Suite        ");
    console.log("==================================================");

    const suites: Array<[string, () => boolean]> = [
        ["acceptance", runAcceptanceTests],
        ["leakage", runLeakageTests],
        ["core-execution-risk", runCoreTests],
        ["replay-paper", runEnvironmentTests],
        ["research-analytics", runResearchTests],
    ];

    let ok = true;
    let passed = 0;
    const failures: string[] = [];

    for (const [name, run] of suites) {
        resetHarness();
        try {
            run();
        } catch (error) {
            ok = false;
            failures.push(`${name} :: SUITE CRASHED — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            console.error(`\n  SUITE CRASHED: ${name}`);
            console.error(error);
        }
        const result = summary();
        passed += result.passed;
        if (!result.ok) ok = false;
        failures.push(...result.failures);
    }

    console.log("\n==================================================");
    console.log(` passed: ${passed} · failed: ${failures.length}`);
    if (ok) {
        console.log(" 🎉 ALL STRATEGY ENGINE TESTS PASSED");
        console.log("==================================================");
        process.exit(0);
    }
    console.log(" Failures:");
    for (const f of failures) console.log(`   ✗ ${f}`);
    console.log("==================================================");
    process.exit(1);
}

main();
