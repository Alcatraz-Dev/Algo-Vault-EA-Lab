/**
 * AlgoVault Bot Studio — canonical types.
 *
 * ONE strategy definition, ONE execution path. Visual builder and script editor
 * both compile into a `BotStrategy` record. That record drives backtesting,
 * paper trading, and live deployment through the same Strategy Engine and
 * AI Execution Gate — no alternative paths.
 *
 * RTDB layout:
 *   bot_strategies/{strategyId}     — strategy definition + metadata
 *   bot_deployments/{botId}         — deployment + runtime state
 *   bot_logs/{botId}/{logId}        — structured execution log entries
 *   bot_signals/{botId}/{signalId}  — signals produced by the runtime
 *   bot_executions/{botId}/{execId} — execution attempts (gate outcomes)
 *   bot_audit/{botId}/{auditId}     — immutable audit trail
 */

import type { Strategy } from "@/lib/strategy-lab/types";

// ─────────────────────────────────────────────────────────────────────────────
// Strategy lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full lifecycle states for a bot deployment.
 *
 * State machine:
 *   Draft → Validating → Ready → Backtesting → Ready
 *   Ready → Starting → Running → Pausing → Paused → Stopping → Stopped
 *   any → Error
 *   Stopped → Starting (restart)
 *
 * `desiredState` is set by admin intent; `runtimeState` tracks the actual
 * last-confirmed runtime status. They may diverge during transitions.
 */
export type BotLifecycleState =
    | "draft"           // created, not yet validated
    | "validating"      // validation in progress
    | "ready"           // validated, may be backtested or deployed
    | "backtesting"     // backtest running
    | "starting"        // deploying to account; connecting
    | "running"         // active tick loop; accepting signals
    | "pausing"         // stop requested; no new entries
    | "paused"          // runtime suspended; positions remain
    | "stopping"        // full stop requested
    | "stopped"         // cleanly stopped; no open bot positions
    | "paper"           // paper trading mode
    | "error";          // terminal error; manual intervention required

/** What the admin most recently requested. Separate from runtime truth. */
export type BotDesiredState = "running" | "paused" | "stopped" | "paper";

// ─────────────────────────────────────────────────────────────────────────────
// Strategy source — how the strategy was authored
// ─────────────────────────────────────────────────────────────────────────────

export type StrategySourceKind =
    | "visual_builder"  // compiled from a ReactFlow node graph
    | "avscript"        // compiled from AvScript source (Pine-based)
    | "imported";       // imported from JSON / manual

export interface VisualBuilderSource {
    kind: "visual_builder";
    /** Serialized node graph (ReactFlow JSON). */
    nodeGraph: string;
    /** Version of the visual compiler used to compile this graph. */
    compilerVersion: string;
}

export interface AvScriptSource {
    kind: "avscript";
    /** Raw AvScript source code. */
    source: string;
    /** Version of the AvScript compiler used. */
    compilerVersion: string;
}

export interface ImportedSource {
    kind: "imported";
    originalFormat?: string;
}

export type StrategySource = VisualBuilderSource | AvScriptSource | ImportedSource;

// ─────────────────────────────────────────────────────────────────────────────
// BotStrategy — persisted strategy definition
// ─────────────────────────────────────────────────────────────────────────────

