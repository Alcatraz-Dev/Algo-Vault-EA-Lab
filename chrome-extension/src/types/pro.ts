/**
 * AlgoVault Pro Trading Intelligence — shared types for the premium
 * extension surfaces (Pro entitlement, TradingView MCP context, Setup
 * Radar, Smart Alerts, MTF Intelligence, AI Indicator/Strategy Generator,
 * Command Bar, Live Intelligence Panel).
 *
 * The extension NEVER trusts client-supplied Pro status; it asks the
 * server via `/api/extension/pro-access` and caches the answer with TTL.
 */

/* ── Pro entitlement ───────────────────────────────────────────────── */

export type ProPlan = "pro" | "elite" | "enterprise" | "vip" | "admin";

export interface ProSubscription {
    plan: ProPlan | string | null;
    status: "active" | "trialing" | "expired" | "cancelled" | "past_due" | string;
    currentPeriodEnd?: number | null;
}

export interface ProAccess {
    access: "granted" | "denied";
    reason?: string;
    upgrade?: boolean;
    subscription?: ProSubscription;
    userId?: string;
    timestamp: number;
}

export interface ProFeatureFlags {
    tradingViewProExtension: boolean;
    aiChartCopilot: boolean;
    setupRadar: boolean;
    smartAlerts: boolean;
    aiIndicatorGenerator: boolean;
    aiStrategyGenerator: boolean;
    mtfIntelligence: boolean;
    commandBar: boolean;
    liveIntelligencePanel: boolean;
    copilotMemory: boolean;
    preTradeChecklist: boolean;
    historicalReplay: boolean;
    strategyHealth: boolean;
    marketRadar: boolean;
    visualStrategyBuilder: boolean;
    researchPipeline: boolean;
    aiOverlay: boolean;
    proCommandCenter: boolean;
    tradingViewExecutionBridge: boolean;
}

/* ── TradingView MCP context (server-normalised) ────────────────────── */

export type MCPConnectionState =
    | "DISCONNECTED"
    | "CONNECTING"
    | "CONNECTED"
    | "TOKEN_EXPIRED"
    | "REAUTH_REQUIRED"
    | "ERROR"
    | "DISABLED"
    | "RATE_LIMITED";

export interface MCPProvenance {
    source: "ALGOVAULT" | "TRADINGVIEW" | "BROKER" | "OTHER_EXTERNAL";
    provider: string;
    fetchedAt: number;
    cache: "hit" | "miss" | "bypassed";
    freshness: "realtime" | "fresh" | "delayed" | "stale" | "cached" | "historical" | "unknown";
    sourceTimestamp: number | null;
}

export interface MCPQuote {
    symbol: string;
    price: number | null;
    change: number | null;
    changePercent: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
    description?: string | null;
    exchange?: string | null;
    provenance: MCPProvenance;
}

export interface MCPTechIndicator {
    name: string;
    value: number | string | null;
}

export interface MCPTechSnapshot {
    symbol: string;
    interval: string;
    indicators: Record<string, number | string | null>;
    recommendation: { classification: string; label: string } | null;
    provenance: MCPProvenance;
}

export interface MCPNewsItem {
    id: string;
    title: string;
    provider?: string | null;
    publishedAt: number | null;
    link?: string | null;
    urgency?: number | null;
    relatedSymbols?: string[];
    provenance: MCPProvenance;
}

export interface MCPError {
    capability: string;
    code: string;
    message: string;
}

export interface MCPContextResponse {
    success: boolean;
    state: "not_connected" | "disabled" | "ready" | "partial" | "rate_limited" | "error";
    symbol: string | null;
    timeframe: string | null;
    exchange: string | null;
    connection: {
        provider: string;
        state: MCPConnectionState | string;
        authorized: boolean;
        message?: string;
    };
    quote: MCPQuote | null;
    technicals: MCPTechSnapshot | null;
    news: MCPNewsItem[];
    capabilities: Array<{ id: string; supported: boolean }>;
    fetchedAt: number;
    durationMs: number;
    errors: MCPError[];
}

/* ── Connection state used by the UI ───────────────────────────────── */

export type ExtensionConnectionStatus = "CONNECTED" | "SYNCING" | "LIMITED" | "DISCONNECTED";

/* ── Setup Radar (reuses existing Setup Memory semantics) ──────────── */

export type SetupRadarStatus =
    | "WAITING"
    | "FORMING"
    | "CONFIRMATION"
    | "ACTIVE"
    | "INVALIDATED"
    | "EXPIRED";

export type SetupDirection = "LONG" | "SHORT" | "NEUTRAL";

export interface SetupRadarCard {
    id: string;
    symbol: string;
    timeframe: string;
    direction: SetupDirection;
    setupType: string;
    status: SetupRadarStatus;
    entryZone?: { from: number; to: number } | null;
    invalidation?: number | null;
    targets?: number[];
    riskContext?: string;
    supportingEvidence: string[];
    conflictingEvidence: string[];
    strategyId?: string | null;
    strategyName?: string | null;
    createdAt: number;
    updatedAt: number;
    /** Underlying setup-memory record id (when synced server-side). */
    memoryId?: string | null;
}

