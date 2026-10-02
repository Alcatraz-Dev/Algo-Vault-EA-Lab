/**
 * Market Intelligence AI sublayer barrel (additive modules only).
 */
export {
    gatherMultiSourceIntelligence,
    mapTimeframe,
    type MultiSourceIntelligenceInput,
    type MultiSourceIntelligenceResult,
} from "./external-intelligence-service";
export {
    buildTradingViewSystemPrompt,
    buildTradingViewUserPrompt,
    TRADINGVIEW_AI_BOUNDARY_RULES,
} from "./tradingview-ai-prompt";
export type { ExternalProviderErrorCode } from "./external-error-codes";
