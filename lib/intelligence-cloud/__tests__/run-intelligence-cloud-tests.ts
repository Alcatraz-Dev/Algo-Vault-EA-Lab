import { runIntelligenceCloudTests } from "./intelligence-cloud.test";

async function main() {
    const ok = await runIntelligenceCloudTests();
    if (!ok) {
        console.error("Intelligence Cloud tests FAILED.");
        process.exit(1);
    }
    console.log("All Intelligence Cloud tests passed!");
}

main().catch((err) => {
    console.error("Test runner error:", err);
    process.exit(1);
});
