// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — domain model.
//
// Strongly typed models for the simulated challenge ecosystem. Every monetary
// value is an INTEGER COUNT OF CENTS and every price is INTEGER PRICE MICROS
// (see ./money.ts). Nothing in this module touches Firebase or React — the
// whole domain is pure and unit-testable.
//
// Product boundaries (constitution):
//   • Virtual / simulated capital only — never represented as real capital.
//   • Platform rewards only in production. CASH rewards exist as a TYPE and
//     as adapter interfaces for the future, but are disabled server-side
//     behind CASH_REWARDS_ENABLED=false (see ./flags.ts and ./payout.ts).
//   • No profit promises, no guarantees — disclaimers travel with the data.
// ─────────────────────────────────────────────────────────────────────────────

// ──────────── Lifecycle ───────────────────────────────────────────────────────

/**
 * Canonical lifecycle states shared by challenge definitions and challenge
 * attempts. Transitions are validated by ./state-machine.ts — invalid
 * transitions throw and are never persisted.
 */
export type ChallengeStatus =
    | "DRAFT"
    | "AVAILABLE"
    | "ACTIVE"
    | "PAUSED"
    | "PASSED"
    | "FAILED"
    | "EXPIRED"
    | "CANCELLED"
    | "ARCHIVED";

export type DefinitionStatus = Extract<ChallengeStatus, "DRAFT" | "AVAILABLE" | "ARCHIVED">;
export type AttemptStatus = Extract<
    ChallengeStatus,
    "ACTIVE" | "PAUSED" | "PASSED" | "FAILED" | "EXPIRED" | "CANCELLED" | "ARCHIVED"
>;

export type SettledStatus = Extract<AttemptStatus, "PASSED" | "FAILED" | "EXPIRED" | "CANCELLED">;

export const TERMINAL_ATTEMPT_STATUSES: readonly AttemptStatus[] = ["PASSED", "FAILED", "EXPIRED", "CANCELLED"];

export function isTerminalStatus(status: ChallengeStatus): boolean {
    return status === "PASSED" || status === "FAILED" || status === "EXPIRED" || status === "CANCELLED";
}

// ──────────── Markets, sessions, tiers ───────────────────────────────────────

export type MarketCategory = "forex" | "metals" | "indices" | "crypto" | "equities";
export type TradingSessionName = "asian" | "london" | "new_york" | "overlap";
export type ChallengeTier = "starter" | "standard" | "pro" | "elite" | "custom";

// ──────────── Challenge policy (fully configurable rules) ────────────────────

export interface ChallengePolicy {
    /** Virtual starting balance in integer cents. Never real money. */
    startingBalanceCents: number;

    /** Profit target as a percentage of the starting balance. */
    profitTargetPct: number;

    /** Maximum drawdown as a percentage of the starting balance. */
    maxDrawdownPct: number;
    /**
     * static   → drawdown measured against the starting balance.
     * trailing → drawdown measured against the running equity peak.
     */
    maxDrawdownMode: "static" | "trailing";

    /** Daily loss limit as a percentage (see dailyLossBase). */
    dailyLossLimitPct: number;
    /** starting_balance → % of virtual capital; day_start_equity → % of day-open equity. */
    dailyLossBase: "starting_balance" | "day_start_equity";

    /** Minimum distinct trading days required to pass. */
    minTradingDays: number;
    /** Maximum distinct trading days allowed (further entries blocked after). */
    maxTradingDays: number;
    /** Wall-clock duration of the challenge in calendar days (expiry). */
    maxCalendarDays: number;

    allowedMarkets: MarketCategory[];
    /** Explicit symbol allow-list, or "all" (intersected with allowedMarkets). */
    allowedSymbols: string[] | "all";
    allowedSessions: TradingSessionName[] | "all";
    /** Optional UTC hour window [startHour, endHour) — "all" disables it. */
    tradingHours: { startUtcHour: number; endUtcHour: number } | "all";
    weekendTrading: "allowed" | "blocked";
    newsTrading: "allowed" | "blocked";

    /** Max notional exposure as a multiple of equity (leverage guard). */
    leveragePolicy: { maxLeverageRatio: number };
    maxConcurrentPositions: number;
    maxDailyTrades: number;
    /** Max planned risk (stop distance + costs) per trade, % of equity. */
    maxRiskPerTradePct: number;
    /** Max notional per position as a % of equity. */
    maxPositionPctOfEquity: number;
    positionSizePolicy: { maxSizeLots: number; stepLots: number };

