// Account health response types.
//
// Types only — no runtime code — so this module is safe to import from a client
// component. The scorer (`lib/account-health/report.ts`) and the Firebase loader
// (`lib/account-health/load.ts`) both build on these, and the shared UI in
// `components/account-health` consumes them, which is what lets the self-service
// page and the admin console render one identical verdict.
//
// ── These mirror the database, not a guess ─────────────────────────────────────
// Verified against live RTDB on 2026-09-26. The shapes that actually exist:
//
//   trading_accounts/{uid}/{accountId}        e.g. gateway_5054775401
//     balance, equity, freeMargin, margin, marginLevel, currency,
//     positionsCount, status, lastHeartbeatAt, mt5Account
//
//   trading_positions/{uid}/{accountId}/{posId}
//     symbol, type, volume, sl, currentPrice, openPrice, profit
//
//   live_accounts/{accountId}
//     peakEquity, drawdown          <- the only real peak-drawdown record
//
//   aiSignals/{id}                 result: "WIN" | "LOSS" | "pending" | ...
//
// Note there is NO `users/{uid}/balance`, NO `users/{uid}/equity`, NO
// `users/{uid}/maxDrawdown` and NO `trading_accounts/{uid}/default`. Reading
// those returns nothing, which is how an account holding real money can report a
// balance of 0 and a margin call that never happened.

export type RiskLevel = "LOW" | "MODERATE" | "HIGH";
export type HealthStatus = "SAFE" | "WARNING" | "DANGER";
export type ExposureStatus = "LOW" | "MODERATE" | "HIGH";

/** One broker account, as stored under `trading_accounts/{uid}/{accountId}`. */
export interface AccountHealthAccount {
    accountId?: unknown;
    balance?: unknown;
    equity?: unknown;
    freeMargin?: unknown;
    margin?: unknown;
    marginLevel?: unknown;
    currency?: unknown;
    positionsCount?: unknown;
    status?: unknown;
    lastHeartbeatAt?: unknown;
    mt5Account?: unknown;
}

/** One open position, as stored under `trading_positions/{uid}/{accountId}`. */
export interface AccountHealthPosition {
    symbol?: unknown;
    type?: unknown;
    volume?: unknown;
    profit?: unknown;
    currentPrice?: unknown;
    openPrice?: unknown;
    sl?: unknown;
    /** Which broker account this position belongs to. */
    accountId?: unknown;
}

/** One evaluated signal outcome, from the shared `aiSignals` library. */
export interface AccountHealthSignal {
    createdAt?: number;
    /** "WIN" / "LOSS" while resolved; "pending" until the trade closes. */
    result?: string;
    resultR?: number | string;
}

export interface AccountHealthFacts {
    /** The broker accounts this user trades, keyed by `accountId`. */
    accounts: AccountHealthAccount[];
    positions: AccountHealthPosition[];
    /**
     * Peak-to-trough drawdown already recorded by the live-account tracker.
     *
     * This is real recorded history (`live_accounts/{accountId}.drawdown`),
     * worst across the user's accounts. It is 0 when the tracker has no record,
     * which is different from a record of 0% and is not invented here.
     */
    maxDrawdown: number;
    /** Highest equity ever recorded, from the same tracker. */
    peakEquity: number;
    /**
     * Signal outcomes inside the lookback window.
     *
     * Note: `aiSignals` is a platform-wide signal library, not a per-user
     * journal, so these describe the library's hit rate — not this account's own
     * execution. Unresolved signals (`result: "pending"`) are excluded from the
     * ratio, so a library that has not closed anything yet reports no win rate
     * rather than a real-looking 0.0%.
     */
    signals: AccountHealthSignal[];
}

export interface AccountHealthPositionView {
    symbol: string;
    type: string;
    volume: number;
    profit: number;
    /** Cash value at risk between the current price and the stop. */
    risk: number;
    /** True when this position's risk alone exceeds 5% of the balance. */
    atRisk: boolean;
}

/** One broker account's contribution to the rolled-up report. */
export interface AccountHealthAccountView {
    accountId: string;
    currency: string;
    balance: number;
    equity: number;
    margin: number;
    marginLevel: number;
    positions: number;
    status: string;
    lastHeartbeatAt: number;
}

export interface AccountHealthMetrics {
    balance: number;
    equity: number;
    freeMargin: number;
    floatingPnl: number;
    floatingPnlPct: number;
    /** Live drawdown, equity against balance. */
    drawdown: number;
    /** Worst drawdown the live-account tracker has recorded. */
    maxDrawdown: number;
    peakEquity: number;
    /**
     * Broker margin level, or null when no margin is in use.
     *
     * MT5 reports `marginLevel: 0` when `margin` is 0, which means "not
     * leveraged", not "wiped out". Rendering that as a margin call is a false
     * alarm, so it is surfaced as no value — matching `AccountHeader`.
     */
    marginLevel: number | null;
    marginUtilization: number;
    /** Distance in percentage points above the 100% margin-call line. */
    marginCallDistance: number;
    totalPositions: number;
    positionsAtRisk: number;
    openRisk: number;
    /** How many broker accounts are rolled into this report. */
    accounts: number;
}

export interface AccountHealthReport {
    score: number;
    riskLevel: RiskLevel;
    drawdownStatus: HealthStatus;
    marginStatus: HealthStatus;
    exposureStatus: ExposureStatus;
    /**
     * False when the user has no broker account, or an account with no balance,
     * no equity and no positions.
     *
     * Derived from the account's OWN records only. It must never be satisfied by
     * the shared signal library, which every user on the platform has — that
     * would give a user with no trading account a perfect green score.
     */
    hasData: boolean;
    metrics: AccountHealthMetrics;
    trading: {
        /** Signals inside the lookback window, resolved or not. */
        totalSignals: number;
        /** Signals that have actually closed. */
        resolvedSignals: number;
        /** Null when nothing has resolved — there is no rate to report yet. */
        winRate: string | null;
        averageR: string | null;
    };
    breakdown: {
        drawdown: number;
        margin: number;
        exposure: number;
        pnl: number;
        signalQuality: number;
    };
    accounts: AccountHealthAccountView[];
    positions: AccountHealthPositionView[];
}

// ── Admin directory ───────────────────────────────────────────────────────────

/**
 * One row in the admin account directory.
 *
 * Carries only what a list needs. The identity is resolved from the `users`
 * node, so an operator can tell accounts apart by email without being told a
 * uid, and the full report is loaded on demand for the selected account.
 */
export interface AccountHealthDirectoryEntry {
    uid: string;
    email: string | null;
    displayName: string | null;
    score: number;
    riskLevel: RiskLevel;
    drawdownStatus: HealthStatus;
    marginStatus: HealthStatus;
    exposureStatus: ExposureStatus;
    hasData: boolean;
    balance: number;
    equity: number;
    marginLevel: number | null;
    openRisk: number;
    totalPositions: number;
    positionsAtRisk: number;
    accounts: number;
    currency: string;
    /** True when at least one broker account reports itself connected. */
    connected: boolean;
}

export interface AccountHealthDirectory {
    accounts: AccountHealthDirectoryEntry[];
    totals: {
        accounts: number;
        /** Accounts with their own balance, positions or broker account record. */
        active: number;
        highRisk: number;
        moderateRisk: number;
        lowRisk: number;
        /** Every account reported HIGH, so the platform is the problem. */
        allImpaired: boolean;
    };
    /** Share of active accounts in each risk band, for the summary strip. */
    distribution: Record<RiskLevel, number>;
}
