import { runBacktestTests } from "./backtest.test";

function runAllBacktestTests() {
    console.log("==========================================");
    console.log("   AlgoVault Backtest Parity Tests        ");
    console.log("==========================================");

    const backtestResult = runBacktestTests();

    console.log("==========================================");
    if (backtestResult) {
        console.log("🎉 ALL BACKTEST TESTS PASSED (100%)");
        console.log("==========================================");
        process.exit(0);
    } else {
        console.error("❌ BACKTEST TEST SUITE FAILED");
        console.log("==========================================");
        process.exit(1);
    }
}

runAllBacktestTests();