import { compileAvScript } from "@/lib/bot-studio/compiler/avscript-to-strategy";
import { strategyToAvScript } from "@/lib/bot-studio/compiler/strategy-to-avscript";

const sample = `
strategy({ name: "Golden Cross Bot", symbol: "EURUSD", timeframe: "H1", direction: "long" });
const fast = indicators.ema(close, 20);
const slow = indicators.ema(slow, 50);
crossesAbove(fast, slow);
enterLong({ riskPercent: 1.0, stopLoss: { type: "atr", multiplier: 2.0 }, takeProfit: { type: "riskReward", ratio: 2.0 } });
`;

const r = compileAvScript(sample, "STRAT_RT");
console.log("compile ok:", r.ok);
if (!r.ok || !r.value) { console.error(r.diagnostics); process.exit(1); }
const gen = strategyToAvScript(r.value);
console.log("generated:\n" + gen.source);
console.log("unsupported:", gen.unsupported);
const r2 = compileAvScript(gen.source, "STRAT_RT2");
console.log("recompile ok:", r2.ok, r2.diagnostics.map(d=>d.message).join("; "));
console.log("name match:", r2.value?.name === r.value.name);
console.log("risk match:", r2.value?.risk.riskPercent === r.value.risk.riskPercent);
console.log("rules match:", r2.value?.entryRules.length === r.value.entryRules.length);
