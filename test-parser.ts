import { parseFastSignal } from "@/features/telegram-signals/parser/fast-parser";

// Test messages from typical Telegram signal channels
const testMessages = [
    // Standard format
    "BUY XAUUSD @ 2655 - 2657\nSL: 2649\nTP1: 2662\nTP2: 2670\nTP3: 2680",
    
    // Gold Sniper style
    "🦁 GOLD SNIPER 🦁\nBUY GOLD NOW @ 2650-2652\nSL 2645\nTP1 2660\nTP2 2670\nTP3 2680",
    
    // Forex Crown style
    "👑 FOREX CROWN 👑\nSELL EURUSD @ 1.0850\nSL: 1.0870\nTP1: 1.0830\nTP2: 1.0810\nTP3: 1.0790",
    
    // NitroFX style
    "NITROFX SIGNAL\nBUY XAUUSD 2655\nSL 2649\nTP 2662\nTP 2670",
    
    // AH Trades style
    "AH TRADES\n🟢 BUY GOLD 🟢\nEntry: 2650-2655\nStop Loss: 2644\nTake Profit 1: 2660\nTake Profit 2: 2670\nTake Profit 3: 2680",
    
    // Short format
    "BUY GOLD 2650 SL 2645 TP 2660",
    
    // Update message
    "TP1 HIT on GOLD",
    "MOVE SL TO BE",
];

for (const msg of testMessages) {
    console.log("\n=== Testing: ===");
    console.log(msg);
    console.log("--- Result ---");
    const result = parseFastSignal(msg);
    console.log("isSignal:", result.isSignal);
    console.log("symbol:", result.symbol);
    console.log("direction:", result.direction);
    console.log("entryMin:", result.entryMin);
    console.log("entryMax:", result.entryMax);
    console.log("stopLoss:", result.stopLoss);
    console.log("takeProfits:", JSON.stringify(result.takeProfits));
    console.log("confidence:", result.confidence);
    console.log("errors:", result.errors);
    console.log("warnings:", result.warnings);
}
