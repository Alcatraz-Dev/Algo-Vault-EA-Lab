import { runGeneratorTests } from "./generator.test";

async function runAllEATests() {
    console.log("==========================================");
    console.log("   AlgoVault Strategy→EA Generator Suite  ");
    console.log("==========================================");

    const result = await runGeneratorTests();

    console.log("==========================================");
    if (result) {
        console.log("🎉 ALL EA GENERATOR TESTS PASSED");
        console.log("==========================================");
        process.exit(0);
    } else {
        console.error("❌ EA GENERATOR TEST SUITE FAILED");
        console.log("==========================================");
        process.exit(1);
    }
}

runAllEATests();