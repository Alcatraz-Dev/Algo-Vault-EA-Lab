export { XAUUSD_SCALPING_DEFAULTS, pipsToPrice, formatPipDistance, deriveLevels } from "./config";
export type { XauUsdScalpingConfig, XauUsdScalpingTpLevel } from "./config";
export { createXauUsdScalpingStrategy } from "./strategy";
export type { XauUsdScalpingConfig as ScalpingConfig } from "./strategy";
export { buildScalpingEntry, signalFromOrder, executionFromFill } from "./executor";
export type { XauUsdScalpingOrderPayload } from "./executor";
// NOTE: `ScalpingBotRuntime` (./runtime) is deliberately NOT exported here.
// It reaches `lib/bot-studio/database` → firebase-admin → `server-only`, and
// client components import this barrel. Server code must import it directly:
// `import { ScalpingBotRuntime } from "@/lib/bot-studio/scalping/runtime"`.
export {
    BTCUSD_SMART_MONEY_DEFAULTS,
    evaluateSmartMoneySetup,
    averageTrueRange,
} from "./smart-money";
export type { SmartMoneyScalpingConfig, SmartMoneySetup } from "./smart-money";
