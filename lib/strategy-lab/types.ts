import {
    MarketCandle,
    MarketStructureEvent,
    MarketStructurePoint,
    LiquidityLevel,
    LiquiditySweep,
    VolatilityData,
    VWAPData,
    Zone,
    MarketScore,
    Timeframe,
    SupportedSymbol,
    MarketRegime,
} from "@/lib/market-data/types";

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Lab domain model
// ─────────────────────────────────────────────────────────────────────────────

export type AnalysisPeriod = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

export const ANALYSIS_PERIODS: AnalysisPeriod[] = ["1M", "3M", "6M", "1Y", "3Y", "5Y"];

export const PERIOD_DAYS: Record<AnalysisPeriod, number> = {
    "1M": 30,
    "3M": 91,
    "6M": 182,
    "1Y": 365,
    "3Y": 1095,
    "5Y": 1825,
};

export type TrendState = "bullish" | "bearish" | "ranging" | "transition";

export type LiquiditySide = "buy_side" | "sell_side";

export type PriceActionKind = "impulse" | "consolidation" | "breakout" | "reversal" | "retest";

export type RangeKind = "m1" | "m3" | "m5" | "m15" | "m30" | "h1" | "h4" | "d1" | "custom";

export type TimeframeHierarchy = {
    macro: Timeframe;
    structure: Timeframe;
    setup: Timeframe;
    entry: Timeframe;
};

export const DEFAULT_HIERARCHY: TimeframeHierarchy = {
    macro: "H4",
    structure: "H1",
    setup: "M15",
    entry: "M5",
};

export type DataSourceKind = "biquote" | "local_export";

export type DataCoverage = {
    timeframe: Timeframe;
    availableBars: number;
    requestedFrom: number;
    requestedTo: number;
    availableFrom: number;
    availableTo: number;
    fullyCoversRequest: boolean;
    spanDays: number;
    source: DataSourceKind;
    maxSourceBars: number;
};

