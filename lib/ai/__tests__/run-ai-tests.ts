import { runCodeCraftTests } from "./codecraft.test";
import { runAIUsageBudgetTests } from "./usage-budget.test";
import { runOllamaTests } from "./ollama.test";
import { runOpenRouterCatalogTests } from "./openrouter-catalog.test";
import { runProviderSelectionTests } from "./provider-selection.test";
import { runChatEndpointTests } from "./chat-endpoint.test";

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

    const ollamaPassed = await runOllamaTests();
    if (!ollamaPassed) {
        console.error("Ollama provider tests failed.");
        process.exit(1);
    }

    const openRouterPassed = await runOpenRouterCatalogTests();
    if (!openRouterPassed) {
        console.error("OpenRouter catalog tests failed.");
        process.exit(1);
    }

    const selectionPassed = await runProviderSelectionTests();
    if (!selectionPassed) {
        console.error("Provider selection tests failed.");
        process.exit(1);
    }

    const chatEndpointPassed = await runChatEndpointTests();
    if (!chatEndpointPassed) {
        console.error("Chat endpoint access-control tests failed.");
        process.exit(1);
    }

    console.log("All AI tests passed successfully!");
}

main().catch((err) => {
    console.error("Test runner error:", err);
    process.exit(1);
});
