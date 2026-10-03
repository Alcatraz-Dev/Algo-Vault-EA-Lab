import { runAITradingTeamsTests } from "./ai-trading-teams.test";

async function main() {
    const passed = await runAITradingTeamsTests();
    if (!passed) {
        console.error("AI Trading Teams tests failed.");
        process.exit(1);
    }
    console.log("All AI Trading Teams tests passed successfully!");
}

main().catch((err) => {
    console.error("Test runner error:", err);
    process.exit(1);
});
