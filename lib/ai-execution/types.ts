/**
 * AI Trade Execution — canonical domain model.
 *
 * Additive layer over the existing AlgoVault stack:
 *   Market Intelligence → Setup detection → AI TradePlan → deterministic
 *   Execution Gate → existing gateway (mt5_orders / trading_order_requests).
 *
 * Rules enforced by construction:
 *   • Evidence is never fabricated — every evidence item carries a source id,
 *     an evidence class (OBSERVED | DERIVED | HISTORICAL | AI_INTERPRETATION |
 *     UNAVAILABLE) and a timestamp. `UNAVAILABLE` items carry a reason, never a
 *     filler value.
 *   • The TradePlan is a PROPOSAL. It never carries execution state that the
 *     broker/gateway did not produce (no fake tickets, no "executed" before the
 *     gateway confirms).
 *   • AI interpretation is always labeled AI_INTERPRETATION and can never be
 *     the sole basis for execution (see evidence-validation in gate.ts).
 */

import type { MarketRegime } from "@/lib/ai-signals/types";

// ─────────────────────────────────────────────────────────────────────────────
// Evidence model — preserves the platform's provenance labels
// ─────────────────────────────────────────────────────────────────────────────

export type EvidenceClass =
    | "OBSERVED"          // came from a live market-data feed
    | "DERIVED"           // computed deterministically by an analytics engine
    | "HISTORICAL"        // from backtest/replay records (labeled as such)
    | "AI_INTERPRETATION" // AI summary/interpretation of structured evidence
    | "UNAVAILABLE";      // engine did not answer — carries a reason, never a value

export type EvidenceSourceId =
    | "market-data.biquote-ohlc"
    | "market-data.tradingview-live"
    | "analytics.market-structure"
    | "analytics.liquidity"
    | "analytics.zones"
    | "analytics.market-regime"
    | "analytics.volatility"
    | "analytics.multi-timeframe"
    | "analytics.indicators"
    | "ai-signals.scan-symbol"
    | "ai-signals.confidence"
    | "agents.pipeline"
    | "strategy-lab.backtest"
    | "ai-execution.interpretation";

export interface EvidenceItem {
    id: string;
    evidenceClass: EvidenceClass;
    sourceId: EvidenceSourceId;
    label: string;
    /** Machine-readable value snapshot (numbers only — no narrative payloads). */
    value?: number | string | boolean;
    /** ISO-like ms timestamp of the underlying data, NOT of the plan. */
    observedAt: number | null;
    /** Required for UNAVAILABLE items; forbidden for others to be "unknown". */
    reason?: string;
}

export function unavailableEvidence(
    id: string,
    sourceId: EvidenceSourceId,
    label: string,
    reason: string,
): EvidenceItem {
    return { id, evidenceClass: "UNAVAILABLE", sourceId, label, observedAt: null, reason };
}

