/**
 * Bot Studio scalping — shared exports.
 *
 * Only PURE modules are re-exported here: this index is imported by client
 * components (the config form). Server-only modules are imported directly by
 * their path so they can never be pulled into a browser bundle:
 *
 *   ./session       — runtime seams (imports the bot runtime)
 *   ./pacing        — persisted pacing state (imports firebase-admin)
 *   ./methodologies — Skills Registry trace
 *   ./report        — persisted bot activity report
 */

// Legacy XAUUSD scalper helper (kept: existing UI and templates depend on it)
export { XAUUSD_SCALPING_DEFAULTS, pipsToPrice, formatPipDistance, deriveLevels } from "./config";
export type {
    XauUsdScalpingConfig,
    XauUsdScalpingDirection,
    XauUsdScalpingTpLevel,
} from "./config";
export { readSmartMoneyScalpDirection } from "./smart-money";
export type {
    SmartMoneyScalpOptions,
    SmartMoneyScalpRead,
    SmartMoneySide,
} from "./smart-money";
export { createXauUsdScalpingStrategy } from "./strategy";
export type { XauUsdScalpingConfig as ScalpingConfig } from "./strategy";
export { buildScalpingEntry, signalFromOrder, executionFromFill } from "./executor";
export type { XauUsdScalpingOrderPayload } from "./executor";

// Configurable LONG/SHORT/BOTH scalping profiles
export {
    SCALPING_ALLOWED_TIMEFRAMES,
    SCALPING_LIMITS,
    SCALPING_PRESETS,
    buildScalpingStrategy,
    defaultScalpingConfig,
    describeScalpingConfig,
    directionPermits,
    normalizeScalpingConfig,
} from "./profiles";
export type {
    BuildScalpingStrategyOptions,
    ScalpingBotConfig,
    ScalpingConfigResult,
    ScalpingDirectionMode,
    ScalpingPresetId,
    ScalpingSession,
    ScalpingTimeframe,
} from "./profiles";

export { SCALPING_MIN_BARS, evaluateDirectionalScalping, scoreSignalConfidence, timeframeMs } from "./directional";

// Independent LONG/SHORT execution lanes (hedging-aware)
export { planDirectionalLanes, summarizeLanes } from "./lanes";
export type {
    DirectionalLanePlan,
    LaneIntent,
    LaneIntentStatus,
    LaneOpenPositions,
    LanePacing,
    LanePlanInput,
    LaneSummary,
    LaneWaitReason,
    ScalpingLaneId,
} from "./lanes";
export type { TradingPositionMode } from "@/lib/trading/position-mode";
export type {
    ConfidenceComponent,
    DirectionalEvaluationOptions,
    DirectionalScalpingEvaluation,
    ScalpingDecision,
    ScalpingSideEvaluation,
    ScalpingWaitReason,
} from "./directional";
