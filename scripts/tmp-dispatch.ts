// TEMP DEBUG — call the canonical executePine directly with the strategy-lab
// suite's exact Pine script + candles. DELETE before final report.
import { executePine } from "@/lib/pine-runtime/runtime";

const BASE = 1_750_000_000_000;
const STEP = 15 * 60 * 1000;
const candles = Array.from({ length: 10 }, (_, i) => {
  const o = 4000 + i;
  return {
    timestamp: BASE + i * STEP,
    open: o,
    high: o + 0.6,
    low: o - 0.4,
    close: o + 0.1,
    volume: 1000,
  };
});

const SCRIPT = `
//@version=6
strategy("CostTest", overlay=true)
strategy.entry("L", strategy.long)
if barstate.islast
    strategy.close("L")
`;

console.log("── executePine direct (canonical) ──");
const r = executePine(SCRIPT, candles, "XAUUSD", "M15");
const s = (r as any).strategy;
console.log("position_size:", s?.position_size);
console.log(
  "open_trades:",
  JSON.stringify((s?.open_trades ?? []).map((t: any) => ({ id: t.id, direction: t.direction, entryBar: t.entryBar, size: t.size }))),
);
console.log(
  "closed_trades:",
  JSON.stringify((s?.closed_trades ?? []).map((t: any) => ({ id: t.id, profit: t.profit, exitBar: t.exitBar, exitReason: t.exitReason }))),
);
console.log("trades:", (s?.closed_trades ?? []).length);