export function observedEvidence(
    id: string,
    sourceId: EvidenceSourceId,
    label: string,
    value: number | string | boolean,
    observedAt: number | null,
): EvidenceItem {
    return { id, evidenceClass: sourceId === "ai-execution.interpretation" ? "AI_INTERPRETATION" : sourceId.startsWith("strategy-lab") ? "HISTORICAL" : "OBSERVED", sourceId, label, value, observedAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// TradePlan
// ─────────────────────────────────────────────────────────────────────────────

export type TradeDirection = "BUY" | "SELL";
export type ExecutionMode = "ANALYSIS" | "APPROVAL" | "AUTOMATION";

export type TradePlanStatus =
    | "DRAFT"                 // generated, not yet validated
    | "VALIDATING"
    | "REJECTED"              // failed a deterministic gate — never recoverable in place
    | "PENDING_APPROVAL"      // approval mode: waiting for an explicit user action
    | "APPROVED"              // approved, queued toward the gate's submission stage
    | "SUBMITTED"             // queued in the gateway path; broker confirmation pending
    | "OPEN"                  // gateway reported a live position ticket
    | "MONITORING"
    | "CLOSED"
    | "CANCELLED"             // expired before execution or user-withdrawn
    | "FAILED";               // submission error

export const TERMINAL_PLAN_STATUSES: readonly TradePlanStatus[] = [
    "REJECTED", "CLOSED", "CANCELLED", "FAILED",
];

export type RejectionStage =
    | "SCHEMA"
    | "EVIDENCE"
    | "DATA_FRESHNESS"
    | "SETUP_LIFECYCLE"
    | "RISK"
    | "AUTHORIZATION"
    | "EXECUTION_POLICY"
    | "DUPLICATE"
    | "SUBMISSION";

export interface TradePlan {
    id: string;
    userId: string;

    // Core trade shape
    instrument: string;
    direction: TradeDirection;
    timeframe: string;
    entry: number;
    stopLoss: number;
    takeProfits: Array<{ index: number; price: number }>;
    riskPercent: number;
    /** Set by the risk engine at gate time; never trusted from AI output. */
    positionSizeLots?: number;

    // Provenance
    setupId?: string;
    setupDefinitionId?: string;
    strategyId?: string;
    signalId?: string;
    marketRegime: MarketRegime | string;
    evidence: EvidenceItem[];
    /** AI narrative — always AI_INTERPRETATION, never the basis for execution. */
    aiInterpretation?: string;
    aiModel?: string;
    invalidationConditions: string[];

    // Lifecycle
    status: TradePlanStatus;
    executionMode: ExecutionMode;
    generatedAt: number;
    expiresAt: number;

    // Gate outcome
    riskValidation?: {
        approved: boolean;
        code: string;
        reason?: string;
        evaluatedAt: number;
    };
    rejectionStage?: RejectionStage;
    rejectionReason?: string;

    // Execution linkage (only ever filled from real gateway records)
    execution?: {
        mt5Account?: string;
        clientOrderId?: string;
        gatewayTicket?: string;
        submittedAt?: number;
        confirmedAt?: number;
    };

    // Audit
    auditRef?: string;
    workflowRunId?: string;
    createdAt: number;
    updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution policy — server-side configuration (never client-supplied)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionPolicy {
    userId: string;
    /** Default is ANALYSIS — automation is ALWAYS opt-in. */
    executionMode: ExecutionMode;
    enabled: boolean;
    updatedAt: number;
    updatedBy: string;

    automation?: AutomationPolicy;
}

export interface AutomationPolicy {
    /** Hard upper bounds (fallbacks when user does not configure). */
    maxRiskPercentPerTrade: number;   // default 1.0
    maxTotalOpenRiskPercent: number;  // default 6.0
    maxDailyLossPercent: number;      // default 5.0
    maxOpenPositions: number;         // default 5
    maxPositionsPerInstrument: number;// default 1
    maxConcurrentAutomatedTrades: number; // default 1
    maxLot: number;                   // default 1.0
    minStopDistancePips: number;      // default 5
    maxSpreadPips: number;            // default 3
    /** Max age of market data accepted for automated execution (ms). */
    maxDataAgeMs: number;             // default 60_000
    /** Restrict automation to these instruments (whitelist; empty = none). */
    allowedInstruments: string[];
    /** Trading-session restrictions (UTC hours, empty = unrestricted). */
    tradingHoursUtc: { startHour: number; endHour: number } | null;
    /** Cooldown after a loss, seconds. */
    cooldownAfterLossSeconds: number; // default 300
    /** Plan-level expiry applied to every generated plan (ms). */
    planExpiryMs: number;             // default 15 * 60_000
    /** Require at least this many non-AI evidence items before automation. */
    minEvidenceCount: number;         // default 3
    /** Instruments excluded by the data-quality engine are always blocked. */
    requireSetupQualification: boolean; // default true
}

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
    maxRiskPercentPerTrade: 1,
    maxTotalOpenRiskPercent: 6,
    maxDailyLossPercent: 5,
    maxOpenPositions: 5,
    maxPositionsPerInstrument: 1,
    maxConcurrentAutomatedTrades: 1,
    maxLot: 1,
    minStopDistancePips: 5,
    maxSpreadPips: 3,
    maxDataAgeMs: 60_000,
    allowedInstruments: [],
    tradingHoursUtc: null,
    cooldownAfterLossSeconds: 300,
    planExpiryMs: 15 * 60_000,
    minEvidenceCount: 3,
    requireSetupQualification: true,
};

/** Server-side hard ceilings that a user policy can NEVER exceed. */
export const AUTOMATION_HARD_CEILINGS: AutomationPolicy = {
    maxRiskPercentPerTrade: 2,
    maxTotalOpenRiskPercent: 10,
    maxDailyLossPercent: 10,
    maxOpenPositions: 10,
    maxPositionsPerInstrument: 2,
    maxConcurrentAutomatedTrades: 3,
    maxLot: 5,
    minStopDistancePips: 0,
    maxSpreadPips: 10,
    maxDataAgeMs: 5 * 60_000,
    allowedInstruments: [],
    tradingHoursUtc: null,
    cooldownAfterLossSeconds: 0,
    planExpiryMs: 60 * 60_000,
    minEvidenceCount: 1,
    requireSetupQualification: true,
};

/**
 * Clamp a user policy into the server-side hard ceilings. Runs on the SERVER
 * at read time, so even a manually-corrupted RTDB node cannot widen risk.
 */
export function clampAutomationPolicy(input: Partial<AutomationPolicy> | undefined): AutomationPolicy {
    const merged: AutomationPolicy = { ...DEFAULT_AUTOMATION_POLICY, ...(input ?? {}) };
    const clamp = (v: number, min: number, max: number) =>
        Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

    merged.maxRiskPercentPerTrade = clamp(merged.maxRiskPercentPerTrade, 0.05, AUTOMATION_HARD_CEILINGS.maxRiskPercentPerTrade);
    merged.maxTotalOpenRiskPercent = clamp(merged.maxTotalOpenRiskPercent, merged.maxRiskPercentPerTrade, AUTOMATION_HARD_CEILINGS.maxTotalOpenRiskPercent);
    merged.maxDailyLossPercent = clamp(merged.maxDailyLossPercent, 0.5, AUTOMATION_HARD_CEILINGS.maxDailyLossPercent);
    merged.maxOpenPositions = Math.round(clamp(merged.maxOpenPositions, 1, AUTOMATION_HARD_CEILINGS.maxOpenPositions));
    merged.maxPositionsPerInstrument = Math.round(clamp(merged.maxPositionsPerInstrument, 1, AUTOMATION_HARD_CEILINGS.maxPositionsPerInstrument));
    merged.maxConcurrentAutomatedTrades = Math.round(clamp(merged.maxConcurrentAutomatedTrades, 1, AUTOMATION_HARD_CEILINGS.maxConcurrentAutomatedTrades));
    merged.maxLot = clamp(merged.maxLot, 0.01, AUTOMATION_HARD_CEILINGS.maxLot);
    merged.minStopDistancePips = clamp(merged.minStopDistancePips, AUTOMATION_HARD_CEILINGS.minStopDistancePips, 1000);
    merged.maxSpreadPips = clamp(merged.maxSpreadPips, 0.1, AUTOMATION_HARD_CEILINGS.maxSpreadPips);
    merged.maxDataAgeMs = clamp(merged.maxDataAgeMs, 5_000, AUTOMATION_HARD_CEILINGS.maxDataAgeMs);
    merged.cooldownAfterLossSeconds = clamp(merged.cooldownAfterLossSeconds, AUTOMATION_HARD_CEILINGS.cooldownAfterLossSeconds, 3600);
    merged.planExpiryMs = clamp(merged.planExpiryMs, 60_000, AUTOMATION_HARD_CEILINGS.planExpiryMs);
    merged.minEvidenceCount = Math.round(clamp(merged.minEvidenceCount, AUTOMATION_HARD_CEILINGS.minEvidenceCount, 10));
    merged.allowedInstruments = Array.isArray(merged.allowedInstruments)
        ? merged.allowedInstruments.map((s) => String(s).toUpperCase().replace("/", "")).slice(0, 50)
        : [];
    return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kill switch
// ─────────────────────────────────────────────────────────────────────────────

export interface AiExecutionKillSwitch {
    engaged: boolean;
    reason?: string;
    engagedBy?: string;
    engagedAt?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution gate
// ─────────────────────────────────────────────────────────────────────────────

export interface GateCheck {
    stage: RejectionStage | "DATA_FRESHNESS" | "SETUP_LIFECYCLE" | "DUPLICATE";
    passed: boolean;
    code: string;
    reason?: string;
}

export interface ExecutionGateResult {
    decision: "EXECUTE" | "WAIT_APPROVAL" | "REJECT";
    checks: GateCheck[];
    finalCode: string;
    reason?: string;
    /** Present only when decision === "EXECUTE". */
    orderVolume?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI position monitoring
// ─────────────────────────────────────────────────────────────────────────────

export type PositionReviewVerdict =
    | "THESIS_VALID"
    | "THESIS_WEAKENED"
    | "INVALIDATION_DETECTED"
    | "MANAGEMENT_CONDITION_TRIGGERED"
    | "MONITORING_WARNING"
    | "EXIT_CONDITION_DETECTED"
    | "UNAVAILABLE";

export interface PositionReview {
    id: string;
    userId: string;
    planId: string;
    clientOrderId?: string;
    ticket?: string;
    verdict: PositionReviewVerdict;
    /** AI narrative — interpretation only. */
    summary: string;
    /** Deterministic, evidence-linked facts the verdict rests on. */
    evidence: EvidenceItem[];
    /** Proposed protective action (never executed directly by AI). */
    proposedAction?: {
        kind: "MOVE_SL" | "PARTIAL_CLOSE" | "CLOSE" | "NONE";
        params?: Record<string, number | string>;
        reason: string;
    };
    model?: string;
    createdAt: number;
}