    consistency: {
        /** When true, failing consistency blocks a PASS at settlement. */
        required: boolean;
        /** Max share of total profit that a single day may contribute (%). */
        maxSingleDayPnlSharePct: number;
        minTradesForConsistency: number;
    };

    /** Optional strategy-category allow-list (informational + research compat). */
    strategyRestrictions: { allowedCategories: string[] } | null;

    /** Execution cost model applied to every simulated fill. */
    costModel: {
        commissionPerLotCents: number;
        slippagePips: number;
        useTypicalSpread: boolean;
    };

    /** Emit RULE_WARNING once this share of a limit is used (default 80%). */
    warningUtilizationPct: number;

    dailyLossBreachAction: "fail" | "pause";
    /** Settle PASSED automatically when target + min days reached and flat. */
    autoSettleOnTarget: boolean;
}

// ──────────── Challenge definition (catalog entry) ───────────────────────────

export type ChallengeAccessModel = "free" | "pro" | "paid" | "credits";

export interface ChallengeAccess {
    model: ChallengeAccessModel;
    /** Price in cents when model === "paid" (paid model gated by feature flag). */
    priceCents?: number;
    currency?: string;
    /** AV Points price when model === "credits". */
    pricePoints?: number;
}

export interface ChallengeDefinition {
    id: string;
    key: string;
    name: string;
    tier: ChallengeTier;
    summary: string;
    policy: ChallengePolicy;
    access: ChallengeAccess;
    rewardPolicyId: string;
    status: DefinitionStatus;
    enabled: boolean;
    version: number;
    createdAt: number;
    updatedAt: number;
    createdBy: string | null;
    /** Set only by the authenticated admin product workflow after fee configuration. */
    paidBillingConfiguredAt?: number;
}

// ──────────── Attempt + virtual account ──────────────────────────────────────

export interface ChallengeAttempt {
    id: string;
    userId: string;
    definitionId: string;
    definitionKey: string;
    /** Immutable policy snapshot taken at join time — rules never drift mid-run. */
    policy: ChallengePolicy;
    rewardPolicyId: string;
    status: AttemptStatus;
    createdAt: number;
    updatedAt: number;
    startedAt: number;
    /** Wall-clock expiry (startedAt + maxCalendarDays). */
    expiresAt: number;
    settledAt: number | null;
    result: ChallengeResult | null;
    /** dayKey → timestamp of the first trade that day (trading-day accounting). */
    tradingDayKeys: Record<string, number>;
    /** dayKey → number of entries that day (daily trade cap). */
    dailyTradeCounts: Record<string, number>;
    /** Internal idempotency markers for committed pending-order fills. */
    processedPendingOrderIds?: Record<string, boolean>;
    cancelReason?: string;
    pausedAt?: number;
    /** Set when the engine refused to settle because data was inconsistent. */
    settleBlockedReason?: string;
}

export interface VirtualAccount {
    accountId: string;
    attemptId: string;
    userId: string;
    startingBalanceCents: number;
    /** Realized balance (starting + realized PnL − fees already netted). */
    balanceCents: number;
    /** Marked equity (balance + unrealized) — recomputed server-side only. */
    equityCents: number;
    peakEquityCents: number;
    realizedPnLCents: number;
    unrealizedPnLCents: number;
    feesCents: number;
    /** Day-start equity for the current UTC day (daily loss base). */
    dayStartEquityCents: number;
    dayKey: string;
    dailyPnLCcents: number;
    /** Aggregate notional exposure of open positions (cents). */
    exposureCents: number;
    /** Internal idempotency markers for pending-order account postings. */
    processedPendingOrderIds?: Record<string, boolean>;
    lastQuoteAt: number;
    createdAt: number;
    updatedAt: number;
}

// ──────────── Simulated trades ───────────────────────────────────────────────

export type TradeStatus = "open" | "closed";
export type TradeExitReason = "manual" | "stop_loss" | "take_profit" | "challenge_end" | "breach_close";

export interface TradeFillCosts {
    /** Round-trip spread cost charged at entry (half on each leg, combined). */
    spreadCostCents: number;
    slippageCostCents: number;
    commissionCents: number;
}

