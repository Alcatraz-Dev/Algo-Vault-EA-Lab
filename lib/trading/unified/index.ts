/**
 * Unified Trading Service — public surface.
 *
 * Import this module instead of reaching into individual provider files. The
 * Pro Terminal, the AI surfaces, signals, bots, workflows and the future
 * TradingView extension all consume these types and this service.
 */

export * from "./domain";
export { tradingError, httpStatusForTradingError, mapMt5Retcode, defaultMessageFor } from "./errors";
export type { TradingProviderAdapter, TradingProviderDescriptor, TradingResult, AdapterExecutionInput } from "./adapter";
export { TradingProviderRegistry } from "./adapter";
export { planPartialClose, proportionalProfit, roundVolume, VolumeError } from "./volume";
export type { PartialClosePlan } from "./volume";
export { UnifiedTradingService } from "./service";
export type { UnifiedTradingDeps, UnifiedExecutionOutcome, ExecuteInput } from "./service";
export { MockTradingProvider, MOCK_PROVIDER } from "./mock-provider";
export type { MockTradingProviderOptions } from "./mock-provider";
export { Mt5DemoProvider, MT5_PROVIDER, MT5_ACCOUNT_PREFIX, classifyMt5Environment, isMt5AccountId } from "./mt5-demo-provider";
export type { Mt5DemoProviderConfig } from "./mt5-demo-provider";
export {
    UNIFIED_PATHS,
    hashRequest,
    claimExecutionRequest,
    saveExecutionResult,
    saveUnifiedAccount,
    listUnifiedAccounts,
    getUnifiedAccount,
    appendAuditEvent,
} from "./store";
export type { ExecutionRequestRecord, IdempotencyOutcome, UnifiedAccountRecord } from "./store";