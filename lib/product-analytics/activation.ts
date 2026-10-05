/**
 * Product Analytics — activation engine & user health.
 *
 * IMPORTANT FRAMING: the activation score measures PRODUCT ENGAGEMENT, not
 * trading skill, not profitability, and not probability of success. It answers
 * one question only: "has this person actually done the work that AlgoVault
 * exists to support?" A user who opens a chart and never analyses anything is
 * not activated, regardless of how much money they trade.
 *
 * Activation requires a MEANINGFUL WORKFLOW, not a login:
 *   Terminal usage + AI analysis + a setup/backtest/research action.
 *
 * Pure module: no I/O.
 */

import type { ProductEventType } from "./events";

/** Points each event contributes to the activation score. */
export const ACTIVATION_WEIGHTS: Partial<Record<ProductEventType, number>> = {
    // Observing the market
    CHART_OPENED: 5,
    SYMBOL_SELECTED: 5,
    INDICATOR_ADDED: 5,
    // Analysing it
    MARKET_INTELLIGENCE_VIEWED: 10,
    SMART_MONEY_VIEWED: 10,
    AI_ANALYSIS_STARTED: 10,
    AI_ANALYSIS_COMPLETED: 15,
    // Turning analysis into a plan
    SETUP_CREATED: 20,
    ALERT_CREATED: 10,
    // Validating it
    STRATEGY_CREATED: 20,
    STRATEGY_BACKTESTED: 20,
    RESEARCH_STARTED: 10,
    RESEARCH_COMPLETED: 20,
    ROBUSTNESS_RUN: 20,
    // Running it
    PAPER_TRADE_STARTED: 15,
    TRADE_COMPLETED: 15,
    // Learning from it
    JOURNAL_REVIEWED: 10,
};

/** Maximum achievable score. Used to normalize progress. */
export const MAX_ACTIVATION_SCORE = Object.values(ACTIVATION_WEIGHTS).reduce(
    (a, b) => a + (b ?? 0),
    0
);

/**
 * Score at which a user is considered ACTIVATED. Reaching it requires real
 * work: e.g. chart(5) + AI analysis(15) + setup(20) + backtest(20) = 60.
 */
export const ACTIVATION_THRESHOLD = 60;

/**
 * Score above which a user counts as a power user for health purposes.
 *
 * The score is capped at `MAX_ACTIVATION_SCORE` (220), so 120 is just over
 * half the ceiling. A user who has genuinely worked across market analysis,
 * setups, strategies, research, execution AND journal clears it; a user who
 * has only browsed charts does not come close.
 */
export const POWER_USER_THRESHOLD = 120;

/**
 * Events that represent completing an analysis workflow. Activation needs at
 * least one of these, so a user cannot activate by opening 12 charts.
 */
export const ACTIVATION_GATE_EVENTS: ProductEventType[] = [
    "AI_ANALYSIS_COMPLETED",
    "SETUP_CREATED",
    "STRATEGY_CREATED",
    "STRATEGY_BACKTESTED",
    "RESEARCH_COMPLETED",
    "ROBUSTNESS_RUN",
    "PAPER_TRADE_STARTED",
    "TRADE_COMPLETED",
    "JOURNAL_REVIEWED",
];

export type ActivationSummary = {
    score: number;
    max: number;
    percent: number;
    activated: boolean;
    /** True when the score passed but no real workflow event was recorded. */
    blockedByGate: boolean;
    /** Distinct workflows the user has touched — the clearest "what do they do" signal. */
    workflowsTouched: string[];
    /** The next action that would most improve their product usage. */
    nextBestAction: string;
};

const WORKFLOW_GROUPS: { key: string; events: ProductEventType[] }[] = [
    { key: "market", events: ["CHART_OPENED", "SYMBOL_SELECTED", "TIMEFRAME_SELECTED", "INDICATOR_ADDED"] },
    { key: "intelligence", events: ["MARKET_INTELLIGENCE_VIEWED", "SMART_MONEY_VIEWED", "AI_ANALYSIS_STARTED", "AI_ANALYSIS_COMPLETED"] },
    { key: "setup", events: ["SETUP_CREATED", "ALERT_CREATED"] },
    { key: "strategy", events: ["STRATEGY_CREATED", "STRATEGY_BACKTESTED"] },
    { key: "research", events: ["RESEARCH_STARTED", "RESEARCH_COMPLETED", "ROBUSTNESS_RUN"] },
    { key: "paper-trading", events: ["PAPER_TRADE_STARTED", "TRADE_COMPLETED"] },
    { key: "journal", events: ["JOURNAL_REVIEWED"] },
];

/**
 * Compute the activation summary from a user's distinct event types.
 * `eventTypes` should be de-duplicated by type OR counted — we cap each event
 * type's contribution at 3 occurrences so grinding one action cannot activate
 * a user on its own.
 */
