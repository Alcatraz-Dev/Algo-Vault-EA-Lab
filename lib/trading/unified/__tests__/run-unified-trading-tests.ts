import { runUnifiedTradingTests } from "./unified-trading.test";
import { runMt5ProviderVerificationTests } from "./mt5-provider-verification.test";
import { runClientOutcomeTests } from "./client-outcome.test";
import { runReconciliationTests } from "./reconciliation.test";

async function main(): Promise<void> {
    // A suite whose promise never settles would otherwise let Node drain the
    // event loop and exit 0 silently. The watchdog keeps the process alive and
    // fails the run if the suites have not finished within the budget.
    const watchdog = setTimeout(() => {
        console.error("Unified trading tests stalled: a pending promise never settled.");
        process.exit(1);
    }, 120_000);
    try {
        await runSuites();
    } finally {
        clearTimeout(watchdog);
    }
}

async function runSuites(): Promise<void> {
    // Service-level pipeline suite (stub adapters) …
    const serviceOk = await runUnifiedTradingTests();
    // … then the provider-level suite that drives the REAL Mt5DemoProvider
    // against a fake RTDB and a virtual clock.
    const providerOk = await runMt5ProviderVerificationTests();
    // … and the client-side outcome classifier (timeouts are UNKNOWN, not FAILED).
    const clientOk = await runClientOutcomeTests();
    // … and timeout reconciliation: UNKNOWN resolves only on authoritative evidence.
    const reconcileOk = await runReconciliationTests();
    if (!serviceOk || !providerOk || !clientOk || !reconcileOk) process.exitCode = 1;
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