export interface ChallengeTrade {
    tradeId: string;
    attemptId: string;
    userId: string;
    symbol: string;
    market: MarketCategory;
    side: "long" | "short";
    /** Integer centi-lots (lots × 100). */
    sizeCentiLots: number;
    entryPriceMicros: number;
    entryAt: number;
    entryQuoteAt: number;
    costs: TradeFillCosts;
    stopLossMicros: number | null;
    takeProfitMicros: number | null;
    /** Planned risk (stop distance + costs) in cents — null when no stop. */
    riskCents: number | null;
    status: TradeStatus;
    closedAt: number | null;
    exitPriceMicros: number | null;
    exitQuoteAt: number | null;
    exitReason: TradeExitReason | null;
    /** Net realized PnL (gross − costs) after close. */
    realizedPnLCents: number | null;
    /** Client-supplied idempotency key for entry. */
    clientRequestId: string | null;
    updatedAt?: number;
}

export type ArenaPendingOrderType = "limit" | "stop";
export type PendingOrderStatus = "pending" | "processing" | "filled" | "cancelled" | "expired";

export interface ChallengePendingOrder {
    orderId: string;
    attemptId: string;
    userId: string;
    symbol: string;
    market: MarketCategory;
    side: "long" | "short";
    orderType: ArenaPendingOrderType;
    sizeCentiLots: number;
    entryPriceMicros: number;
    stopLossMicros: number | null;
    takeProfitMicros: number | null;
    createdAt: number;
    expiresAt: number;
    status: PendingOrderStatus;
    clientRequestId: string | null;
    filledTradeId: string | null;
    processingAt?: number;
    /** Deterministic fill record persisted before posting accounting effects. */
    filledTrade?: ChallengeTrade;
}

/** Server-computed live mark for an open position (not persisted verbatim). */
export interface MarkedTrade {
    trade: ChallengeTrade;
    markPriceMicros: number | null;
    unrealizedPnLCents: number;
    quoteAt: number | null;
    stale: boolean;
}

// ──────────── Rule engine events ─────────────────────────────────────────────

export type RuleId =
    | "PROFIT_TARGET"
    | "DAILY_LOSS"
    | "MAX_DRAWDOWN"
    | "MIN_TRADING_DAYS"
    | "MAX_TRADING_DAYS"
    | "TRADING_HOURS"
    | "WEEKEND_TRADING"
    | "SESSION_ALLOWED"
    | "SYMBOL_ALLOWED"
    | "MARKET_ALLOWED"
    | "POSITION_SIZE"
    | "RISK_PER_TRADE"
    | "MAX_POSITIONS"
    | "MAX_DAILY_TRADES"
    | "LEVERAGE"
    | "CONSISTENCY"
    | "CHALLENGE_EXPIRY"
    | "NEWS_TRADING";

export type RuleEventType =
    | "RULE_WARNING"
    | "RULE_BREACH"
    | "DAILY_LOSS_WARNING"
    | "DAILY_LOSS_BREACH"
    | "DRAWDOWN_WARNING"
    | "DRAWDOWN_BREACH"
    | "PROFIT_TARGET_REACHED"
    | "MIN_TRADING_DAYS_REACHED"
    | "CONSISTENCY_WARNING"
    | "TRADING_HOURS_VIOLATION"
    | "POSITION_SIZE_VIOLATION"
    | "MAX_POSITIONS_VIOLATION"
    | "RULE_BLOCKED";

export type RuleSeverity = "INFO" | "WARNING" | "BREACH";

export interface RuleEvent {
    eventId: string;
    attemptId: string;
    ruleId: RuleId;
    type: RuleEventType;
    severity: RuleSeverity;
    /** Current measured value (unit-matched with threshold). */
    currentValue: number;
    threshold: number;
    /** How much of the allowance is used, 0–100+ (can exceed 100 on breach). */
    percentageUsed: number;
    unit: "pct" | "cents" | "count" | "hours";
    message: string;
    timestamp: number;
    /** Blocking events reject new orders; breaches may settle the attempt. */
    blocking: boolean;
}

// ──────────── Challenge events (immutable audit log) ─────────────────────────

