// Debug: exercise compileMQL5 against a small valid EA and print the full result.
// Run: ./node_modules/.bin/jiti lib/strategy-lab/ea/tests/debug-compile.ts
import { compileMQL5 } from "../compile";

const code = `#property strict
input ulong  MagicNumber        = 123456;
input ENUM_TIMEFRAMES SetupTimeframe = PERIOD_M15;
int OnInit() { return INIT_SUCCEEDED; }
void OnDeinit(const int reason) {}
void OnTick() {
   static datetime g_lastSetupBarTime = 0;
   datetime t = iTime(_Symbol, SetupTimeframe, 0);
   if(t == g_lastSetupBarTime) return;
   g_lastSetupBarTime = t;
   Print("tick ", _Symbol);
}
`;

async function main() {
    const result = await compileMQL5(code, "DebugCompileTest_v1_0_0.mq5", { timeoutMs: 120_000 });
    console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
});