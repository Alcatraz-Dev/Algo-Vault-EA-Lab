import { runCodeCraftTests } from "./codecraft.test";
import { runAIUsageBudgetTests } from "./usage-budget.test";

async function main() {
    const codeCraftPassed = await runCodeCraftTests();
    if (!codeCraftPassed) {
        console.error("CodeCraft AI Provider tests failed.");
        process.exit(1);
    }

    const usageBudgetPassed = await runAIUsageBudgetTests();
    if (!usageBudgetPassed) {
        console.error("AI Usage & Budget Control tests failed.");
        process.exit(1);
    }

    console.log("All AI tests passed successfully!");
}

main().catch((err) => {
    console.error("Test runner error:", err);
    process.exit(1);
});
