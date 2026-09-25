import { runCodeCraftTests } from "./codecraft.test";

async function main() {
    const passed = await runCodeCraftTests();
    if (!passed) {
        console.error("CodeCraft AI Provider tests failed.");
        process.exit(1);
    } else {
        console.log("All CodeCraft AI Provider tests passed successfully!");
    }
}

main().catch((err) => {
    console.error("Test runner error:", err);
    process.exit(1);
});
