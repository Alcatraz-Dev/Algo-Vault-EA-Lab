/**
 * Product Analytics — retention, churn detection & re-engagement.
 *
 * Retention here is PRODUCT retention: did the user do something meaningful,
 * not did they log in. An "active day" is a day with at least one meaningful
 * product event (analysis, setup, backtest, research, trade, journal).
 *
 * Re-engagement rules are deliberately conservative: a user is only nudged
 * once per reason, per cooldown, and the copy never uses urgency or pressure.
 *
 * Pure module: no I/O.
 */

import type { ProductEventType, ValueMoment } from "./events";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Events that count as "meaningful activity" for retention purposes.
 * Deliberately excludes passive views like `PRODUCT_VIEWED` so that retention
 * reflects work, not browsing.
 */
export const MEANINGFUL_EVENTS: ProductEventType[] = [
    "AI_ANALYSIS_COMPLETED",
    "MARKET_INTELLIGENCE_VIEWED",
    "SMART_MONEY_VIEWED",
    "SETUP_CREATED",
    "ALERT_CREATED",
    "STRATEGY_CREATED",
    "STRATEGY_BACKTESTED",
    "RESEARCH_STARTED",
    "RESEARCH_COMPLETED",
    "ROBUSTNESS_RUN",
    "PAPER_TRADE_STARTED",
    "TRADE_COMPLETED",
    "JOURNAL_REVIEWED",
];

const MEANINGFUL_SET = new Set<string>(MEANINGFUL_EVENTS);

export function isMeaningfulEvent(type: string): boolean {
    return MEANINGFUL_SET.has(type);
}

export function dayIndex(ts: number): number {
    return Math.floor(ts / DAY_MS);
}

export type CohortActivity = {
    /** `YYYY-MM-DD` of the cohort anchor (typically signup date). */
    cohortDay: string;
    /** Per-day distinct-user counts, keyed `YYYY-MM-DD` from the cohort anchor. */
    activeByDay: Record<string, number>;
};

/**
 * Day 1 / 7 / 30 retention for a cohort. Returns null when the cohort has not
 * yet reached that day — reporting a 0% day-30 retention on a 3-day-old cohort
 * would be a lie.
 */
export type CohortRetention = {
    cohortSize: number;
    d1: number | null;
    d7: number | null;
    d30: number | null;
    /** True when day 7/30 are not yet observable. */
    incomplete: boolean;
};

export function computeCohortRetention(input: {
    cohortSize: number;
    /** Oldest activity timestamp in the cohort, to know how far we can observe. */
    lastActivityAt: number;
    cohortStartAt: number;
    activeByDay: Record<string, number>;
    now?: number;
}): CohortRetention {
    const now = input.now ?? Date.now();
    const size = input.cohortSize;
    const observableDays = Math.floor((now - input.cohortStartAt) / DAY_MS);
    const at = (offset: number) => {
        const key = new Date(input.cohortStartAt + offset * DAY_MS).toISOString().slice(0, 10);
        return input.activeByDay[key] ?? 0;
    };
    const pct = (offset: number) =>
        observableDays >= offset && size > 0 ? (at(offset) / size) * 100 : null;

    const d7 = pct(7);
    const d30 = pct(30);
    return {
        cohortSize: size,
        d1: pct(1),
        d7,
        d30,
        incomplete: d7 === null || d30 === null,
    };
}

// ─── Feature adoption by week ───────────────────────────────────────────────

export type FeatureAdoption = {
    feature: string;
    /** % of the cohort that used the feature in week 1. */
    week1Pct: number | null;
    week2Pct: number | null;
    /** Change in percentage points between week 1 and week 2. */
    deltaPctPoints: number | null;
    insufficient: boolean;
};

/**
 * Week-1 vs week-2 feature adoption. This is the "which workflows do users
 * actually stick with" signal that drives product investment.
 */
export function computeFeatureAdoption(input: {
    feature: string;
    cohortSize: number;
    week1Users: number;
    week2Users: number;
    week2Observable?: boolean;
    minCohort?: number;
}): FeatureAdoption {
    const min = input.minCohort ?? 20;
    const size = input.cohortSize;
    const week1Pct = size > 0 && observable(size, input.week1Users, min) ? (input.week1Users / size) * 100 : null;
    const week2Pct =
        size > 0 && input.week2Observable !== false && observable(size, input.week2Users, min)
            ? (input.week2Users / size) * 100
            : null;
    return {
        feature: input.feature,
        week1Pct,
        week2Pct,
        deltaPctPoints: week1Pct !== null && week2Pct !== null ? week2Pct - week1Pct : null,
        insufficient: size < min,
    };
}