export type DataBundle = {
    symbol: SupportedSymbol;
    period: AnalysisPeriod;
    candles: Partial<Record<Timeframe, MarketCandle[]>>;
    coverage: DataCoverage[];
    requestedFrom: number;
    requestedTo: number;
    dataSource: {
        name: string;
        kind: DataSourceKind;
        brokerInstrumentNote: string;
        sourceLimits: Partial<Record<Timeframe, number>>;
        symbolsAreExchangePrices: boolean;
    };
    overallCoversRequest: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Market analysis
// ─────────────────────────────────────────────────────────────────────────────

export type TrendAnalysis = {
    state: TrendState;
    bias: "bullish" | "bearish" | "neutral";
    structureBias: "bullish" | "bearish" | "neutral";
    ema20: number;
    ema50: number;
    priceVsEma20: "above" | "below";
    higherHighs: boolean;
    higherLows: boolean;
    lowerHighs: boolean;
    lowerLows: boolean;
    regime: MarketRegime;
    regimeConfidence: number;
};

export type StructureAnalysis = {
    swingHighs: MarketStructurePoint[];
    swingLows: MarketStructurePoint[];
    events: MarketStructureEvent[];
    bosCount: number;
    chochCount: number;
    recentEvent: MarketStructureEvent | null;
    overall: "bullish" | "bearish" | "neutral";
};

export type LiquidityAnalysis = {
    levels: LiquidityLevel[];
    sweeps: LiquiditySweep[];
    recentSweep: LiquiditySweep | null;
    equalHighsAbove: number[];
    equalLowsBelow: number[];
    buySideCount: number;
    sellSideCount: number;
};

export type SessionStats = {
    session: "asian" | "london" | "new_york" | "overlap";
    sessionName: string;
    bars: number;
    averageRange: number;
    bullRun: "up" | "down" | "flat";
    winBias: "bullish" | "bearish" | "neutral";
    averageMovePercent: number;
};

export type HourOfDayStat = {
    hour: number;
    bars: number;
    averageRange: number;
    direction: "up" | "down" | "flat";
};

export type DayOfWeekStat = {
    day: string;
    bars: number;
    averageRange: number;
    direction: "up" | "down" | "flat";
};

export type TimeBehavior = {
    hourOfDay: HourOfDayStat[];
    dayOfWeek: DayOfWeekStat[];
    sessions: SessionStats[];
    bestSession: SessionStats | null;
    bestDay: DayOfWeekStat | null;
};

export type PriceActionAnalysis = {
    impulses: number;
    consolidations: number;
    breakouts: number;
    reversals: number;
    retests: number;
    sequence: PriceActionKind[];
};

export type SupportResistanceLevel = {
    price: number;
    touches: number;
    kind: "support" | "resistance" | "reaction_zone" | "breakout";
    strength: number;
    latest: number;
};

export type SupportResistanceAnalysis = {
    levels: SupportResistanceLevel[];
    nearestResistance: SupportResistanceLevel | null;
    nearestSupport: SupportResistanceLevel | null;
};

export type AdvancedAnalysis = {
    orderBlocks: Zone[];
    fairValueGaps: Zone[];
    vwap: VWAPData;
    volumeProfile: {
        available: boolean;
        notes: string;
    };
    orderFlowAvailable: boolean;
    orderFlowNote: string;
};

export type AnalysisResult = {
    symbol: SupportedSymbol;
    period: AnalysisPeriod;
    timeframe: Timeframe;
    barsUsed: number;
    coverage: DataCoverage;
    trend: TrendAnalysis;
    structure: StructureAnalysis;
    liquidity: LiquidityAnalysis;
    volatility: VolatilityData;
    priceAction: PriceActionAnalysis;
    sessions: TimeBehavior;
    supportResistance: SupportResistanceAnalysis;
    advanced: AdvancedAnalysis;
    score: MarketScore;
    candleSeries: MarketCandle[];
};

export type MarketAnalysisSet = {
    symbol: SupportedSymbol;
    period: AnalysisPeriod;
    generatedAt: number;
    hierarchy: TimeframeHierarchy;
    dataBundle: DataBundle;
    byTimeframe: Partial<Record<Timeframe, AnalysisResult>>;
    relationships: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Patterns
// ─────────────────────────────────────────────────────────────────────────────

export type PatternKind =
    | "liquidity_sweep_reversal"
    | "breakout_retest"
    | "trend_continuation"
    | "fvg_reaction"
    | "order_block_reaction"
    | "session_breakout"
    | "volatility_expansion"
    | "mean_reversion"
    | "momentum_continuation";

export type PatternStats = {
    occurrences: number;
    winning: number;
    losing: number;
    breakeven: number;
    winRate: number;
    averageR: number;
    averageReturnPercent: number;
    maxWinStreak: number;
    maxLossStreak: number;
    maxDrawdownPct: number;
    profitFactor: number;
    expectancy: number;
    averageBarsHeld: number;
    direction: "long" | "short";
};

export type Pattern = {
    id: string;
    kind: PatternKind;
    name: string;
    description: string;
    direction: "long" | "short";
    timeframe: Timeframe;
    matchCount: number;
    stats: PatternStats | null;
    conditions: string[];
    exampleTimestamps: number[];
};

export type PatternDiscoveryResult = {
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    period: AnalysisPeriod;
    generatedAt: number;
    barsScanned: number;
    patterns: Pattern[];
    topPattern: Pattern | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Strategy
// ─────────────────────────────────────────────────────────────────────────────

export type RuleOperator =
    | "eq"
    | "neq"
    | "gte"
    | "lte"
    | "gt"
    | "lt"
    | "in"
    | "contains"
    | "not_in";

export type RuleGroup =
    | "trend"
    | "liquidity"
    | "structure"
    | "fvg"
    | "order_block"
    | "session"
    | "volatility"
    | "price_action"
    | "confirmation"
    | "custom";

export type StrategyRule = {
    id: string;
    enabled: boolean;
    group: RuleGroup;
    label: string;
    operator: RuleOperator;
    timeframe?: Timeframe;
    value: string | number | boolean | string[];
    negate?: boolean;
    groupLogic: "AND" | "OR";
};

export type SLMode = "atr" | "level";
export type TPMode = "r" | "fixed";

export type StrategySL = {
    mode: SLMode;
    atrMultiple: number;
    levelOffset: number;
    useSwing: boolean;
};

export type PartialTake = {
    atR: number;
    closePercent: number;
};

export type StrategyTP = {
    mode: TPMode;
    r1: number;
    r2: number;
    r3: number;
    fixedDistance: number;
    partialCloses: PartialTake[];
    moveBeAfterTp1: boolean;
    lockAfterTp2: boolean;
    trailingEnabled: boolean;
    trailingStopAtr: number;
};

export type RiskMode = "percent" | "fixed_lot";

export type StrategyRisk = {
    mode: RiskMode;
    riskPercent: number;
    fixedLot: number;
    maxPositions: number;
    dailyLossLimitPct: number;
    maxDrawdownPct: number;
};

export type StrategyFilters = {
    sessions: Array<"asian" | "london" | "new_york" | "overlap">;
    daysOfWeek: number[];
    volatilityMinAtrPct: number;
    volatilityMaxAtrPct: number;
    maxTradesPerDay: number;
    cooldownCandles: number;
};

export type ExecutionModel = "next_bar_open" | "same_bar_close";

export type Strategy = {
    id: string;
    name: string;
    description: string;
    asset: SupportedSymbol;
    direction: "long" | "short";
    timeframes: TimeframeHierarchy;
    regimeFilter: MarketRegime[];
    entryRules: StrategyRule[];
    confirmationRules: StrategyRule[];
    stopLoss: StrategySL;
    takeProfit: StrategyTP;
    risk: StrategyRisk;
    filters: StrategyFilters;
    executionModel: ExecutionModel;
    costs: {
        spreadPips: number;
        commissionPerLot: number;
        slippagePips: number;
    };
    sourcePatternId: string | null;
    whyp: {
        discovered: string;
        conditionsSelected: string;
        occurrenceFrequency: string;
        historicalPerformance: string;
        weaknesses: string;
        poorRegimes: string;
        generatedByProvider: string;
    };
    version: string;
    created: number;
    updated: number;
};

/**
 * A natural-language-drafted strategy scaffold. The AI may only fill this
 * STRUCTURED scaffold (rules + config) — it never produces MQL5. The
 * deterministic mapper (lib/strategy-lab/interpret.ts) turns it into a full
 * Strategy that flows through the standard pipeline (backtest → validate →
 * EA compile).
 */
export type StrategyDraft = {
    name: string;
    description?: string;
    direction: "long" | "short";
    entryRules: Array<{
        id?: string;
        enabled?: boolean;
        group: RuleGroup;
        label?: string;
        operator: RuleOperator;
        timeframe?: Timeframe;
        value: string | number | boolean | string[];
        negate?: boolean;
        groupLogic?: "AND" | "OR";
    }>;
    confirmationRules?: StrategyRule[];
    stopLoss?: Partial<StrategySL>;
    takeProfit?: Partial<StrategyTP>;
    risk?: Partial<StrategyRisk>;
    filters?: Partial<StrategyFilters>;
    regimeFilter?: MarketRegime[];
    executionModel?: ExecutionModel;
};

// ─────────────────────────────────────────────────────────────────────────────
// Backtest
// ─────────────────────────────────────────────────────────────────────────────

export type BacktestDirection = "BUY" | "SELL";

export type ExitReason =
    | "tp1"
    | "tp2"
    | "tp3"
    | "sl"
    | "trailing"
    | "end_of_data"
    | "daily_loss_limit"
    | "drawdown_limit"
    | "mandatory_exit"
    | "max_trades";

export type BacktestConfig = {
    initialBalance: number;
    riskMode: "percent" | "fixed_lot";
    riskPercent: number;
    fixedLot: number;
    spreadPips: number;
    commissionPerLot: number;
    slippagePips: number;
    dailyLossLimitPct: number;
    maxDrawdownPct: number;
    maxPositions: number;
    executionModel: ExecutionModel;
    swapPerNight: number;
    from: number;
    to: number;
};

export type BacktestTrade = {
    id: string;
    ticket: number;
    openBarIndex: number;
    closeBarIndex: number;
    openedAt: number;
    closedAt: number;
    symbol: string;
    direction: BacktestDirection;
    volume: number;
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    exit: number;
    exitReason: ExitReason;
    profit: number;
    profitR: number;
    durationMs: number;
    regime: string;
    session: string;
    spreadCost: number;
    commission: number;
    slippageCost: number;
    pnlGross: number;
};

export type EquityPoint = {
    time: number;
    balance: number;
    equity: number;
    drawdownPct: number;
    drawdownAbs: number;
};

export type BacktestMetrics = {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    breakevenTrades: number;
    winRate: number;
    netProfit: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number;
    averageWin: number;
    averageLoss: number;
    expectancy: number;
    expectancyR: number;
    largestWin: number;
    largestLoss: number;
    maxDrawdownPct: number;
    maxDrawdownAbs: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    averageTradeDurationMs: number;
    returnPct: number;
    finalBalance: number;
    sharpeLike: number;
    recoveryFactor: number;
    buyHoldReturnPct: number;
    longTrades: number;
    shortTrades: number;
    longWinRate: number;
    shortWinRate: number;
};

export type BacktestResult = {
    id: string;
    symbol: SupportedSymbol;
    strategyId: string;
    strategyName: string;
    timeframe: Timeframe;
    generatedAt: number;
    config: BacktestConfig;
    metrics: BacktestMetrics;
    trades: BacktestTrade[];
    equity: EquityPoint[];
    coverage: DataCoverage;
    symbols: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Optimization
// ─────────────────────────────────────────────────────────────────────────────

export type OptimizeParam =
    | "slAtr"
    | "tp1R"
    | "tp2R"
    | "tp3R"
    | "riskPercent"
    | "sessions";

export type OptimizeRange = {
    param: OptimizeParam;
    values: Array<string | number>;
};

export type OptimizeResult = {
    config: Record<string, unknown>;
    metrics: BacktestMetrics;
    score: number;
    scoreBreakdown: Record<string, number>;
};

export type OptimizationOutcome = {
    id: string;
    symbol: SupportedSymbol;
    strategyId: string;
    generatedAt: number;
    ranges: OptimizeRange[];
    results: OptimizeResult[];
    best: OptimizeResult | null;
    worst: OptimizeResult | null;
    stabilityStdDev: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation (out-of-sample / walk-forward)
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationSlice = {
    label: string;
    from: number;
    to: number;
    metrics: BacktestMetrics;
    trades: number;
};

export type WalkForwardWindow = {
    train: { from: number; to: number };
    test: { from: number; to: number };
    trainMetrics: BacktestMetrics;
    testMetrics: BacktestMetrics;
    degradationPct: number;
};

export type ValidationOutcome = {
    id: string;
    symbol: SupportedSymbol;
    strategyId: string;
    strategyName: string;
    generatedAt: number;
    inSample: ValidationSlice;
    outOfSample: ValidationSlice;
    degradation: {
        winRateDiff: number;
        profitFactorDiff: number;
        returnDiff: number;
        maxDrawdownDiff: number;
        overall: number;
    };
    walkForward: {
        enabled: boolean;
        trainMonths: number;
        testMonths: number;
        windows: WalkForwardWindow[];
        stable: boolean;
        stabilityScore: number;
    };
    verdict: "robust" | "marginal" | "fragile" | "inconclusive";
    config: BacktestConfig;
};

// ─────────────────────────────────────────────────────────────────────────────
// Robustness score
// ─────────────────────────────────────────────────────────────────────────────

export type RobustnessScore = {
    score: number;
    grade: "A" | "B" | "C" | "D";
    factors: {
        consistency: number;
        drawdown: number;
        profitFactor: number;
        sampleSize: number;
        outOfSample: number;
        parameterSensitivity: number;
        losingStreaks: number;
    };
    notes: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Forward testing
// ─────────────────────────────────────────────────────────────────────────────

export type ForwardMode = "signal_only" | "paper" | "manual";

export type ForwardTrade = {
    id: string;
    signalId: string;
    openedAt: number;
    closedAt?: number;
    symbol: string;
    direction: BacktestDirection;
    entry: number;
    sl: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    currentPrice: number;
    exit?: number;
    exitReason?: ExitReason;
    profit?: number;
    profitR?: number;
    status: "open" | "closed";
    reasoning: string;
    regime: string;
    session: string;
};

export type ForwardTest = {
    id: string;
    uid: string;
    strategyId: string;
    strategyName: string;
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    hierarchy: TimeframeHierarchy;
    mode: ForwardMode;
    status: "running" | "paused" | "stopped";
    startedAt: number;
    updatedAt: number;
    signals: ForwardTrade[];
    metrics: BacktestMetrics | null;
    backtestMetrics: BacktestMetrics | null;
    deviation: {
        winRateDiff: number;
        profitabilityDiff: number;
    } | null;
    lastPrice: number;
    tradeCount: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Deployment
// ─────────────────────────────────────────────────────────────────────────────

export type DeployMode = "alerts_only" | "manual_confirmation" | "demo" | "live";

export type DeploymentStatus =
    | "pending"
    | "active"
    | "live"
    | "paused"
    | "disabled"
    | "expired"
    | "failed"
    | "stopped";

export type Deployment = {
    id: string;
    uid: string;
    strategyId: string;
    strategyName: string;
    symbol: SupportedSymbol;
    mode: DeployMode;
    status: DeploymentStatus;
    accountId?: string;
    mt5Account?: string;
    accountBroker?: string;
    accountServer?: string;
    currency?: string;
    termsAccepted: boolean;
    createdAt: number;
    updatedAt: number;
    lastSignalAt?: number;
    lastSignalId?: string;
    notes?: string;
    stoppedAt?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// API payloads
// ─────────────────────────────────────────────────────────────────────────────

export type AnalyzeRequest = {
    symbol: SupportedSymbol;
    period: AnalysisPeriod;
    hierarchy: TimeframeHierarchy;
};

export type PatternRequest = {
    symbol: SupportedSymbol;
    period: AnalysisPeriod;
    timeframe: Timeframe;
    minOccurrences?: number;
};

export type GenerateStrategyRequest = {
    symbol: SupportedSymbol;
    period: AnalysisPeriod;
    patternId?: string;
    direction?: "long" | "short";
};

export type BacktestRequest = {
    symbol: SupportedSymbol;
    strategyId: string;
    timeframe: Timeframe;
    config: BacktestConfig;
    from?: number;
    to?: number;
};

export type OptimizeRequest = {
    symbol: SupportedSymbol;
    strategyId: string;
    timeframe: Timeframe;
    ranges: OptimizeRange[];
    baseConfig: BacktestConfig;
    maxRuns?: number;
    from?: number;
    to?: number;
};

export type ValidateRequest = {
    symbol: SupportedSymbol;
    strategyId: string;
    timeframe: Timeframe;
    config: BacktestConfig;
    inSample: { from: number; to: number };
    outOfSample: { from: number; to: number };
    walkForward?: { enabled: boolean; trainMonths: number; testMonths: number };
    from?: number;
    to?: number;
};

export type DeployRequest = {
    strategyId: string;
    mode: DeployMode;
    accountId?: string;
    mt5Account?: string;
    termsAccepted: boolean;
};

export type AccessStatus = {
    accessible: boolean;
    level: "none" | "pro" | "feature_license" | "trading_license";
    status: "active" | "expired" | "none";
    productId?: string;
    expiresAt?: number;
    reason?: string;
};