export function computeActivation(eventTypes: ProductEventType[]): ActivationSummary {
    const counts = new Map<ProductEventType, number>();
    for (const type of eventTypes) {
        if (!ACTIVATION_WEIGHTS[type]) continue;
        counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    let score = 0;
    for (const [type, count] of counts) {
        const weight = ACTIVATION_WEIGHTS[type] ?? 0;
        score += weight * Math.min(count, 3);
    }
    score = Math.min(score, MAX_ACTIVATION_SCORE);

    const workflowsTouched = WORKFLOW_GROUPS.filter((group) =>
        group.events.some((e) => counts.has(e))
    ).map((group) => group.key);

    const hasGateEvent = ACTIVATION_GATE_EVENTS.some((e) => counts.has(e));
    const passedScore = score >= ACTIVATION_THRESHOLD;
    const activated = passedScore && hasGateEvent;

    return {
        score,
        max: MAX_ACTIVATION_SCORE,
        percent: MAX_ACTIVATION_SCORE > 0 ? (score / MAX_ACTIVATION_SCORE) * 100 : 0,
        activated,
        blockedByGate: passedScore && !hasGateEvent,
        workflowsTouched,
        nextBestAction: nextBestActionFor(counts),
    };
}

/**
 * The single most useful next step, in the order the product itself teaches:
 * chart → analyse → setup → backtest → research → paper trade → journal.
 */
export function nextBestActionFor(counts: Map<ProductEventType, number>): string {
    const has = (t: ProductEventType) => (counts.get(t) ?? 0) > 0;
    const steps: [ProductEventType, string][] = [
        ["CHART_OPENED", "Open a chart to pick the market you want to analyse"],
        ["AI_ANALYSIS_COMPLETED", "Run an AI market analysis on your chart"],
        ["SETUP_CREATED", "Create a setup from the analysis you just read"],
        ["STRATEGY_BACKTESTED", "Backtest the setup on historical data"],
        ["ROBUSTNESS_RUN", "Run out-of-sample and Monte Carlo on your backtest"],
        ["PAPER_TRADE_STARTED", "Paper trade your validated strategy"],
        ["JOURNAL_REVIEWED", "Review your journal to learn from the results"],
    ];
    for (const [type, label] of steps) {
        if (!has(type)) return label;
    }
    return "Explore the Marketplace for a certified strategy";
}

// ─── User health ────────────────────────────────────────────────────────────

/**
 * Product health states. Built ONLY from product usage frequency and depth.
 * We never infer demographics, income, sophistication, or any sensitive trait.
 */
export const USER_HEALTH_STATES = ["NEW", "ACTIVATING", "ACTIVE", "POWER_USER", "AT_RISK", "DORMANT"] as const;
export type UserHealthState = (typeof USER_HEALTH_STATES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** No meaningful product action for this long → AT_RISK. */
export const AT_RISK_DAYS = 14;
/** No meaningful product action for this long → DORMANT. */
export const DORMANT_DAYS = 45;

export type UserHealthInput = {
    /** Timestamp of the user's most recent MEANINGFUL product event. */
    lastActiveAt: number | null;
    /** Timestamp of signup. */
    createdAt: number;
    activation: ActivationSummary;
    /** Distinct product events in the last 7 days. */
    eventsLast7d: number;
    /** Distinct active days in the last 30. */
    activeDaysLast30d: number;
    now?: number;
};

export type UserHealth = {
    state: UserHealthState;
    daysSinceActive: number | null;
    activated: boolean;
    reason: string;
};

/**
 * Classify a user's product health. Order matters: dormancy wins over activity
 * (someone active 10 days ago who was a power user is AT_RISK, not POWER_USER).
 */
export function computeUserHealth(input: UserHealthInput): UserHealth {
    const now = input.now ?? Date.now();
    const last = input.lastActiveAt;
    const daysSinceActive = last ? Math.floor((now - last) / DAY_MS) : null;
    const { activation, eventsLast7d, activeDaysLast30d } = input;

    if (daysSinceActive !== null && daysSinceActive >= DORMANT_DAYS) {
        return {
            state: "DORMANT",
            daysSinceActive,
            activated: activation.activated,
            reason: `No product activity for ${daysSinceActive} days`,
        };
    }
    if (daysSinceActive !== null && daysSinceActive >= AT_RISK_DAYS) {
        return {
            state: "AT_RISK",
            daysSinceActive,
            activated: activation.activated,
            reason: `No product activity for ${daysSinceActive} days`,
        };
    }
    if (activation.activated && activation.score >= POWER_USER_THRESHOLD) {
        return {
            state: "POWER_USER",
            daysSinceActive,
            activated: true,
            reason: "Actively using multiple advanced workflows",
        };
    }
    if (activation.activated && eventsLast7d >= 3) {
        return {
            state: "ACTIVE",
            daysSinceActive,
            activated: true,
            reason: "Activated and active this week",
        };
    }
    if (activation.activated) {
        return {
            state: "ACTIVE",
            daysSinceActive,
            activated: true,
            reason: "Activated user",
        };
    }
    if (activation.score > 0 || activeDaysLast30d > 0) {
        return {
            state: "ACTIVATING",
            daysSinceActive,
            activated: false,
            reason: activation.blockedByGate
                ? "Has explored the product but has not completed a workflow yet"
                : "Building a complete trading workflow",
        };
    }
    return {
        state: "NEW",
        daysSinceActive,
        activated: false,
        reason: "Has not performed a product action yet",
    };
}