function observable(size: number, users: number, min: number): boolean {
    return size >= min && users >= 0;
}

// ─── WAU / MAU stickiness ───────────────────────────────────────────────────

export type Stickiness = {
    wau: number;
    mau: number;
    /** WAU/MAU as a percentage. null when MAU is 0. */
    ratioPct: number | null;
};

/**
 * Weekly actives over monthly actives. A ratio of ~50% is generally healthy.
 * Below ~20% suggests users try the product and leave.
 */
export function computeStickiness(wau: number, mau: number): Stickiness {
    return {
        wau,
        mau,
        ratioPct: mau > 0 ? (wau / mau) * 100 : null,
    };
}

// ─── Churn detection ────────────────────────────────────────────────────────

export type ChurnSignal = {
    userId: string;
    reason: "INACTIVE" | "PARTIAL_DECAY" | "PRO_DECAY";
    /** Days since the user's last meaningful product action. */
    daysInactive: number;
    /** Workflows the user used before going quiet — drives the copy. */
    previousWorkflows: string[];
    /** The single re-engagement reason to use, or null if we should stay quiet. */
    suggestion: ReEngagementSuggestion | null;
};

export type ReEngagementSuggestion = {
    id: string;
    /** Deduplication key so a user is never nudged twice for the same reason. */
    dedupKey: string;
    title: string;
    body: string;
    /** Route the CTA points at. */
    href: string;
    cta: string;
};

const CHURN_DAYS = 14;
const PARTIAL_DECAY_DAYS = 21;
const PRO_DECAY_DAYS = 30;
/** Minimum previous activity before we bother a user at all. */
const MIN_HISTORY_EVENTS = 3;

const WORKFLOW_EVENTS: { key: string; events: ProductEventType[]; href: string; cta: string; label: string }[] = [
    {
        key: "research",
        events: ["RESEARCH_COMPLETED", "ROBUSTNESS_RUN", "RESEARCH_STARTED"],
        href: "/strategy-research",
        cta: "View Research",
        label: "research",
    },
    {
        key: "strategy",
        events: ["STRATEGY_BACKTESTED", "STRATEGY_CREATED"],
        href: "/strategy-lab",
        cta: "Review Strategy",
        label: "strategy backtests",
    },    {
        key: "journal",
        events: ["JOURNAL_REVIEWED"],
        href: "/trade-journal",
        cta: "Review Journal",
        label: "journal reviews",
    },
    {
        key: "trading",
        events: ["TRADE_COMPLETED", "PAPER_TRADE_STARTED"],
        href: "/account/trading",
        cta: "Review Performance",
        label: "paper trades",
    },
    {
        key: "intelligence",
        events: ["AI_ANALYSIS_COMPLETED", "SMART_MONEY_VIEWED", "MARKET_INTELLIGENCE_VIEWED"],
        href: "/market-intelligence",
        cta: "Open Intelligence",
        label: "market analysis",
    },
];

/**
 * Re-engagement copy per value moment.
 *
 * `label` is a complete noun phrase and `plural` tells the title template which
 * verb to use, so we never emit "Your setups is ready to review" or
 * "Your your saved strategy". Both were real bugs caught in review.
 */
export const VALUE_MOMENT_COPY: Record<
    ValueMoment,
    { href: string; cta: string; label: string; plural: boolean }
> = {
    RESEARCH: { href: "/strategy-research", cta: "View Research", label: "your saved strategy research", plural: false },
    STRATEGY_DISCOVERY: { href: "/strategy-lab", cta: "Review Strategy", label: "your strategies", plural: true },
    MARKET_INTELLIGENCE: { href: "/market-intelligence", cta: "Open Intelligence", label: "your market analysis", plural: false },
    SETUP_INTELLIGENCE: { href: "/market-intelligence/smart-money", cta: "Open Setups", label: "your setups", plural: true },
    PAPER_TRADING: { href: "/account/trading", cta: "Review Performance", label: "your paper trades", plural: true },
    JOURNAL: { href: "/trade-journal", cta: "Review Journal", label: "your journal", plural: false },
};