export interface SetupRadarSnapshot {
    symbol: string;
    timeframe: string;
    setups: SetupRadarCard[];
    fetchedAt: number;
}

/* ── Smart Alerts (deterministic facts, optional AI priority hint) ─── */

export type AlertSeverity = "info" | "notice" | "warning" | "critical";
export type AlertCategory =
    | "liquidity_sweep"
    | "ema_alignment"
    | "fvg_confirmation"
    | "strategy_conditions"
    | "setup_forming"
    | "setup_invalidated"
    | "htf_conflict"
    | "volatility"
    | "structure_break";

export interface SmartAlert {
    id: string;
    symbol: string;
    timeframe: string;
    category: AlertCategory;
    severity: AlertSeverity;
    title: string;
    message: string;
    evidence: string[];
    /** AI priority hint (-100..100), never a probability of success. */
    priority: number;
    createdAt: number;
}

/* ── Multi-timeframe intelligence ──────────────────────────────────── */

export interface MTFRow {
    timeframe: string;
    role: "macro" | "structure" | "confirmation" | "entry" | "context";
    state: "BULLISH" | "BEARISH" | "NEUTRAL" | "RANGE" | "TRANSITION" | "UNKNOWN";
    structure?: "HH/HL" | "LH/LL" | "RANGE" | "BREAK" | "CHOCH" | "UNKNOWN";
    momentum?: "EXPANDING" | "CONTRACTING" | "STEADY" | "UNKNOWN";
    setup?: "FORMING" | "CONFIRMED" | "INVALIDATED" | "WAITING" | "UNKNOWN";
    conflicts?: string[];
    notes?: string[];
}

export interface MTFResponse {
    symbol: string;
    baseTimeframe: string;
    rows: MTFRow[];
    fetchedAt: number;
}

/* ── AI Indicator Generator ────────────────────────────────────────── */

export interface IndicatorSpec {
    name: string;
    description: string;
    inputs: Array<{ key: string; label: string; defaultValue: number | string | boolean; kind: "int" | "float" | "bool" | "select"; options?: string[] }>;
    outputs: Array<{ kind: "hline" | "hline_zone" | "shape" | "label" | "fill"; description: string }>;
    pineVersion: "v5" | "v6";
    notes: string;
    limitations: string[];
}

export interface GeneratedIndicator {
    id: string;
    name: string;
    description: string;
    spec: IndicatorSpec;
    code: string;
    warnings: string[];
    /** Deterministic checks performed on the generated code. */
    validation: {
        syntaxOk: boolean;
        pineVersion: string;
        issues: string[];
        /** When true the server has stored it under `indicatorsLibrary/{uid}/...`. */
        savedToLibrary: boolean;
        indicatorId?: string;
    };
    createdAt: number;
}

/* ── AI Strategy Generator ─────────────────────────────────────────── */

export interface GeneratedStrategy {
    id: string;
    name: string;
    description: string;
    spec: {
        symbolScope: string;
        timeframe: string;
        entry: { conditions: string[] };
        exit: { conditions: string[]; stopLogic: string; takeProfitLogic: string };
        filters: string[];
        riskAssumptions: string;
        timeframeAssumptions: string;
    };
    code: string;
    warnings: string[];
    validation: {
        syntaxOk: boolean;
        issues: string[];
        savedToLibrary: boolean;
        strategyId?: string;
    };
    createdAt: number;
}

/* ── Live Intelligence Panel (header summary) ──────────────────────── */

