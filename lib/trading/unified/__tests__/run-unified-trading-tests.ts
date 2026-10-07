import { runUnifiedTradingTests } from "./unified-trading.test";
import { runMt5ProviderVerificationTests } from "./mt5-provider-verification.test";

async function main(): Promise<void> {
    // Service-level pipeline suite (stub adapters) …
    const serviceOk = await runUnifiedTradingTests();
    // … then the provider-level suite that drives the REAL Mt5DemoProvider
    // against a fake RTDB and a virtual clock.
    const providerOk = await runMt5ProviderVerificationTests();
    if (!serviceOk || !providerOk) process.exitCode = 1;
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