/**
 * Detect a churn signal for one user. Returns `suggestion: null` when we should
 * NOT reach out — either the user is active, or they never did enough for a
 * reminder to be useful. We never manufacture urgency.
 */
export function detectChurn(input: {
    userId: string;
    lastMeaningfulAt: number | null;
    createdAt: number;
    /** All meaningful event types this user has ever performed. */
    history: ProductEventType[];
    /** Events already sent re-engagement for, by dedupKey. */
    alreadyNudged?: string[];
    isPro?: boolean;
    now?: number;
}): ChurnSignal {
    const now = input.now ?? Date.now();
    const history = input.history.filter(isMeaningfulEvent);
    const previousWorkflows = WORKFLOW_EVENTS.filter((w) => w.events.some((e) => history.includes(e))).map(
        (w) => w.key
    );

    if (!input.lastMeaningfulAt || history.length < MIN_HISTORY_EVENTS) {
        return {
            userId: input.userId,
            reason: "INACTIVE",
            daysInactive: input.lastMeaningfulAt ? Math.floor((now - input.lastMeaningfulAt) / DAY_MS) : -1,
            previousWorkflows,
            suggestion: null,
        };
    }

    const daysInactive = Math.floor((now - input.lastMeaningfulAt) / DAY_MS);
    const threshold = input.isPro ? PRO_DECAY_DAYS : PARTIAL_DECAY_DAYS;
    const reason: ChurnSignal["reason"] = input.isPro ? "PRO_DECAY" : "PARTIAL_DECAY";
    if (daysInactive < CHURN_DAYS) {
        return { userId: input.userId, reason: "INACTIVE", daysInactive, previousWorkflows, suggestion: null };
    }
    if (daysInactive < threshold) {
        return { userId: input.userId, reason: "INACTIVE", daysInactive, previousWorkflows, suggestion: null };
    }

    // Anchor the message on the strongest value moment this user actually
    // reached. Every moment maps to a copy target, so an empty `primary` is
    // only reachable for history we cannot classify — stay quiet then.
    const moment = strongestValueMoment(history);
    if (!moment) {
        return { userId: input.userId, reason, daysInactive, previousWorkflows, suggestion: null };
    }
    const copy = VALUE_MOMENT_COPY[moment];
    const dedupKey = `${input.userId}:${moment}:${Math.floor(input.lastMeaningfulAt / DAY_MS)}`;
    if (input.alreadyNudged?.includes(dedupKey)) {
        return { userId: input.userId, reason, daysInactive, previousWorkflows, suggestion: null };
    }

    return {
        userId: input.userId,
        reason,
        daysInactive,
        previousWorkflows,
        suggestion: {
            id: `re_${dedupKey}`,
            dedupKey,
            title: `${copy.label.charAt(0).toUpperCase()}${copy.label.slice(1)} ${copy.plural ? "are" : "is"} ready to review`,
            // Deliberately calm and factual. No countdowns, no urgency, no FMO.
            body:
                daysInactive >= 45
                    ? "Pick up where you left off. Nothing changed while you were away."
                    : "Here is a link back to the workflow you were last using.",
            href: copy.href,
            cta: copy.cta,
        },
    };
}

/**
 * The most advanced value moment a user's history demonstrates, in the order
 * the product teaches: analysis → strategy → research → execution → review.
 */
const VALUE_MOMENT_PRIORITY: { moment: ValueMoment; events: ProductEventType[] }[] = [
    { moment: "RESEARCH", events: ["RESEARCH_COMPLETED", "ROBUSTNESS_RUN"] },
    { moment: "STRATEGY_DISCOVERY", events: ["STRATEGY_BACKTESTED", "STRATEGY_CREATED"] },
    { moment: "JOURNAL", events: ["JOURNAL_REVIEWED"] },
    { moment: "PAPER_TRADING", events: ["TRADE_COMPLETED", "PAPER_TRADE_STARTED"] },
    { moment: "SETUP_INTELLIGENCE", events: ["SETUP_CREATED", "ALERT_CREATED"] },
    { moment: "MARKET_INTELLIGENCE", events: ["AI_ANALYSIS_COMPLETED", "SMART_MONEY_VIEWED", "MARKET_INTELLIGENCE_VIEWED"] },
];

function strongestValueMoment(history: ProductEventType[]): ValueMoment | undefined {
    return VALUE_MOMENT_PRIORITY.find((p) => p.events.some((e) => history.includes(e)))?.moment;
}
