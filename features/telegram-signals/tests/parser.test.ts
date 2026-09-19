import { parseFastSignal } from "../parser/fast-parser";

export function runParserTests(): boolean {
    console.log("--- Running Fast Parser Unit Tests ---");
    let passed = true;

    // Test 1: Standard Spec Example (§9, §55)
    const specInput = `Gold buy now 4340 - 4336
SL: 4332
TP: 4342
TP. 4344
TP: 4346
TP: 4348
TP: open`;

    const res1 = parseFastSignal(specInput);

    if (!res1.isSignal) {
        console.error("❌ Test 1 Failed: Expected valid signal. Errors:", res1.errors);
        passed = false;
    } else if (res1.symbol !== "XAUUSD") {
        console.error(`❌ Test 1 Failed: Expected symbol XAUUSD, got ${res1.symbol}`);
        passed = false;
    } else if (res1.direction !== "BUY") {
        console.error(`❌ Test 1 Failed: Expected direction BUY, got ${res1.direction}`);
        passed = false;
    } else if (res1.entryType !== "MARKET") {
        console.error(`❌ Test 1 Failed: Expected entryType MARKET, got ${res1.entryType}`);
        passed = false;
    } else if (res1.entryMin !== 4336 || res1.entryMax !== 4340) {
        console.error(`❌ Test 1 Failed: Expected entry 4336-4340, got ${res1.entryMin}-${res1.entryMax}`);
        passed = false;
    } else if (res1.stopLoss !== 4332) {
        console.error(`❌ Test 1 Failed: Expected SL 4332, got ${res1.stopLoss}`);
        passed = false;
    } else if (res1.takeProfits?.length !== 5) {
        console.error(`❌ Test 1 Failed: Expected 5 TPs, got ${res1.takeProfits?.length}`);
        passed = false;
    } else if (res1.takeProfits?.[4]?.type !== "OPEN" || res1.takeProfits?.[4]?.price !== null) {
        console.error("❌ Test 1 Failed: Expected TP OPEN to have type OPEN and null price");
        passed = false;
    } else {
        console.log("✅ Test 1 Passed: Standard spec signal parsed correctly!");
    }

    // Test 2: Symbol Alias & Slash Separators
    const input2 = `BUY GOLD NOW @ 4340/4336 SL 4330 TP 4350`;
    const res2 = parseFastSignal(input2);
    if (res2.symbol === "XAUUSD" && res2.direction === "BUY" && res2.entryMin === 4336 && res2.entryMax === 4340) {
        console.log("✅ Test 2 Passed: Symbol alias & slash separator parsed!");
    } else {
        console.error("❌ Test 2 Failed:", res2);
        passed = false;
    }

    // Test 3: Follow-up Update (SL MOVE)
    const input3 = `SL MOVE 4334`;
    const res3 = parseFastSignal(input3);
    if (res3.isUpdate && res3.updateType === "SL_MOVE" && res3.updateMetadata?.newStopLoss === 4334) {
        console.log("✅ Test 3 Passed: Follow-up SL MOVE update parsed!");
    } else {
        console.error("❌ Test 3 Failed:", res3);
        passed = false;
    }

    // Test 4: Follow-up Update (Breakeven)
    const input4 = `MOVE SL TO BE`;
    const res4 = parseFastSignal(input4);
    if (res4.isUpdate && res4.updateType === "MOVE_BE") {
        console.log("✅ Test 4 Passed: Follow-up Breakeven update parsed!");
    } else {
        console.error("❌ Test 4 Failed:", res4);
        passed = false;
    }

    return passed;
}
