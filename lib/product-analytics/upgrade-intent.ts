/**
 * Product Analytics — upgrade intent.
 *
 * When a Free user hits a Pro capability we record WHAT they were trying to do,
 * not just that they clicked "Upgrade". The point is to learn which workflow
 * actually drives revenue, so product and marketing invest in the right place.
 *
 * This is intent data, not a promise of conversion. Every field here is either
 * a feature key from our own catalogue or a count.
 *
 * Pure module: no I/O.
 */

import { hash } from "./events";

export const UPGRADE_TRIGGERS = [
    "strategy-research",
    "monte-carlo",
    "walk-forward",
    "backtesting",
    "market-intelligence",
    "ai-analysis",
    "smart-money",
    "trade-journal",
    "automation",
    "marketplace",
    "intelligence-api",
    "strategy-health",
    "setup-memory",
    "pricing",
    "other",
] as const;

export type UpgradeTrigger = (typeof UPGRADE_TRIGGERS)[number];

/** What the user was looking at when they hit the Pro wall. */
export type UpgradeIntent = {
    id: string;
    uid: string;
    /** The Pro capability that triggered the gate. */
    trigger: UpgradeTrigger;
    /** Product usage measured at the moment of intent — context, not causation. */
    usage: {
        backtests: number;
        strategies: number;
        oosTests: number;
        monteCarloRuns: number;
        paperTrades: number;
        researchRuns: number;
    };
    /** Which path they took: viewed the paywall, started checkout, or subscribed. */
    outcome: "VIEWED" | "CHECKOUT_STARTED" | "SUBSCRIBED" | "DISMISSED";
    plan?: string;
    createdAt: number;
    day: string;
};

export type NewUpgradeIntent = {
    uid: string;
    trigger: UpgradeTrigger;
    usage?: Partial<UpgradeIntent["usage"]>;
    outcome?: UpgradeIntent["outcome"];
    plan?: string;
    now?: number;
};

function clampCount(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Math.round(n), 10_000);
}

export function createUpgradeIntent(input: NewUpgradeIntent): UpgradeIntent {
    const now = input.now ?? Date.now();
    const usage = input.usage ?? {};
    return {
        id: `ui_${hash(`${input.uid}:${input.trigger}:${Math.floor(now / 60000)}`)}`,
        uid: input.uid,
        trigger: input.trigger,
        usage: {
            backtests: clampCount(usage.backtests),
            strategies: clampCount(usage.strategies),
            oosTests: clampCount(usage.oosTests),
            monteCarloRuns: clampCount(usage.monteCarloRuns),
            paperTrades: clampCount(usage.paperTrades),
            researchRuns: clampCount(usage.researchRuns),
        },
        outcome: input.outcome ?? "VIEWED",
        plan: input.plan,
        createdAt: now,
        day: new Date(now).toISOString().slice(0, 10),
    };
}

// ─── Reporting ──────────────────────────────────────────────────────────────

export type TriggerReport = {
    trigger: UpgradeTrigger;
    /** Distinct users who hit this gate. */
    users: number;
    reachedCheckout: number;
    subscribed: number;
    /** subscribed / users, percent. null when users is 0. */
    conversionPct: number | null;
    /** Average meaningful product actions taken by users who hit this gate. */
    avgUsageActions: number;
    insufficient: boolean;
};

/** Minimum distinct users before we report a trigger's conversion rate. */
export const MIN_TRIGGER_USERS = 10;

/**
 * Aggregate upgrade intents by trigger, ranked by how many Pro subscriptions
 * each one actually preceded. This is the "what drives revenue" view.
 */
export function reportUpgradeIntents(intents: UpgradeIntent[]): TriggerReport[] {
    const byTrigger = new Map<UpgradeTrigger, UpgradeIntent[]>();
    for (const intent of intents) {
        const list = byTrigger.get(intent.trigger) ?? [];
        list.push(intent);
        byTrigger.set(intent.trigger, list);
    }

    const reports: TriggerReport[] = [...byTrigger.entries()].map(([trigger, list]) => {
        const users = new Set(list.map((i) => i.uid)).size;
        const reachedCheckout = new Set(list.filter((i) => i.outcome !== "VIEWED" && i.outcome !== "DISMISSED").map((i) => i.uid)).size;
        const subscribed = new Set(list.filter((i) => i.outcome === "SUBSCRIBED").map((i) => i.uid)).size;
        const usageActions = list.reduce(
            (sum, i) =>
                sum +
                i.usage.backtests +
                i.usage.strategies +
                i.usage.oosTests +
                i.usage.monteCarloRuns +
                i.usage.paperTrades +
                i.usage.researchRuns,
            0
        );
        return {
            trigger,
            users,
            reachedCheckout,
            subscribed,
            conversionPct: users > 0 ? (subscribed / users) * 100 : null,
            avgUsageActions: list.length > 0 ? usageActions / list.length : 0,
            insufficient: users < MIN_TRIGGER_USERS,
        };
    });

    return reports.sort((a, b) => b.subscribed - a.subscribed || b.users - a.users);
}
