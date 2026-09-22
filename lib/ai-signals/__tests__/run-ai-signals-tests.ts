import { runPriceSanityTests } from "./price-sanity.test";
import { runLifecycleTests } from "./ai-generation.test";
import { runMonitorTests } from "./monitor.test";

async function runAllAISignalTests(): Promise<boolean> {
    console.log("==========================================");
    console.log("   AlgoVault AI Signals Test Suite     ");
    console.log("==========================================");

    const sanityResult = runPriceSanityTests();
    console.log("");

    const lifecycleResult = await runLifecycleTests();
    console.log("");

    const monitorResult = await runMonitorTests();
    console.log("");

    console.log("==========================================");
    if (sanityResult && lifecycleResult && monitorResult) {
        console.log("🎉 ALL AI SIGNAL TESTS PASSED (100%)");
        console.log("==========================================");
        return true;
    } else {
        console.error("❌ AI SIGNAL TEST SUITE FAILED");
        console.log("==========================================");
        return false;
    }
}

export { runAllAISignalTests };

runAllAISignalTests().then((passed) => {
    process.exit(passed ? 0 : 1);
});