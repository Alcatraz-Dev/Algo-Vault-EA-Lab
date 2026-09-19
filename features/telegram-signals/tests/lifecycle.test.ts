import { transitionSignalState } from "../lifecycle/state-machine";
import type { ProSignal } from "../types";

export function runLifecycleTests(): boolean {
    console.log("--- Running Signal Lifecycle Unit Tests ---");
    let passed = true;

    const dummySignal: ProSignal = {
        id: "sig_test_1",
        fingerprint: "fp_test_1",
        symbol: "XAUUSD",
        direction: "BUY",
        entryType: "MARKET",
        entry: 4338,
        entryMin: 4336,
        entryMax: 4340,
        stopLoss: 4332,
        openTarget: false,
        takeProfits: [
            { index: 1, type: "PRICE", price: 4342 },
            { index: 2, type: "PRICE", price: 4344 },
        ],
        style: "SCALPING",
        timeframe: "M5",
        createdAt: Date.now(),
        receivedAt: Date.now(),
        expirationAt: Date.now() + 1800000,
        status: "CREATED",
        sourceMetadata: { sourceId: "s1", sourceType: "telegram_channel" },
        parserMetadata: { fastParsed: true, confidence: 100, warnings: [], errors: [], aiUsed: false },
        latency: { receivedAt: Date.now(), parsedAt: Date.now(), normalizedAt: Date.now() },
        rawMessageId: "msg_1",
        events: [],
        lastUpdateAt: Date.now(),
    };

    // Transition 1: Trigger Entry
    const step1 = transitionSignalState(dummySignal, "TRIGGER_ENTRY");
    if (step1.updatedSignal.status !== "ENTRY_TRIGGERED") {
        console.error("❌ Lifecycle Test 1 Failed: Expected status ENTRY_TRIGGERED");
        passed = false;
    } else {
        console.log("✅ Lifecycle Test 1 Passed: CREATED -> ENTRY_TRIGGERED");
    }

    // Transition 2: Hit TP1
    const step2 = transitionSignalState(step1.updatedSignal, "HIT_TP", { tpIndex: 1 });
    if (step2.updatedSignal.status !== "TP1_HIT" || !step2.updatedSignal.takeProfits[0].hit) {
        console.error("❌ Lifecycle Test 2 Failed: Expected status TP1_HIT");
        passed = false;
    } else {
        console.log("✅ Lifecycle Test 2 Passed: ENTRY_TRIGGERED -> TP1_HIT");
    }

    // Transition 3: Move SL to Breakeven
    const step3 = transitionSignalState(step2.updatedSignal, "MOVE_BE");
    if (step3.updatedSignal.status !== "BE_PROFIT_LOCK" || step3.updatedSignal.stopLoss !== 4338) {
        console.error("❌ Lifecycle Test 3 Failed: Expected BE SL 4338, got", step3.updatedSignal.stopLoss);
        passed = false;
    } else {
        console.log("✅ Lifecycle Test 3 Passed: TP1_HIT -> BE_PROFIT_LOCK (SL moved to 4338)");
    }

    // Transition 4: Expiration check after entry should NOT expire trade (§14)
    const step4 = transitionSignalState(step3.updatedSignal, "EXPIRE");
    if (step4.transitioned) {
        console.error("❌ Lifecycle Test 4 Failed: Trade in BE_PROFIT_LOCK should NOT expire automatically!");
        passed = false;
    } else {
        console.log("✅ Lifecycle Test 4 Passed: Expiration blocked for active trade in progress!");
    }

    return passed;
}