export type ChallengeEventType =
    | "STATUS_CHANGE"
    | "RULE_WARNING"
    | "RULE_BREACH"
    | "ORDER_REJECTED"
    | "TRADE_OPENED"
    | "TRADE_CLOSED"
    | "POSITION_MODIFIED"
    | "PENDING_ORDER_PLACED"
    | "PENDING_ORDER_CANCELLED"
    | "EQUITY_MARK"
    | "SETTLEMENT"
    | "REWARD_GRANTED"
    | "GUARDIAN_AI"
    | "FRAUD_FLAG";

export interface ChallengeEvent {
    eventId: string;
    attemptId: string;
    type: ChallengeEventType;
    severity: "info" | "warning" | "critical";
    message: string;
    payload?: Record<string, unknown>;
    timestamp: number;
}

// ──────────── Metrics snapshot ───────────────────────────────────────────────

export interface EquityPoint {
    t: number;
    equityCents: number;
}

export interface ChallengeMetrics {
    attemptId: string;
    asOf: number;
    /** fresh → quotes usable for breach evaluation; stale → warnings only. */
    dataQuality: "fresh" | "stale";
    startingBalanceCents: number;
    balanceCents: number;
    equityCents: number;
    unrealizedPnLCents: number;
    realizedPnLCents: number;
    totalPnLCents: number;
    totalReturnPct: number;
    peakEquityCents: number;
    currentDrawdownPct: number;
    drawdownUsedPct: number;
    drawdownAllowanceCents: number;
    dailyPnLCcents: number;
    dailyLossUsedPct: number;
    dailyLossLimitCents: number;
    remainingDailyLossCents: number;
    targetCents: number;
    targetProgressPct: number;
    distanceToTargetPct: number;
    tradingDays: number;
    minTradingDays: number;
    maxTradingDays: number;
    dailyTrades: number;
    maxDailyTrades: number;
    openPositions: number;
    openExposureCents: number;
    maxLeverageRatio: number;
    leverageUsedPct: number;
    timeRemainingMs: number;
    expired: boolean;
    equityCurve: EquityPoint[];
    updatedAt: number;
}

// ──────────── Result & report ────────────────────────────────────────────────

export interface ChallengeResult {
    attemptId: string;
    status: SettledStatus;
    reasonCode: string;
    reason: string;
    startingBalanceCents: number;
    endingEquityCents: number;
    totalPnLCents: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    worstDailyLossPct: number;
    tradingDays: number;
    minTradingDays: number;
    tradeCount: number;
    winCount: number;
    lossCount: number;
    winRatePct: number;
    avgTradeCents: number;
    bestTradeCents: number;
    worstTradeCents: number;
    totalFeesCents: number;
    consistencyPassed: boolean;
    ruleBreachCount: number;
    settledAt: number;
}

export interface PerformanceReport extends ChallengeResult {
    definitionKey: string;
    definitionName: string;
    tier: ChallengeTier;
    startedAt: number;
    endedAt: number;
    markets: MarketCategory[];
    symbolsTraded: string[];
    strategyCategories: string[];
    aiRunsUsed: number;
    guardianInsightsDelivered: number;
    dailyPnl: Array<{ dayKey: string; pnlCents: number }>;
    /** Human-readable deterministic explanation of the final status. */
    explanation: string[];
    disclaimers: string[];
}

// ──────────── Rewards ────────────────────────────────────────────────────────

export type RewardType =
    | "PLATFORM_POINTS"
    | "PRO_DAYS"
    | "AI_CREDITS"
    | "RESEARCH_CREDITS"
    | "BACKTEST_CREDITS"
    | "FEATURE_UNLOCK"
    | "BADGE"
    | "COMPETITION_ACCESS"
    /** Future only — rejected server-side while CASH_REWARDS_ENABLED=false. */
    | "CASH";

export type RewardStatus = "PENDING" | "APPROVED" | "GRANTED" | "REVOKED" | "EXPIRED";

export type RewardSourceType =
    | "CHALLENGE_RESULT"
    | "CONSISTENCY"
    | "EDUCATION"
    | "COMPETITION"
    | "REFERRAL"
    | "RESEARCH_MILESTONE"
    | "POINTS_SPEND"
    | "ADMIN_ADJUSTMENT";

export type RewardTrigger =
    | "CHALLENGE_PASSED"
    | "CHALLENGE_COMPLETED"
    | "CHALLENGE_FAILED"
    | "CONSISTENCY_ACHIEVED"
    | "FIRST_CHALLENGE"
    | "POINTS_SPEND";

