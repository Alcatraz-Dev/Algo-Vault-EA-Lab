// Strategy → MT5 EA Generator — deterministic AST.
//
// The Strategy Lab Strategy type is the single source of truth. This module
// defines the canonical EA specification that the MQL5 generator consumes.
// No AI model ever produces executable MQL5 directly; it may only suggest
// structured rules that flow through this deterministic pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import { Timeframe } from "../../market-data/types";

export type EAIndicator = {
    id: string;
    name: string;
    type: "EMA" | "SMA" | "RSI" | "MACD" | "Stochastic" | "ATR" | "BollingerBands" | "ADX" | "VWAP" | "AwesomeOscillator" | "Volume";
    params: Record<string, number>;
    timeframe: Timeframe;
    symbol?: string;
    buffer?: number;
};

export type EAPositionSize = {
    mode: "percent" | "fixed_lot";
    riskPercent?: number;
    fixedLot?: number;
    maxPositions: number;
    maxDailyLossPct: number;
    maxDrawdownPct: number;
};

export type EATrailingStop = {
    enabled: boolean;
    atrMultiple: number;
};

export type EABreakEven = {
    enabled: boolean;
    triggerR: number;
    offsetR: number;
};

export type EAPartialClose = {
    atR: number;
    closePercent: number;
};

export type EATakeProfit = {
    mode: "r" | "fixed";
    r1: number;
    r2: number;
    r3: number;
    fixedDistance: number;
    partialCloses: EAPartialClose[];
    moveBEAfterTp1: boolean;
    lockAfterTp2: boolean;
    trailingEnabled: boolean;
    trailingStopAtr: number;
};

export type EASessionFilter = {
    enabled: boolean;
    sessions: Array<"asian" | "london" | "new_york" | "overlap">;
};

export type EASpreadFilter = {
    enabled: boolean;
    maxSpreadPips: number;
};

export type EANewsFilter = {
    enabled: boolean;
    minutesBefore: number;
    minutesAfter: number;
};

export type EAFilters = {
    sessions: EASessionFilter;
    daysOfWeek: number[];
    volatilityMinAtrPct: number;
    volatilityMaxAtrPct: number;
    maxTradesPerDay: number;
    cooldownCandles: number;
    spread: EASpreadFilter;
    news: EANewsFilter;
};

export type EAStrategySpec = {
    strategyId: string;
    name: string;
    description: string;
    version: string;
    generatorVersion: string;
    strategyHash: string;
    magicNumber: number;
    symbol: string;
    symbols: string[];
    timeframe: Timeframe;
    timeframes: Record<string, Timeframe>;
    direction: "long" | "short";
    indicators: EAIndicator[];
    entryConditions: string[];
    exitConditions: string[];
    risk: EAPositionSize;
    takeProfit: EATakeProfit;
    breakEven: EABreakEven;
    trailingStop: EATrailingStop;
    filters: EAFilters;
    executionModel: "next_bar_open" | "same_bar_close";
    costs: {
        spreadPips: number;
        commissionPerLot: number;
        slippagePips: number;
    };
    maxPositions: number;
    enableGateway: boolean;
    enableLicense: boolean;
    licenseDurationDays: number;
    sourceAvailable: boolean;
    protected: boolean;
    metadata: {
        generatedAt: number;
        strategyVersion: string;
        configurationHash: string;
        generatorVersion: string;
        aiAssisted: boolean;
    };
};

export type ValidationIssue = {
    severity: "error" | "warning";
    field: string;
    message: string;
};

export type EAStrategySnapshot = {
    strategyId: string;
    name: string;
    version: string;
    symbol: string;
    timeframe: Timeframe;
    direction: "long" | "short";
    risk: {
        mode: "percent" | "fixed_lot";
        riskPercent: number;
        fixedLot: number;
        maxPositions: number;
        dailyLossLimitPct: number;
        maxDrawdownPct: number;
    };
    stopLoss: { mode: "atr" | "level"; atrMultiple: number; levelOffset: number; useSwing: boolean };
    takeProfit: {
        mode: "r" | "fixed";
        r1: number;
        r2: number;
        r3: number;
        fixedDistance: number;
        partialCloses: { atR: number; closePercent: number }[];
        moveBeAfterTp1: boolean;
        lockAfterTp2: boolean;
        trailingEnabled: boolean;
        trailingStopAtr: number;
    };
    filters: {
        sessions: Array<"asian" | "london" | "new_york" | "overlap">;
        daysOfWeek: number[];
        volatilityMinAtrPct: number;
        volatilityMaxAtrPct: number;
        maxTradesPerDay: number;
        cooldownCandles: number;
    };
    executionModel: "next_bar_open" | "same_bar_close";
    costs: { spreadPips: number; commissionPerLot: number; slippagePips: number };
    regimeFilter: string[];
    maxSpreadPoints: number;
};

