export { XAUUSD_SCALPING_DEFAULTS, pipsToPrice, formatPipDistance, deriveLevels } from "./config";
export type { XauUsdScalpingConfig, XauUsdScalpingTpLevel } from "./config";
export { createXauUsdScalpingStrategy } from "./strategy";
export type { XauUsdScalpingConfig as ScalpingConfig } from "./strategy";
export { buildScalpingEntry, signalFromOrder, executionFromFill } from "./executor";
export type { XauUsdScalpingOrderPayload } from "./executor";
