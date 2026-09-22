import { runAnalyticsTests, runLifecycleTests } from "./lifecycle.test";
import { runMultilingualTests } from "./multilingual-parser.test";
import { runParserTests } from "./parser.test";

function runAllProSignalTests() {
    console.log("==========================================");
    console.log("   AlgoVault Pro Signals Test Suite       ");
    console.log("==========================================");

    const parserResult = runParserTests();
    console.log("");
    const multilingualResult = runMultilingualTests();
    console.log("");
    const analyticsResult = runAnalyticsTests();
    console.log("");
    const lifecycleResult = runLifecycleTests();

    console.log("==========================================");
    if (parserResult && multilingualResult && analyticsResult && lifecycleResult) {
        console.log("🎉 ALL PRO SIGNALS TESTS PASSED (100%)");
        console.log("==========================================");
        process.exit(0);
    } else {
        console.error("❌ PRO SIGNALS TEST SUITE FAILED");
        console.log("==========================================");
        process.exit(1);
    }
}

runAllProSignalTests();