export type EAGenerationResult = {
    success: boolean;
    spec?: EAStrategySnapshot;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    code?: string;
    compiled?: boolean;
    compilerOutput?: string;
    compileErrors?: string[];
    compileWarnings?: string[];
    hash?: string;
    /** Deterministic parity report comparing the compiled EA behavior with the
     *  Strategy Lab backtest engine (never fabricated — states known
     *  differences such as broker rounding, tick data and fee handling). */
    parity?: EAParityReport;
    /** Generation metadata snapshot (identity / versioning / compilation). */
    meta?: {
        strategyId: string;
        strategyVersion: string;
        symbol: string;
        timeframe: Timeframe;
        magicNumber: number;
        generatorVersion: string;
        eaVersion: string;
        configurationHash: string;
        executionModel: "next_bar_open" | "same_bar_close";
        usedTimeframes: string[];
        fileName: string;
        fileVersion: number;
        compileMethod?: "metaeditor" | "static";
        compiledAt?: number;
    };
};

export type CompileResult = {
    success: boolean;
    errors: string[];
    warnings: string[];
    code: string;
};

/**
 * Parity report — an explicit, honest account of how the generated EA maps to
 * the backtest engine. Every entry is derived deterministically from the
 * strategy at generation time.
 */
export type EAParityReport = {
    generatedAt: number;
    version: string;
    items: Array<{
        area: string;
        backtest: string;
        ea: string;
        difference: "none" | "minor" | "significant" | "improved";
        note?: string;
    }>;
    caveats: string[];
    summary: string;
};

export type GeneratedEA = {
    eaId: string;
    userId: string;
    strategyId: string;
    strategyVersion: string;
    strategyHash: string;
    name: string;
    symbol: string;
    timeframe: Timeframe;
    magicNumber: number;
    generatorVersion: string;
    sourceAvailable: boolean;
    compiled: boolean;
    protected: boolean;
    fileVersion: number;
    code: string | null;
    createdAt: number;
    updatedAt: number;
    licenseDurationDays: number;
    enableGateway: boolean;
    marketplaceProductId?: string;
    /** Exact strategy version this EA was compiled from (aliases strategyVersion). */
    version?: string;
    /** EA file/spec version — increments when the generator emits new code. */
    eaVersion?: string;
    /** Execution model captured from the strategy at generation time. */
    executionModel?: "next_bar_open" | "same_bar_close";
    /** Config hash over the exact strategy snapshot used (magic derives from it). */
    configurationHash?: string;
    /** Risk config snapshot so old EAs stay identifiable after edits. */
    riskConfig?: Record<string, unknown>;
    /** Trade management snapshot (TP/SL/partials/BE/trailing). */
    tradeManagementConfig?: Record<string, unknown>;
    /** Optional AI-provided plain-language explanation (with deterministic fallback). */
    aiNotes?: string | null;
    /** Result of the last (re)compile/validation pass. */
    compileReport?: {
        compiled: boolean;
        errors: string[];
        warnings: string[];
        compilerOutput?: string;
        compiledAt: number;
        method: "metaeditor" | "static" | "embedded";
    } | null;
    /** Deterministic parity report for this EA. */
    parity?: EAParityReport | null;
    /** Deployment info when registered with the AlgoVault Trade Gateway bot registry. */
    gateway?: {
        botId: string;
        productId: string | null;
        magicNumber: string;
        symbol: string;
        registeredAt: number;
    } | null;
    /** Marketplace publish info. */
    marketplace?: {
        productId: string;
        status: string;
        version: string;
        fileName: string;
        publishedAt: number;
    } | null;
};

/**
 * Options accepted at EA generation time.
 */
export type EAGenerateOptions = {
    enableGateway?: boolean;
    enableLicense?: boolean;
    licenseDurationDays?: number;
    sourceAvailable?: boolean;
    protected?: boolean;
    generatorVersion?: string;
    /** When true, attempts a real MetaEditor compile and fails hard on errors. */
    compile?: boolean;
};