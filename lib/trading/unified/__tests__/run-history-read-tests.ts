import { runHistoryReadTests } from "./history-read.test";

async function main(): Promise<void> {
    // Focused read-path suite for GET /api/trading/history — kept SEPARATE
    // from `run-unified-trading-tests.ts` so the frozen suites stay exactly
    // 237 and 32 checks.
    const ok = await runHistoryReadTests();
    if (!ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