export interface BotStrategy {
    /** Stable, unique ID. Prefix: `STRAT_`. Never collides with `user_bots/`. */
    id: string;
    /** Firebase UID of the admin or developer who owns this strategy. */
    authorId: string;
    /** Human-readable name. */
    name: string;
    /** Optional description. */
    description: string;
    /** Current validation/lifecycle state (not the same as deployment state). */
    state: "draft" | "valid" | "invalid";
    /** Issues from the last validation run. */
    validationErrors: string[];
    validationWarnings: string[];
    /** How this strategy was authored. */
    source: StrategySource;
    /**
     * The canonical, compiled Strategy definition. This is what the engine runs.
     * It is produced by the visual or script compiler; never written directly
     * by the UI without going through the compiler pipeline.
     */
    definition: Strategy;
    /** Structural fingerprint of `definition`. Changes when semantics change. */
    fingerprint: string;
    /** Magic number that the MT5 gateway will stamp on orders (stable). */
    magicNumber: number;
    createdAt: number;
    updatedAt: number;
    /** Last backtest summary (not the full result — stored separately). */
    lastBacktestAt?: number;
    lastBacktestPassed?: boolean;
    lastBacktestNetPnl?: number;
    lastBacktestWinRate?: number;
    lastBacktestTrades?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// BotDeployment — one running (or stopped) instance of a strategy
// ─────────────────────────────────────────────────────────────────────────────

export type BotAccountMode = "demo" | "live";

export interface BotDeployment {
    /** Stable ID. Prefix: `BOT_STUDIO_`. */
    id: string;
    /** Strategy this deployment runs. */
    strategyId: string;
    /** Strategy fingerprint when deployed — detects drift. */
    deployedFingerprint: string;
    /** Owner UID. */
    ownerId: string;
    /** Connected MT5 account identifier (from `trading_accounts/{uid}`). */
    mt5Account: string;
    /** demo or live. Live requires explicit authorization. */
    accountMode: BotAccountMode;
    /** Last-confirmed runtime state. */
    runtimeState: BotLifecycleState;
    /** What the admin most recently requested. */
    desiredState: BotDesiredState;
    /** Reason for entering error state, if applicable. */
    errorReason?: string;
    /** Timestamp of the last successful runtime tick. */
    lastTickAt?: number;
    /** Timestamp of the last signal generated. */
    lastSignalAt?: number;
    /** Timestamp of the last execution attempt (any outcome). */
    lastExecutionAt?: number;
    /** Number of signals generated since start. */
    signalCount: number;
    /** Number of successful executions since start. */
    executionCount: number;
    /** Number of rejected/failed execution attempts since start. */
    rejectionCount: number;
    /** Open position tickets attributed to this bot (by magic number). */
    openPositions: string[];
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    stoppedAt?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime log entries
// ─────────────────────────────────────────────────────────────────────────────

export type BotLogLevel = "info" | "warn" | "error" | "signal" | "execution" | "audit";

export interface BotLogEntry {
    id: string;
    botId: string;
    level: BotLogLevel;
    message: string;
    details?: Record<string, unknown>;
    timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signals produced by the bot runtime
// ─────────────────────────────────────────────────────────────────────────────

export type BotSignalDirection = "BUY" | "SELL";
export type BotSignalOutcome = "pending" | "submitted" | "rejected" | "expired" | "executed";

export interface BotSignal {
    id: string;
    botId: string;
    strategyId: string;
    symbol: string;
    direction: BotSignalDirection;
    /** Bar timestamp that triggered the signal (never a future bar). */
    barTimestamp: number;
    /** Wall-clock time the signal was generated. */
    generatedAt: number;
    /** Current outcome. */
    outcome: BotSignalOutcome;
    /** Gate rejection code, if rejected. */
    rejectionCode?: string;
    rejectionReason?: string;
    /** Execution ID if submitted to the gateway. */
    executionId?: string;
    /** Proposed entry price from the strategy (not the fill price). */
    proposedEntry?: number;
    proposedSl?: number;
    proposedTp?: number;
    /** Risk percent proposed. */
    proposedRiskPct?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution records
// ─────────────────────────────────────────────────────────────────────────────

export type BotExecutionStatus =
    | "gate_passed"
    | "gate_rejected"
    | "submitted"           // queued in trading_order_requests; broker outcome pending
    | "uncertain"           // report timed out after enqueue; reconciliation required
    | "acknowledged"        // EA reported it received the command
    | "filled"              // EA reported the order filled
    | "executed_pending_sync" // EA confirmed execution; position snapshot is late
    | "rejected_by_broker"
    | "failed"
    | "cancelled"
    | "expired";

export interface BotExecution {
    /** Unique execution attempt ID. Prefix: `BEXEC_`. */
    id: string;
    botId: string;
    strategyId: string;
    signalId: string;
    /** The client order ID submitted to the gateway. */
    clientOrderId?: string;
    /** MT5 ticket number returned by the gateway (null until confirmed). */
    mt5Ticket?: number;
    /** Provider-neutral correlation ID shared with the unified command/result. */
    correlationId?: string;
    /** Bar timestamp at which this strategy signal was generated. */
    signalGeneratedAt?: number;
    /** Time the unified trading service started authorizing this request. */
    authorizationStartedAt?: number;
    /** Time the command was durably queued for the MT5 Gateway. */
    queuedAt?: number;
    /** Time the MT5 Gateway EA reported this command. */
    gatewayReportedAt?: number;
    /** Time the broker confirmed the reported result. */
    brokerConfirmedAt?: number;
    /** Time the gateway snapshot exposed the position/order. */
    synchronizedAt?: number;
    /** Timestamp markers use epoch milliseconds unless explicitly sourced from the EA. */
    latencyMs?: Partial<Record<"authorization" | "queueToReport" | "brokerToSync", number>>;
    /** Provider execution outcome; used to distinguish queued, uncertain, and confirmed orders. */
    executionOutcome?: "accepted" | "uncertain" | "confirmed" | "rejected";
    /** True when the gateway outcome could not be established and needs review. */
    reconciliationRequired?: boolean;
    /** Time a reconciliation sweep or broker snapshot settled this execution. */
    reconciledAt?: number;
    /** Time broker state proved this execution (a lost report was recovered). */
    recoveredAt?: number;
    /** Evidence source for a recovered execution. Never invented. */
    recoverySource?: "broker_snapshot" | "execution_report";
    status: BotExecutionStatus;
    /** All gate check results. */
    gateChecks?: Array<{ stage: string; passed: boolean; code: string; reason?: string }>;
    symbol: string;
    direction: BotSignalDirection;
    volume?: number;
    entry?: number;
    sl?: number;
    tp?: number;
    /** Actual fill price from the gateway. */
    fillPrice?: number;
    /** Actual fill volume from the gateway. */
    fillVolume?: number;
    submittedAt?: number;
    acknowledgedAt?: number;
    filledAt?: number;
    rejectedAt?: number;
    failedAt?: number;
    createdAt: number;
    updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit trail
// ─────────────────────────────────────────────────────────────────────────────

export type BotAuditAction =
    | "strategy_created"
    | "strategy_updated"
    | "strategy_validated"
    | "strategy_backtested"
    | "strategy_deployed"
    | "bot_started"
    | "bot_stopped"
    | "bot_paused"
    | "bot_resumed"
    | "risk_limit_changed"
    | "execution_attempted"
    | "error_occurred"
    | "admin_override";

export interface BotAuditEntry {
    id: string;
    botId: string;
    strategyId: string;
    action: BotAuditAction;
    actorId: string;
    details: Record<string, unknown>;
    timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// API response types
// ─────────────────────────────────────────────────────────────────────────────

export interface BotStrategyCreateInput {
    name: string;
    description?: string;
    sourceKind: StrategySourceKind;
    /** For avscript: raw source code. */
    avscriptSource?: string;
    /** For visual_builder: serialized node graph JSON. */
    nodeGraph?: string;
}

export interface BotStrategyUpdateInput {
    name?: string;
    description?: string;
    avscriptSource?: string;
    nodeGraph?: string;
}

export interface BotDeployInput {
    strategyId: string;
    mt5Account: string;
    accountMode: BotAccountMode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution eligibility
// ─────────────────────────────────────────────────────────────────────────────

/** Why a bot can (or cannot) turn its next signal into a broker order. */
export type BotEligibilityCode =
    | "eligible"
    | "no_strategy"
    | "strategy_changed"
    | "live_disabled"
    | "gateway_offline"
    | "runtime_error";

/** Output of the single eligibility rule (`lib/bot-studio/eligibility`). */
export interface BotEligibility {
    /** May a START transition be initiated right now? */
    eligible: boolean;
    code: BotEligibilityCode;
    /** Operator-facing explanation. Null when nothing is wrong. */
    reason: string | null;
    /**
     * True when the bot can still run but needs attention first (today: a
     * runtime error, which a restart clears). A warning never blocks start.
     */
    warning: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminal-facing summaries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One open position attributed to a bot, as the gateway last reported it.
 *
 * These are the SAME positions indexed from the account snapshot under
 * `bot_positions/{botId}` — the terminal never derives a position the broker
 * did not report.
 */
export interface BotOpenPosition {
    ticket: string;
    symbol: string;
    /** BUY / SELL as reported by MT5 (normalised). */
    type: "BUY" | "SELL";
    volume: number;
    openPrice: number;
    currentPrice: number;
    profit: number;
    sl: number;
    tp: number;
    openedAt: number;
}

/** Realized + floating performance attributed to a bot (never account-wide). */
export interface BotPerformanceSummary {
    totalPnl: number;
    todayPnl: number;
    winRate: number;
    totalTrades: number;
    openTrades: number;
}

/**
 * Compact, owner-scoped view of one deployment for execution surfaces
 * (the terminal Bots panel). Rendered exactly as the server computed it: no
 * figure here is derived in the browser.
 */
export interface BotDeploymentSummary {
    botId: string;
    strategyName: string | null;
    strategyPresent: boolean;
    fingerprintMatches: boolean;
    symbol: string | null;
    timeframe: string | null;
    openPositions: number;
    floatingPnl: number;
    performance: BotPerformanceSummary | null;
    lastExecutionAt: number | null;
    lastExecutionStatus: BotExecutionStatus | null;
    eligibility: BotEligibility;
}