export interface RewardGrantSpec {
    when: RewardTrigger;
    type: RewardType;
    amount: number;
    unit?: string;
    badgeId?: string;
    featureKey?: string;
    label?: string;
}

export interface RewardPolicy {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    version: number;
    grants: RewardGrantSpec[];
    createdAt: number;
    updatedAt: number;
}

export interface RewardLedgerEntry {
    rewardId: string;
    userId: string;
    sourceType: RewardSourceType;
    sourceId: string;
    rewardType: RewardType;
    amount: number;
    unit: string;
    policyId: string;
    status: RewardStatus;
    createdAt: number;
    grantedAt: number | null;
    revokedAt: number | null;
    metadata?: Record<string, string | number | boolean | null>;
}

/** Spendable non-cash balances credited to a user by the arena. */
export interface CreditWallet {
    userId: string;
    avPoints: number;
    aiCredits: number;
    researchCredits: number;
    backtestCredits: number;
    /** Pro days earned but not yet applicable (no active Pro subscription). */
    proDays: number;
    badges: string[];
    features: string[];
    competitions: string[];
    updatedAt: number;
}

// ──────────── Eligibility / jurisdiction (future cash layer) ─────────────────

export type EligibilityStatus = "AVAILABLE" | "UNAVAILABLE" | "REQUIRES_VERIFICATION" | "DISABLED";

export interface RewardEligibility {
    country: string | null;
    region: string | null;
    program: string;
    rewardType: RewardType;
    eligibilityStatus: EligibilityStatus;
    reason: string;
    requiredVerification: string[];
    policyVersion: string;
}

// ──────────── Future cash-reward adapters (architecture only) ────────────────

export type KYCStatus = "not_submitted" | "pending" | "verified" | "rejected";
export type TaxStatus = "not_collected" | "pending" | "cleared" | "action_required";
export type FraudReviewStatus = "not_required" | "pending" | "cleared" | "flagged";
export type PayoutApprovalStatus = "pending" | "approved" | "denied";

export interface PayoutAccount {
    accountId: string;
    userId: string;
    providerId: string;
    /** Opaque provider reference — no sensitive data is stored by AlgoVault. */
    providerReference: string;
    createdAt: number;
}

export interface PayoutRequest {
    requestId: string;
    userId: string;
    attemptId: string;
    amountCents: number;
    currency: string;
    status: "rejected" | "pending_review" | "approved" | "paid" | "failed";
    rejectionReason?: string;
    createdAt: number;
    updatedAt: number;
}

export interface JurisdictionEligibility {
    country: string | null;
    eligible: boolean;
    reason: string;
    policyVersion: string;
}

export interface PayoutEligibility {
    userId: string;
    program: string;
    jurisdiction: JurisdictionEligibility;
    kyc: KYCStatus;
    tax: TaxStatus;
    fraudReview: FraudReviewStatus;
    approval: PayoutApprovalStatus;
    eligible: boolean;
    blockers: string[];
}

export interface PayoutProviderResult {
    ok: boolean;
    providerId: string;
    reference?: string;
    error?: string;
}

/** Future adapter seam — NO provider is registered in production. */
export interface PayoutProvider {
    id: string;
    name: string;
    requestPayout(request: PayoutRequest, account: PayoutAccount): Promise<PayoutProviderResult>;
}

// ──────────── Leaderboard ────────────────────────────────────────────────────

export type LeaderboardVisibility = "PUBLIC" | "COMMUNITY" | "PRIVATE";

export interface LeaderboardEntry {
    attemptId: string;
    /** Privacy-conscious display identity (never an email or uid in full). */
    displayLabel: string;
    tier: ChallengeTier;
    status: AttemptStatus;
    totalReturnPct: number;
    maxDrawdownPct: number;
    tradingDays: number;
    tradeCount: number;
    consistencyScore: number;
    riskDisciplineScore: number;
    profitableDayRatio: number;
    completionScore: number;
    /** Composite score — NOT raw profit (see ./leaderboard.ts). */
    score: number;
}

export interface LeaderboardPolicy {
    weights: {
        return: number;
        drawdown: number;
        consistency: number;
        riskDiscipline: number;
        completion: number;
    };
    minTrades: number;
    includeStatuses: AttemptStatus[];
}

