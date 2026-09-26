import { runAccountHealthTests } from "./report.test";

async function main() {
    const passed = await runAccountHealthTests();
    if (!passed) {
        console.error("Account health tests failed.");
        process.exit(1);
    }
    console.log("All account health tests passed successfully!");
}

main().catch((err) => {
    console.error("Test runner error:", err);
    process.exit(1);
});
