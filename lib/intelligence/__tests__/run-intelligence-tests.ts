import { runIntelligenceTests } from "./intelligence.test";

async function main() {
    const ok = await runIntelligenceTests();
    if (!ok) {
        console.error("Intelligence Fabric tests FAILED.");
        process.exit(1);
    }
    console.log("All Intelligence Fabric tests passed!");
}

main().catch((err) => {
    console.error("Test runner error:", err);
    process.exit(1);
});
