import { runWorkflowEngineTests } from "./workflow-engine.test";

async function runAllAgentTests(): Promise<boolean> {
    console.log("==========================================");
    console.log("   AlgoVault Agents Test Suite            ");
    console.log("==========================================");

    const workflowResult = await runWorkflowEngineTests();
    console.log("");

    console.log("==========================================");
    if (workflowResult) {
        console.log("🎉 ALL AGENT TESTS PASSED (100%)");
        console.log("==========================================");
        return true;
    } else {
        console.error("❌ AGENT TEST SUITE FAILED");
        console.log("==========================================");
        return false;
    }
}

export { runAllAgentTests };

runAllAgentTests().then((passed) => {
    process.exit(passed ? 0 : 1);
});