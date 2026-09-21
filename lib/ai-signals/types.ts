import { MarketCandle } from "@/lib/market-data/types";

export type SignalDirection = "BUY" | "SELL";

export type SignalSourceType = "AI_GENERATED" | "TELEGRAM" | "MANUAL" | "STRATEGY_LAB";

export type SignalValidationStatus = "VALIDATED" | "STALE" | "INVALIDATED" | "PENDING" | "FAILED";

export interface MarketContextForAI {
    symbol: string;
    currentPrice: number;
    bid: number;
    ask: number;
    spread: number;
    timestamp: string;
    dataAgeMs: number;
    provider: string;
    marketSession: string;
    marketStatus: string;
    timeframe: string;
    trend: Record<string, unknown>;
    marketStructure: Record<string, unknown>;
    liquidity: Record<string, unknown>;
    volatility: Record<string, unknown>;
    supportResistance: Record<string, unknown>;
    vwap: Record<string, unknown>;
    fvg: Record<string, unknown>;
    orderBlocks: Record<string, unknown>;
    regime: Record<string, unknown>;
    higherTimeframeContext: Record<string, unknown>;
    lowerTimeframeContext: Record<string, unknown>;
    recentCandles: Array<Record<string, unknown>>;
    multiTimeframeCandles: Record<string, Array<Record<string, unknown>>>;
}

export interface AISignalCandidate {
    symbol: string;
    direction: SignalDirection;
    entry: number;
    entryRange?: { min: number; max: number };
    stopLoss: number;
    takeProfits: Array<{ index: number; price: number }>;
    timeframe: string;
    setup: string;
    reasoning: string;
    confidence: number;
    invalidationCondition: string;
    expirationSuggestion: string;
}

export interface SignalGenerationResult {
    success: boolean;
    signal?: Partial<AISignal>;
    error?: string;
    errorType?: "MARKET_DATA_UNAVAILABLE" | "MARKET_DATA_STALE" | "PRICE_MISMATCH" | "INVALID_ENTRY" | "INVALID_SL" | "INVALID_TP" | "AI_FAILED" | "VALIDATION_FAILED";
    marketSnapshot?: { timestamp: number; dataAgeMs: number; provider: string; currentPrice: number };
    priceSanity?: { passed: boolean; referencePrice: number; currentPrice: number; differencePercent: number };
}

export type SignalStrength = "WEAK" | "MODERATE" | "GOOD" | "STRONG" | "VERY_STRONG" | "HIGH_CONVICTION";

export type SignalStatus =
    | "SCANNING"
    | "FORMING"
    | "WATCH"
    | "READY"
    | "NEW"
    | "PENDING_ENTRY"
    | "ENTRY_TRIGGERED"
    | "ACTIVE"
    | "TP1_REACHED"
    | "TP2_REACHED"
    | "TP3_REACHED"
    | "TP4_REACHED"
    | "TP5_REACHED"
    | "TP1_HIT"
    | "TP2_HIT"
    | "TP3_HIT"
    | "RUNNER"
    | "CLOSED"
    | "CANCELLED"
    | "EXPIRED"
    | "STOPPED"
    | "STOPPED_OUT"
    | "INVALIDATED"
    | "OUTCOME_AMBIGUOUS"
    | "COMPLETED"
    | "STALE";

export type MarketRegime =
    | "TRENDING_BULLISH"
    | "TRENDING_BEARISH"
    | "RANGING"
    | "BREAKOUT"
    | "REVERSAL"
    | "HIGH_VOLATILITY"
    | "LOW_VOLATILITY"
    | "UNCERTAIN";

export type SignalCategory =
    | "forex"
    | "gold"
    | "indices"
    | "crypto"
    | "stocks";

export type MarketSessionName = "asian" | "london" | "new_york" | "overlap" | "closed";

export type SignalTier = "FREE" | "PRO";

export type SignalResult =
    | "PENDING"
    | "WIN"
    | "LOSS"
    | "BREAKEVEN"
    | "EXPIRED"
    | "CANCELLED";

export interface ConfidenceBreakdown {
    trendAlignment: { score: number; max: number; detail: string };
    marketStructure: { score: number; max: number; detail: string };
    liquidity: { score: number; max: number; detail: string };
    momentum: { score: number; max: number; detail: string };
    volume: { score: number; max: number; detail: string };
    orderFlow: { score: number; max: number; detail: string };
    entryConfirmation: { score: number; max: number; detail: string };
    total: number;
}

export interface SignalAnalysis {
    trend?: string;
    structure?: string;
    liquidity?: string;
    momentum?: string;
    volume?: string;
    orderFlow?: string;
    higherTimeframe?: string;
    regime?: string;
}

