// Smart Trade Management Types
// Extends existing trading architecture without breaking it

// ============================================
// TRADE STATE MACHINE
// ============================================

export type TradeState =
    | "PENDING"
    | "OPEN"
    | "TP1_APPROACHING"
    | "TP1_HIT"
    | "BE_PENDING"
    | "BE_APPLIED"
    | "TP2_APPROACHING"
    | "TP2_HIT"
    | "PROFIT_LOCKED"
    | "TP3_APPROACHING"
    | "TP3_HIT"
    | "RUNNER_ACTIVE"
    | "TRAILING"
    | "CLOSED"
    | "STOPPED"
    | "CANCELLED";

export type TradeDirection = "BUY" | "SELL";

export type TrailingType = "fixed" | "atr" | "structure" | "percent";

// ============================================
// TARGET CONFIGURATION
// ============================================

export type TargetConfig = {
    price: number;
    closePercent: number; // 0-100, percentage of position to close at this target
    hit: boolean;
    hitAt?: number;
    hitPrice?: number;
    eventIds: string[];
};

// ============================================
// TRADE MANAGEMENT CONFIGURATION
// ============================================

export type TradeManagementConfig = {
    // TP Management
    tp1: TargetConfig;
    tp2: TargetConfig;
    tp3: TargetConfig;
    tp4?: TargetConfig; // optional
    runnerPercent: number; // remaining % after all TPs

    // Break Even
    breakEvenEnabled: boolean;
    breakEvenTrigger: "TP1" | "TP2" | "TP3"; // which TP triggers BE
    breakEvenOffset: number; // points offset from entry

    // Profit Lock
    profitLockEnabled: boolean;
    profitLockTrigger: "TP1" | "TP2" | "TP3";
    profitLockAmount: number; // points to lock

    // Trailing Runner
    trailingEnabled: boolean;
    trailingType: TrailingType;
    trailingDistance: number; // fixed distance in points
    trailingAtrMultiplier: number; // for ATR trailing

    // Auto Management
    autoManagement: boolean; // true = execute automatically, false = recommendations only
};

// ============================================
// TRADE MANAGEMENT STATE
// ============================================

export type TradeManagementState = {
    tradeId: string;
    userId: string;
    accountId: string;
    ticket: string;
    symbol: string;
    direction: TradeDirection;
    entry: number;
    currentSl: number;
    currentTp: number;
    volume: number;
    currentPrice: number;

    state: TradeState;
    config: TradeManagementConfig;

    // Calculated fields
    riskAmount: number;
    riskPoints: number;
    currentPnl: number;
    currentR: number;
    lockedProfit: number;
    remainingVolume: number;
    closeHistory: { target: string; volume: number; price: number; timestamp: number }[];

    // Timestamps
    openedAt: number;
    lastUpdated: number;
    lastCheckedAt: number;

    // Safety
    lastExecutionId?: string;
    executionCount: number;

    // Manual override
    manualOverride: boolean;
    overrideReason?: string;
};

// ============================================
// TRADE EVENT
// ============================================

export type TradeEventType =
    | "TRADE_OPENED"
    | "TRADE_MODIFIED"
    | "TP1_APPROACHING"
    | "TP1_HIT"
    | "BREAK_EVEN_RECOMMENDED"
    | "BREAK_EVEN_APPLIED"
    | "TP2_APPROACHING"
    | "TP2_HIT"
    | "PROFIT_LOCK_RECOMMENDED"
    | "PROFIT_LOCK_APPLIED"
    | "TP3_APPROACHING"
    | "TP3_HIT"
    | "RUNNER_ACTIVE"
    | "TRAILING_UPDATED"
    | "TRADE_CLOSED_PROFIT"
    | "TRADE_CLOSED_LOSS"
    | "STOP_LOSS_HIT"
    | "TRADE_CANCELLED"
    | "EXECUTION_FAILED"
    | "POSITION_RECONCILED";

export type TradeEventSeverity = "info" | "success" | "warning" | "error";

export type TradeEvent = {
    eventId: string;
    userId: string;
    accountId: string;
    tradeId: string;
    ticket: string;
    symbol: string;
    direction: TradeDirection;
    type: TradeEventType;
    timestamp: number;
    price: number;
    message: string;
    title: string;
    severity: TradeEventSeverity;
    metadata: {
        entry?: number;
        sl?: number;
        tp?: number;
        volume?: number;
        closePercent?: number;
        lockedProfit?: number;
        rMultiple?: number;
        [key: string]: unknown;
    };
    read: boolean;
    channel: "in_app" | "discord" | "telegram" | "email" | "push";
    executed: boolean;
    executionId?: string;
};

// ============================================
// NOTIFICATION SERVICE TYPES
// ============================================

export type NotificationChannel = "in_app" | "discord" | "telegram" | "email" | "push";

export type NotificationPayload = {
    userId: string;
    event: TradeEventType;
    title: string;
    message: string;
    severity: TradeEventSeverity;
    symbol?: string;
    direction?: TradeDirection;
    link?: string;
    channels: NotificationChannel[];
    metadata?: Record<string, unknown>;
};

export type NotificationResult = {
    channelId: NotificationChannel;
    status: "sent" | "failed" | "skipped";
    error?: string;
};

// ============================================
// APPROACHING ALERT
// ============================================

export type ApproachingAlert = {
    alertId: string;
    userId: string;
    accountId: string;
    ticket: string;
    symbol: string;
    direction: TradeDirection;
    target: "TP1" | "TP2" | "TP3" | "TP4";
    targetPrice: number;
    currentPrice: number;
    distance: number;
    distancePercent: number;
    sentAt: number;
    cooldownExpiresAt: number;
};

// ============================================
// AUDIT LOG
// ============================================

export type AuditAction =
    | "MOVE_SL"
    | "CLOSE_PARTIAL"
    | "CLOSE_POSITION"
    | "MODIFY_TP"
    | "ENABLE_TRAILING"
    | "DISABLE_AUTO"
    | "STATE_TRANSITION"
    | "RECONCILIATION";

export type AuditLogEntry = {
    auditId: string;
    userId: string;
    accountId: string;
    ticket: string;
    action: AuditAction;
    oldSL?: number;
    newSL?: number;
    oldTp?: number;
    newTp?: number;
    volume?: number;
    reason: string;
    mode: "AUTO" | "MANUAL";
    status: "SUCCESS" | "FAILED" | "SKIPPED";
    errorMessage?: string;
    timestamp: number;
    executionId: string;
};

// ============================================
// ADMIN DEFAULTS
// ============================================

export type TradeManagementDefaults = {
    tpManagement: {
        enabled: boolean;
        tp1ClosePercent: number;
        tp2ClosePercent: number;
        tp3ClosePercent: number;
        runnerPercent: number;
    };
    breakEven: {
        enabled: boolean;
        trigger: "TP1" | "TP2" | "TP3";
        offset: number;
    };
    profitLock: {
        enabled: boolean;
        trigger: "TP1" | "TP2" | "TP3";
        lockR: number;
    };
    runner: {
        enabled: boolean;
        trailingType: TrailingType;
        trailingDistance: number;
    };
    approachingAlerts: {
        enabled: boolean;
        distanceThreshold: number; // points
        cooldownMs: number;
    };
};

// ============================================
// RECOMMENDATION
// ============================================

export type Recommendation = {
    id: string;
    type: "break_even" | "profit_lock" | "close_partial" | "trailing" | "approaching" | "momentum";
    priority: "low" | "medium" | "high" | "critical";
    title: string;
    message: string;
    action?: string;
    tradeId: string;
    timestamp: number;
};
