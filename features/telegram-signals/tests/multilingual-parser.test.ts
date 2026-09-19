import { parseFastSignal } from "../parser/fast-parser";
import { normalizeAndValidateSignal } from "../normalizer/signal-normalizer";
import { checkDuplicateSignal } from "../signals/duplicate-detector";

export function runMultilingualTests(): boolean {
    console.log("--- Running Multilingual Parser & Deduplication Unit Tests ---");
    let passed = true;

    // Test 1: Swedish Signal with Emojis & Open Target (§1, §2, §8, §9)
    const swedishInput = `🚨TRADE ALERT

SÄLJ SP500

🏆Entry: 7609
🏆Stop Loss: 7631
TP1: 7604
TP2: 7598
TP3: 7593
TP4: öppen`;

    const res1 = parseFastSignal(swedishInput);

    if (!res1.isSignal) {
        console.error("❌ Swedish Test Failed: Parser errors:", res1.errors);
        passed = false;
    } else if (res1.symbol !== "SP500") {
        console.error(`❌ Swedish Test Failed: Expected SP500, got ${res1.symbol}`);
        passed = false;
    } else if (res1.direction !== "SELL") {
        console.error(`❌ Swedish Test Failed: Expected SELL (SÄLJ), got ${res1.direction}`);
        passed = false;
    } else if (res1.entryMin !== 7609 || res1.stopLoss !== 7631) {
        console.error(`❌ Swedish Test Failed: Expected entry 7609 SL 7631, got entry ${res1.entryMin} SL ${res1.stopLoss}`);
        passed = false;
    } else if (res1.takeProfits?.length !== 4) {
        console.error(`❌ Swedish Test Failed: Expected 4 TPs, got ${res1.takeProfits?.length}`);
        passed = false;
    } else if (!res1.openTarget || res1.takeProfits?.[3]?.type !== "OPEN") {
        console.error("❌ Swedish Test Failed: Expected TP4 (öppen) to have type OPEN");
        passed = false;
    } else {
        console.log("✅ Swedish Signal Test Passed! (SÄLJ -> SELL, öppen -> OPEN)");
    }

    // Test 2: French Signal
    const frenchInput = `VENTE EURUSD
Entrée: 1.0850
SL: 1.0890
TP1: 1.0820
TP2: ouvert`;

    const res2 = parseFastSignal(frenchInput);
    if (res2.symbol === "EURUSD" && res2.direction === "SELL" && res2.openTarget) {
        console.log("✅ French Signal Test Passed! (VENTE -> SELL, ouvert -> OPEN)");
    } else {
        console.error("❌ French Test Failed:", res2);
        passed = false;
    }

    // Test 3: German Signal
    const germanInput = `VERKAUFEN US30
Einstieg: 39000
Stopp: 39200
Ziel 1: 38800
Ziel 2: offen`;

    const res3 = parseFastSignal(germanInput);
    if (res3.symbol === "US30" && res3.direction === "SELL" && res3.openTarget) {
        console.log("✅ German Signal Test Passed! (VERKAUFEN -> SELL, offen -> OPEN)");
    } else {
        console.error("❌ German Test Failed:", res3);
        passed = false;
    }

    // Test 4: Arabic Signal
    const arabicInput = `بيع XAUUSD
الدخول: 2350
وقف الخسارة: 2360
الهدف: 2340
الهدف 2: مفتوح`;

    const res4 = parseFastSignal(arabicInput);
    if (res4.symbol === "XAUUSD" && res4.direction === "SELL" && res4.openTarget) {
        console.log("✅ Arabic Signal Test Passed! (بيع -> SELL, مفتوح -> OPEN)");
    } else {
        console.error("❌ Arabic Test Failed:", res4);
        passed = false;
    }

    // Test 5: Deterministic Duplicate Detection (§14)
    const sourceMetadata = { sourceId: "channel_101", sourceType: "telegram_channel" as const };
    const now = Date.now();

    const normalized1 = normalizeAndValidateSignal({
        rawMessageId: "m1",
        rawText: swedishInput,
        sourceMetadata,
        parsed: res1,
        receivedAt: now,
        parsedAt: now,
    });

    const dupCheck = checkDuplicateSignal(normalized1.fingerprint, [normalized1]);
    if (dupCheck.isDuplicate && dupCheck.existingSignalId === normalized1.id) {
        console.log("✅ Duplicate Fingerprint Test Passed! Re-sent signal correctly rejected.");
    } else {
        console.error("❌ Duplicate Test Failed:", dupCheck);
        passed = false;
    }

    return passed;
}
