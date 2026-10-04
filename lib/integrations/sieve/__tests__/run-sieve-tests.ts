// ─────────────────────────────────────────────────────────────────────────────
// Sieve scrape API — test suite runner (repo jiti-runner convention).
//
// Run: npm run test:sieve
//   or: node scripts/jiti-tsrun.mjs lib/integrations/sieve/__tests__/run-sieve-tests.ts
//
// Coverage: request building, error mapping, status handling
// (running/done/refused/unknown), the follow-up turn check, GET backoff/retry
// and the "never retry POST on timeout/network error" rule. Global `fetch` is
// stubbed at the HTTP boundary; the logic under test is the real code.
// ─────────────────────────────────────────────────────────────────────────────

import { runConfigTests } from "./config.test";
import { runClientTests } from "./client.test";
import { runPollingTests } from "./polling.test";
import { runDeviceTests } from "./device.test";

async function main() {
    console.log("==================================================");
    console.log("      AlgoVault Sieve Integration — Test Suite    ");
    console.log("==================================================");

    const suites: Array<[string, () => Promise<boolean>]> = [
        ["config", runConfigTests],
        ["client", runClientTests],
        ["polling", runPollingTests],
        ["device-login", runDeviceTests],
    ];

    const results: Array<[string, boolean]> = [];
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
        console.log("🎉 ALL SIEVE TESTS PASSED");
        process.exit(0);
    } else {
        console.error("❌ SIEVE TEST SUITE FAILED");
        process.exit(1);
    }
}

void main();