export interface LeaderboardSnapshot {
    snapshotId: string;
    periodKey: string;
    visibility: LeaderboardVisibility;
    generatedAt: number;
    entries: LeaderboardEntry[];
    policy: LeaderboardPolicy;
    disclaimer: string;
}

// ──────────── Fraud / abuse flags (kept separate from performance data) ──────

export type FraudFlagType =
    | "DUPLICATE_ACTIVE_CHALLENGE"
    | "REPEATED_ACCOUNT_SIGNAL"
    | "REWARD_DUPLICATION"
    | "SUSPICIOUS_TRADING_PATTERN"
    | "IMPOSSIBLE_EXECUTION"
    | "EXCESSIVE_API_ACTIVITY"
    | "REWARD_FARMING"
    | "REFERRAL_ABUSE"
    | "CHALLENGE_RESET_ABUSE";

export interface FraudFlag {
    flagId: string;
    userId: string;
    attemptId: string | null;
    type: FraudFlagType;
    severity: "low" | "medium" | "high";
    /** Privacy-conscious detail — technical metadata only, no invasive data. */
    detail: string;
    metadata: Record<string, string | number | boolean | null>;
    status: "OPEN" | "REVIEWED" | "DISMISSED";
    createdAt: number;
    resolvedAt: number | null;
}

// ──────────── Trader performance profile ─────────────────────────────────────

export interface AttemptSummary {
    attemptId: string;
    definitionKey: string;
    tier: ChallengeTier;
    status: AttemptStatus;
    totalReturnPct: number;
    maxDrawdownPct: number;
    tradingDays: number;
    tradeCount: number;
    startedAt: number;
    endedAt: number | null;
}

export interface TraderPerformanceProfile {
    userId: string;
    displayLabel: string;
    visibility: LeaderboardVisibility;
    attempted: number;
    completed: number;
    passed: number;
    failed: number;
    expired: number;
    cancelled: number;
    bestReturnPct: number;
    avgReturnPct: number;
    avgDrawdownPct: number;
    consistencyScore: number;
    profitableDayRatio: number;
    totalTrades: number;
    markets: MarketCategory[];
    tradingStyles: string[];
    badges: string[];
    avPoints: number;
    history: AttemptSummary[];
    updatedAt: number;
    disclaimer: string;
}

// ──────────── Risk Guardian ──────────────────────────────────────────────────

export type GuardianInsightKind = "FACT" | "INTERPRETATION" | "RISK_WARNING" | "GUIDANCE";

export interface GuardianInsight {
    id: string;
    kind: GuardianInsightKind;
    severity: "info" | "warning" | "critical";
    message: string;
    utilizationPct: number | null;
    createdAt: number;
}

/** Structured AI output — the five buckets are mandatory in the prompt. */
export interface GuardianAIAnalysis {
    facts: string[];
    interpretations: string[];
    riskWarnings: string[];
    uncertainty: string[];
    limitations: string[];
    provider: string;
    model: string;
    generatedAt: number;
    creditsCharged: number;
}

// ──────────── Product analytics (aggregate, non-identifying) ─────────────────

export interface ArenaDailyAnalytics {
    dayKey: string;
    challengeStarts: number;
    challengeCompletions: number;
    passes: number;
    failures: number;
    expiries: number;
    cancellations: number;
    rewardsGranted: number;
    pointsIssued: number;
    aiGuardianRuns: number;
    paidChallengeStarts: number;
    proChallengeStarts: number;
    updatedAt: number;
}

// ──────────── Canonical product disclaimers ─────────────────────────────────

export const ARENA_DISCLAIMERS = {
    simulated: "Simulated trading only. All challenge capital is virtual and has no cash value.",
    noGuarantees: "Past simulated performance does not guarantee future results. Nothing here promises profit.",
    aiInformational: "AI-generated analysis is informational, may be wrong, and is not investment advice.",
    challengeScope:
        "Challenge results do not guarantee real-world trading success, employment, investment capital, or monetary income.",
    rewards: "Rewards are AlgoVault platform rewards (points, credits, badges, Pro days). They are not cash, not withdrawable, and carry no monetary value.",
    leaderboard: "Leaderboard position reflects past simulated performance only and does not predict future trading success.",
} as const;