export interface SignalTimelineEvent {
    id: string;
    timestamp: number;
    type:
        | "SETUP_DETECTED"
        | "CONFIDENCE_CHANGE"
        | "STATUS_CHANGE"
        | "ENTRY_TRIGGERED"
        | "TP1_HIT"
        | "TP2_HIT"
        | "TP3_HIT"
        | "SL_HIT"
        | "SIGNAL_INVALIDATED"
        | "SIGNAL_EXPIRED"
        | "MANAGEMENT_UPDATE"
        | "SIGNAL_CREATED"
        | "SIGNAL_UPDATED"
        | "SIGNAL_STALE"
        | "MARKET_CHANGE"
        | "AI_UPDATE";
    message: string;
    metadata?: Record<string, unknown>;
}

export type SignalEventType =
    | "NEW_SIGNAL"
    | "SIGNAL_UPDATED"
    | "ENTRY_TRIGGERED"
    | "TP1_REACHED"
    | "TP2_REACHED"
    | "TP3_REACHED"
    | "TP4_REACHED"
    | "TP5_REACHED"
    | "SL_HIT"
    | "BREAKEVEN"
    | "PROFIT_LOCK"
    | "SIGNAL_EXPIRED"
    | "SIGNAL_CANCELLED"
    | "SIGNAL_CLOSED"
    | "SIGNAL_INVALIDATED";

export interface MarketContextForAI {
    symbol: string;
    timeframe: Timeframe;
    currentPrice: number;
    bid: number;
    ask: number;
    spreadPips: number;
    trend: string;
    marketStructure: "trending_bullish" | "trending_bearish" | "ranging" | "uncertain";
    structureBias: "bullish" | "bearish" | "neutral";
    supportResistance: Array<{ price: number; type: "support" | "resistance" }>;
    liquidity: {
        levels: Array<{ price: number; type: string; strength: number }>;
        sweeps: Array<{ side: string; level: number; timestamp: number }>;
    };
    VWAP: { value: number; distancePercent: number };
    volume: { current: number; average: number; relative: number; state: string };
    ATR: { value: number; percent: number; state: string };
    regime: string;
    marketSession: string;
    marketStatus: "open" | "closed";
    higherTimeframeContext: {
        timeframe: Timeframe;
        bias: string;
        trend: string;
        lastPrice: number;
    };
    recentCandles: Array<{
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }>;
}

export interface AiSignalUserInput {
    notes?: string;
    style?: string;
    timeframe?: string;
    riskReward?: number;
    maxSpreadPips?: number;
    directionBias?: "BUY" | "SELL";
}

export interface AiSignalProposal {
    direction: "BUY" | "SELL";
    entry: number;
    stopLoss: number;
    tp1: number;
    tp2: number;
    tp3: number;
    confidence: number;
    reasoning: string;
}

export interface AISignal {
    id: string;
    symbol: string;
    direction: SignalDirection;
    timeframe: string;
    category: SignalCategory;
    tier: SignalTier;

    entry: number;
    stopLoss: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    tp4?: number;

    confidence: number;
    strength: SignalStrength;
    marketRegime: MarketRegime;
    riskReward: number;
    riskRewardTp2?: number;
    riskRewardTp3?: number;

    status: SignalStatus;
    statusMessage?: string;

    // Result tracking
    result: SignalResult;
    resultR: number;
    profitPoints: number;
    completedAt?: number;

    // Multi-target tracking
    tp1Hit: boolean;
    tp2Hit: boolean;
    tp3Hit: boolean;
    tp1HitAt?: number;
    tp2HitAt?: number;
    tp3HitAt?: number;
    tp1HitPrice?: number;
    tp2HitPrice?: number;
    tp3HitPrice?: number;

    analysis: SignalAnalysis;
    confidenceBreakdown: ConfidenceBreakdown;
    reasoning: string;

    currentPrice: number;
    distanceToEntry: number;
    distanceToSL: number;

    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    activatedAt?: number;

    // Versions
    engineVersion: string;
    strategyVersion: string;
    analysisVersion?: string;
    generatedBy: string;

    // Monitoring
    lastCheckedAt: number;
    followCount: number;
    tradeCount: number;

    // Ownership
    createdFor?: string;

    // Risk info
    suggestedRiskPercent: number;
    pipValue: number;
    contractSize: number;
    typicalSpread: number;
    digits: number;

    sourceType?: SignalSourceType;
    sourceId?: string;
    marketDataTimestamp?: number;
    marketDataAgeMs?: number;
    marketDataProvider?: string;
    generationPrice?: number;
    validationStatus?: SignalValidationStatus;
    validationReason?: string;
    entryTriggeredAt?: number;
    actualEntryPrice?: number;
    stopLossReachedAt?: number;
    closedAt?: number;
    expiredAt?: number;
    cancelledAt?: number;
    invalidatedAt?: number;
    mfe?: number;
    mae?: number;
    realizedR?: number;
    currentR?: number;
    originalTelegramMessage?: string;
    sourceChannel?: string;
    sourceMessageId?: string;
    aiAnalysis?: Array<{ timestamp: number; type: string; content: string; facts: Record<string, unknown> }>;
    timeline: Array<{ id: string; timestamp: number; type: string; message: string; metadata?: Record<string, unknown> }>;
}

