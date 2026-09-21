import { runRiskEngineTests } from "./risk-engine.test";

function runAllRiskTests() {
    console.log("==========================================");
    console.log("   AlgoVault Canonical Risk Engine Tests  ");
    console.log("==========================================");

    const riskResult = runRiskEngineTests();

    console.log("==========================================");
    if (riskResult) {
        console.log("🎉 ALL RISK ENGINE TESTS PASSED (100%)");
        console.log("==========================================");
        process.exit(0);
    } else {
        console.error("❌ RISK ENGINE TEST SUITE FAILED");
        console.log("==========================================");
        process.exit(1);
    }
}

runAllRiskTests();