export interface LiveIntelligenceSnapshot {
    symbol: string;
    timeframe: string;
    tradingView: { state: ExtensionConnectionStatus; ageMs: number | null };
    mcp: { state: MCPConnectionState | string; authorized: boolean };
    ai: { state: "ready" | "busy" | "error" | "unknown"; lastCallMs: number | null };
    market: { bias: "BULLISH" | "BEARISH" | "NEUTRAL"; score: number };
    setup: { status: SetupRadarStatus | "UNKNOWN"; matchedConditions: number; totalConditions: number };
    higherTimeframe: { aligned: boolean; label: string };
    risk: { level: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN"; note?: string };
}

/* ── AI Command Bar ────────────────────────────────────────────────── */

export type CommandId =
    | "analyze_chart"
    | "explain_setup"
    | "find_conflicts"
    | "what_am_i_missing"
    | "run_checklist"
    | "research_setup"
    | "backtest_setup"
    | "create_indicator"
    | "create_strategy"
    | "compare_saved_strategy"
    | "show_similar_setups"
    | "show_strategy_health"
    | "show_market_radar"
    | "show_mtf"
    | "show_smart_alerts"
    | "open_algovault"
    | "open_research"
    | "why_invalid"
    | "scan_symbol"
    | "explain_indicators";

export interface CommandSpec {
    id: CommandId;
    label: string;
    description: string;
    icon: string;
    keywords: string[];
    requiresContext?: boolean;
}

/* ── Pre-Trade Checklist ───────────────────────────────────────────── */

export type ChecklistStatus = "confirmed" | "warning" | "failed" | "unresolved";

export interface ChecklistItem {
    id: string;
    category: "MARKET STRUCTURE" | "LIQUIDITY" | "FVG" | "MOMENTUM" | "HTF CONTEXT" | "VOLATILITY" | "STRATEGY CONDITIONS";
    status: ChecklistStatus;
    title: string;
    explanation: string;
    evidenceSource: string;
    timestamp?: number;
    unresolvedReason?: string;
    rawEvidence?: string[];
}

export interface PreTradeChecklistResponse {
    symbol: string;
    timeframe: string;
    items: ChecklistItem[];
    passedCount: number;
    totalCount: number;
    fetchedAt: number;
}

/* ── What Am I Missing? ────────────────────────────────────────────── */

export interface MissingPoint {
    id: string;
    title: string;
    detail: string;
    severity: "critical" | "warning" | "info";
    category:
        | "htf_conflict"
        | "ltf_conflict"
        | "nearby_liquidity"
        | "key_level"
        | "structure_weakness"
        | "indicator_disagreement"
        | "abnormal_volatility"
        | "incomplete_strategy"
        | "invalidation_proximity"
        | "insufficient_data";
    evidence: string[];
}

export interface WhatAmIMissingResponse {
    symbol: string;
    timeframe: string;
    points: MissingPoint[];
    fetchedAt: number;
}

/* ── Historical Setup Replay ───────────────────────────────────────── */

export interface HistoricalMatch {
    id: string;
    timestamp: number;
    dateLabel: string;
    symbol: string;
    timeframe: string;
    setupName: string;
    conditions: string[];
    similarityScore: number; // 0..100
    similarityReasons: string[];
    subsequentMovement: string;
    outcomeClassification: "Target Reached" | "Invalidated" | "Expired" | "Partial";
}

export interface SetupReplayResponse {
    currentSetup: {
        symbol: string;
        timeframe: string;
        bias: string;
        type: string;
        conditions: string[];
    };
    historicalMatches: HistoricalMatch[];
    disclaimer: string;
    fetchedAt: number;
}

/* ── Strategy Health Monitor ───────────────────────────────────────── */

export type HealthRating = "GOOD" | "ELEVATED" | "EXTREME" | "ALIGNED" | "MIXED" | "CONFLICT" | "POOR" | "INSUFFICIENT_DATA";

export interface StrategyHealthCard {
    strategyId: string;
    strategyName: string;
    marketCompatibility: HealthRating;
    volatilityState: HealthRating;
    htfAlignment: HealthRating;
    conditionsMatched: number;
    conditionsTotal: number;
    regime: string;
    historicalResearchAvailable: boolean;
    dataSufficiency: "HIGH" | "MODERATE" | "LOW";
    notes: string[];
    updatedAt: number;
}

export interface StrategyHealthResponse {
    symbol: string;
    timeframe: string;
    strategies: StrategyHealthCard[];
    fetchedAt: number;
}

/* ── Multi-Symbol Pro Market Radar ─────────────────────────────────── */

export interface MarketRadarItem {
    symbol: string;
    timeframe: string;
    marketState: "BULLISH" | "BEARISH" | "RANGE" | "TRANSITION";
    setupState: SetupRadarStatus;
    strategyName: string;
    matchedConditions: string; // e.g. "5/6"
    alertStatus: "ACTIVE" | "NONE" | "ACKNOWLEDGED";
    lastUpdateMs: number;
}

export interface MarketRadarResponse {
    items: MarketRadarItem[];
    fetchedAt: number;
}

/* ── Copilot Historical Memory Adapter ─────────────────────────────── */

export interface CopilotMemoryContext {
    savedStrategiesCount: number;
    savedIndicatorsCount: number;
    activeSetupsCount: number;
    recentAnalysesCount: number;
    similarSavedStrategies: Array<{ id: string; name: string; reasons: string[] }>;
    similarHistoricalResearch: Array<{ id: string; title: string; outcome: string }>;
    recentDismissedSetups: Array<{ setupType: string; timestamp: number }>;
}

/* ── Evidence Score Visualization ──────────────────────────────────── */

export interface EvidenceScoreCategory {
    name: "STRUCTURE" | "LIQUIDITY" | "MOMENTUM" | "HTF ALIGNMENT" | "VOLATILITY";
    score: number; // 0..10
    maxScore: number;
    label: string;
}

export interface EvidenceScoreBreakdown {
    categories: EvidenceScoreCategory[];
    disclaimer: string;
}