export interface SignalConfig {
    id: string;
    name: string;
    enabled: boolean;

    symbols: string[];
    timeframes: string[];
    categories: SignalCategory[];

    // Tier-specific timeframes
    freeTimeframes: string[];
    proTimeframes: string[];

    minimumConfidence: number;
    minimumRiskReward: number;
    minimumStrength: SignalStrength;

    signalCooldownMinutes: number;
    signalExpirationHours: number;

    sessions: MarketSessionName[];

    weights: {
        trendAlignment: number;
        marketStructure: number;
        liquidity: number;
        momentum: number;
        volume: number;
        orderFlow: number;
        entryConfirmation: number;
    };

    riskDefaults: {
        riskPercent: number;
        maxPositions: number;
    };

    // Tier limits
    freeSignalsPerDay: number;
    proSignalsPerDay: number;

    // Engine versioning
    engineVersion: string;
    strategyVersion: string;
    analysisVersion: string;

    updatedAt: number;
    updatedBy: string;
}

export interface SignalFollow {
    userId: string;
    signalId: string;
    followedAt: number;
    notifiedAt?: number;
}

export interface SignalAnalytics {
    totalSignals: number;
    activeSignals: number;
    winningSignals: number;
    losingSignals: number;
    expiredSignals: number;
    cancelledSignals: number;
    winRate: number;
    averageRR: number;
    averageConfidence: number;
    tp1HitRate: number;
    tp2HitRate: number;
    tp3HitRate: number;
    slRate: number;
    bySymbol: Record<string, { count: number; winRate: number; avgRR: number }>;
    byTimeframe: Record<string, { count: number; winRate: number; avgRR: number }>;
    bySession: Record<string, { count: number; winRate: number; avgRR: number }>;
    byRegime: Record<string, { count: number; winRate: number; avgRR: number }>;
    sentiments: MarketSentiment[];
    generatedAt: number;
}

export interface SymbolSpec {
    symbol: string;
    category: SignalCategory;
    pipSize: number;
    pipDigits: number;
    contractSize: number;
    typicalSpread: number;
    digits: number;
    minLot: number;
    maxLot: number;
    tickValue: number;
    preferredSessions: MarketSessionName[];
    volatilityMultiplier: number;
}

export interface MarketSentiment {
    symbol: string;
    direction: SignalDirection | "NEUTRAL";
    confidence: number;
    signalCount: number;
    lastSignalAt: number;
}

export interface DailySignalCount {
    date: string;
    free: number;
    pro: number;
    total: number;
}

export interface SignalEvent {
    eventId: string;
    signalId: string;
    eventType:
        | "CREATED"
        | "READY"
        | "ENTRY_REACHED"
        | "TP1_HIT"
        | "BE_RECOMMENDED"
        | "TP2_HIT"
        | "TP3_HIT"
        | "STOP_LOSS_HIT"
        | "EXPIRED"
        | "COMPLETED"
        | "CANCELLED"
        | "STATUS_CHANGE";
    price?: number;
    timestamp: number;
    metadata?: Record<string, unknown>;
}

export interface SignalStats {
    period: string;
    tier?: SignalTier;
    symbol?: string;
    timeframe?: string;
    totalSignals: number;
    winningSignals: number;
    losingSignals: number;
    breakevenSignals: number;
    expiredSignals: number;
    winRate: number;
    lossRate: number;
    averageR: number;
    totalR: number;
    profitFactor: number;
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
    maxWinningStreak: number;
    maxLosingStreak: number;
    tp1HitRate: number;
    tp2HitRate: number;
    tp3HitRate: number;
    averageSignalStrength: number;
    maxDrawdown: number;
    calculatedAt: number;
}

export interface StrengthLabel {
    min: number;
    max: number;
    label: string;
    color: string;
}

export const STRENGTH_LABELS: StrengthLabel[] = [
    { min: 0, max: 49, label: "WEAK", color: "#ef4444" },
    { min: 50, max: 64, label: "MODERATE", color: "#f59e0b" },
    { min: 65, max: 74, label: "GOOD", color: "#3b82f6" },
    { min: 75, max: 84, label: "STRONG", color: "#2563eb" },
    { min: 85, max: 94, label: "VERY STRONG", color: "#1d4ed8" },
    { min: 95, max: 100, label: "HIGH CONVICTION", color: "#10b981" },
];

export function getStrengthLabelForScore(score: number): StrengthLabel {
    for (const sl of STRENGTH_LABELS) {
        if (score >= sl.min && score <= sl.max) return sl;
    }
    return STRENGTH_LABELS[STRENGTH_LABELS.length - 1];
}
