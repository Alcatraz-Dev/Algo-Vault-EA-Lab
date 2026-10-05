// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — configurable policies.
//
// Challenge definitions and reward policies are CONFIGURATION, not code:
// nothing in the UI or rule engine hard-codes a target, a limit or a reward
// amount. Admin-managed definitions live in RTDB (`performanceArena/definitions`)
// and fall back to these shipped defaults when absent.
// ─────────────────────────────────────────────────────────────────────────────

import type {
    ChallengeDefinition,
    ChallengePolicy,
    RewardPolicy,
    LeaderboardPolicy,
} from "./types";

// ──────────── Policy normalization (backwards compatibility) ────────────────

/**
 * Fill in fields added after a policy was first persisted.
 *
 * Challenge policies are stored in RTDB and snapshotted immutably onto each
 * attempt at join time, so a definition saved before a field existed would
 * otherwise fail validation or produce `NaN` in a rule. Normalization is
 * additive only: every value already present is left exactly as configured,
 * so an admin's intent is never rewritten underneath them.
 */
export function normalizeChallengePolicy(policy: ChallengePolicy): ChallengePolicy {
    const maxRiskPerTradePct =
        Number.isFinite(policy.maxRiskPerTradePct) && policy.maxRiskPerTradePct > 0 ? policy.maxRiskPerTradePct : 2;
    return {
        ...policy,
        maxRiskPerTradePct,
        // 3× the per-trade cap: enough room to run several correlated
        // positions, tight enough that the drawdown envelope still governs.
        maxAggregateRiskPctOfEquity:
            Number.isFinite(policy.maxAggregateRiskPctOfEquity) && policy.maxAggregateRiskPctOfEquity > 0
                ? policy.maxAggregateRiskPctOfEquity
                : maxRiskPerTradePct * 3,
        // Per-instrument net notional ceiling in × equity. 10× leaves room
        // for a normal leveraged book under a 20× account cap while still
        // preventing all exposure landing in a single instrument.
        maxPositionNotionalMultiple:
            Number.isFinite(policy.maxPositionNotionalMultiple) && policy.maxPositionNotionalMultiple > 0
                ? policy.maxPositionNotionalMultiple
                : 10,
    };
}

export function normalizeDefinition<T extends ChallengeDefinition>(definition: T): T {
    return { ...definition, policy: normalizeChallengePolicy(definition.policy) };
}

// ──────────── Policy validation (server-side, fail-closed) ───────────────────

export interface PolicyValidation {
    valid: boolean;
    errors: string[];
}

export function validateChallengePolicy(input: ChallengePolicy): PolicyValidation {
    const policy = normalizeChallengePolicy(input);
    const errors: string[] = [];
    const positive = (name: string, value: number, max = 1_000_000) => {
        if (!Number.isFinite(value) || value <= 0 || value > max) {
            errors.push(`${name} must be a finite number in (0, ${max}].`);
        }
    };
    const nonNegative = (name: string, value: number, max = 1_000_000) => {
        if (!Number.isFinite(value) || value < 0 || value > max) {
            errors.push(`${name} must be a finite number in [0, ${max}].`);
        }
    };
    const intAtLeast = (name: string, value: number, min: number) => {
        if (!Number.isInteger(value) || value < min) {
            errors.push(`${name} must be an integer ≥ ${min}.`);
        }
    };

    positive("startingBalanceCents", policy.startingBalanceCents, 100_000_000_000);
    positive("profitTargetPct", policy.profitTargetPct, 1000);
    positive("maxDrawdownPct", policy.maxDrawdownPct, 1000);
    positive("dailyLossLimitPct", policy.dailyLossLimitPct, 1000);
    if (policy.dailyLossLimitPct >= policy.maxDrawdownPct) {
        errors.push("dailyLossLimitPct must be smaller than maxDrawdownPct.");
    }
    if (policy.profitTargetPct >= policy.maxDrawdownPct * 10 && policy.profitTargetPct > 100) {
        errors.push("profitTargetPct looks implausible relative to maxDrawdownPct.");
    }
    intAtLeast("minTradingDays", policy.minTradingDays, 1);
    intAtLeast("maxTradingDays", policy.maxTradingDays, policy.minTradingDays);
    intAtLeast("maxCalendarDays", policy.maxCalendarDays, 1);
    intAtLeast("maxConcurrentPositions", policy.maxConcurrentPositions, 1);
    intAtLeast("maxDailyTrades", policy.maxDailyTrades, 1);
    positive("maxRiskPerTradePct", policy.maxRiskPerTradePct, 100);
    positive("maxAggregateRiskPctOfEquity", policy.maxAggregateRiskPctOfEquity, 1_000);
    positive("maxPositionNotionalMultiple", policy.maxPositionNotionalMultiple, 100_000);
    if (policy.maxAggregateRiskPctOfEquity < policy.maxRiskPerTradePct) {
        errors.push("maxAggregateRiskPctOfEquity must be at least maxRiskPerTradePct, otherwise a single legal trade is always rejected.");
    }
    positive("leveragePolicy.maxLeverageRatio", policy.leveragePolicy.maxLeverageRatio, 1000);
    positive("positionSizePolicy.maxSizeLots", policy.positionSizePolicy.maxSizeLots, 10_000);
    positive("positionSizePolicy.stepLots", policy.positionSizePolicy.stepLots, 100);
    nonNegative("costModel.commissionPerLotCents", policy.costModel.commissionPerLotCents, 1_000_000);
    nonNegative("costModel.slippagePips", policy.costModel.slippagePips, 1000);
    if (policy.warningUtilizationPct <= 0 || policy.warningUtilizationPct > 100) {
        errors.push("warningUtilizationPct must be in (0, 100].");
    }
    if (policy.consistency.maxSingleDayPnlSharePct <= 0 || policy.consistency.maxSingleDayPnlSharePct > 100) {
        errors.push("consistency.maxSingleDayPnlSharePct must be in (0, 100].");
    }
    intAtLeast("consistency.minTradesForConsistency", policy.consistency.minTradesForConsistency, 1);
    if (!Array.isArray(policy.allowedMarkets) || policy.allowedMarkets.length === 0) {
        errors.push("allowedMarkets must be a non-empty array.");
    }
    if (policy.allowedSymbols !== "all" && (!Array.isArray(policy.allowedSymbols) || policy.allowedSymbols.length === 0)) {
        errors.push('allowedSymbols must be "all" or a non-empty array.');
    }
    if (
        policy.tradingHours !== "all" &&
        (!Number.isInteger(policy.tradingHours.startUtcHour) ||
            !Number.isInteger(policy.tradingHours.endUtcHour) ||
            policy.tradingHours.startUtcHour < 0 ||
            policy.tradingHours.startUtcHour > 23 ||
            policy.tradingHours.endUtcHour < 1 ||
            policy.tradingHours.endUtcHour > 24)
    ) {
        errors.push("tradingHours must be \"all\" or integer UTC hours (start 0–23, end 1–24).");
    }
    if (policy.maxDrawdownMode !== "static" && policy.maxDrawdownMode !== "trailing") {
        errors.push('maxDrawdownMode must be "static" or "trailing".');
    }
    if (policy.dailyLossBase !== "starting_balance" && policy.dailyLossBase !== "day_start_equity") {
        errors.push('dailyLossBase must be "starting_balance" or "day_start_equity".');
    }

    return { valid: errors.length === 0, errors };
}

export function validateDefinition(def: Pick<ChallengeDefinition, "key" | "name" | "policy" | "access"> & Partial<Pick<ChallengeDefinition, "enabled" | "status">>): PolicyValidation {
    const errors: string[] = [];
    if (!/^[a-z0-9][a-z0-9-]{2,48}$/.test(def.key)) {
        errors.push("key must be 3–49 chars, lowercase alphanumeric/dash.");
    }
    if (!def.name || def.name.trim().length < 3 || def.name.length > 80) {
        errors.push("name must be 3–80 characters.");
    }
    const policyResult = validateChallengePolicy(def.policy);
    errors.push(...policyResult.errors);
    if (!["free", "pro", "paid", "credits"].includes(def.access.model)) {
        errors.push("access.model must be free | pro | paid | credits.");
    }
    if (def.access.model === "paid") {
        const published = def.enabled === true || def.status === "AVAILABLE";
        if (def.access.priceCents !== undefined && (!Number.isSafeInteger(def.access.priceCents) || def.access.priceCents <= 0)) {
            errors.push("paid access priceCents, when configured, must be a positive integer.");
        }
        if (published && (def.access.priceCents === undefined || !Number.isSafeInteger(def.access.priceCents) || def.access.priceCents <= 0)) {
            errors.push("publishing paid access requires a configured positive integer priceCents.");
        }
        if (def.access.currency !== undefined && !/^[a-z]{3}$/i.test(def.access.currency)) {
            errors.push("paid access currency must be a 3-letter ISO currency code.");
        }
    }
    if (def.access.model === "credits" && (!Number.isFinite(def.access.pricePoints) || (def.access.pricePoints ?? 0) <= 0)) {
        errors.push("credits access requires a positive pricePoints.");
    }
    return { valid: errors.length === 0, errors };
}

// ──────────── Shipped default challenge definitions ─────────────────────────

function basePolicy(overrides: Partial<ChallengePolicy>): ChallengePolicy {
    return {
        startingBalanceCents: 100_000_00,
        profitTargetPct: 10,
        maxDrawdownPct: 8,
        maxDrawdownMode: "static",
        dailyLossLimitPct: 4,
        dailyLossBase: "day_start_equity",
        minTradingDays: 5,
        maxTradingDays: 30,
        maxCalendarDays: 45,
        // Simulated practice supports every configured asset class by default.
        // Custom admin policies may still restrict a challenge's markets.
        allowedMarkets: ["forex", "metals", "indices", "crypto", "equities"],
        allowedSymbols: "all",
        allowedSessions: "all",
        tradingHours: "all",
        weekendTrading: "blocked",
        newsTrading: "allowed",
        leveragePolicy: { maxLeverageRatio: 20 },
        maxConcurrentPositions: 5,
        maxDailyTrades: 20,
        maxRiskPerTradePct: 2,
        maxAggregateRiskPctOfEquity: 6,
        maxPositionNotionalMultiple: 10,
        // Legacy field kept for stored policies; see
        // ChallengePolicy.maxPositionPctOfEquity and ./sizing. The effective
        // per-instrument ceiling is max(10, 25/100) = 10× equity, i.e. the
        // old 25%-of-equity notional cap no longer throttles normal sizing.
        maxPositionPctOfEquity: 25,
        positionSizePolicy: { maxSizeLots: 5, stepLots: 0.01 },
        consistency: {
            required: false,
            maxSingleDayPnlSharePct: 50,
            minTradesForConsistency: 10,
        },
        strategyRestrictions: null,
        costModel: {
            commissionPerLotCents: 350, // $3.50 per lot round trip
            slippagePips: 0.2,
            useTypicalSpread: true,
        },
        warningUtilizationPct: 80,
        dailyLossBreachAction: "fail",
        autoSettleOnTarget: true,
        ...overrides,
    };
}

/**
 * Shipped catalog — four tiers, fully configurable. Prices/monetization shown
 * here are NOT final; the paid access model is disabled behind
 * ARENA_PAID_CHALLENGES_ENABLED=false.
 */
export function defaultChallengeDefinitions(now: number): ChallengeDefinition[] {
    const make = (
        id: string,
        key: string,
        name: string,
        tier: ChallengeDefinition["tier"],
        summary: string,
        policy: ChallengePolicy,
        access: ChallengeDefinition["access"]
    ): ChallengeDefinition => ({
        id,
        key,
        name,
        tier,
        summary,
        policy,
        access,
        rewardPolicyId: "arena-standard-rewards",
        // Paid products stay unpublished until an admin configures the fee.
        // Checkout is also server-disabled by default until billing is verified.
        status: access.model === "paid" ? "DRAFT" : "AVAILABLE",
        enabled: access.model !== "paid",
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
    });

    return [
        make(
            "starter-10k",
            "starter-10k",
            "Starter $10K (Free Practice)",
            "starter",
            "Learn the challenge mechanics with low virtual stakes and forgiving limits.",
            basePolicy({
                startingBalanceCents: 10_000_00,
                profitTargetPct: 8,
                maxDrawdownPct: 10,
                dailyLossLimitPct: 5,
                minTradingDays: 3,
                maxTradingDays: 20,
                maxCalendarDays: 30,
                maxConcurrentPositions: 3,
                maxDailyTrades: 10,
            }),
            { model: "free" }
        ),
        make(
            "paid-25k",
            "paid-25k",
            "Paid Entry $25K Challenge",
            "standard",
            "Affordable entry evaluation with $25,000 virtual capital.",
            basePolicy({
                startingBalanceCents: 25_000_00,
                profitTargetPct: 8,
                maxDrawdownPct: 6,
                dailyLossLimitPct: 3,
                minTradingDays: 4,
                maxTradingDays: 30,
                maxCalendarDays: 40,
            }),
            { model: "paid", currency: "usd" }
        ),
        make(
            "paid-50k",
            "paid-50k",
            "Paid Standard $50K Challenge",
            "standard",
            "Standard prop-style evaluation with $50,000 virtual capital.",
            basePolicy({
                startingBalanceCents: 50_000_00,
                profitTargetPct: 10,
                maxDrawdownPct: 8,
                dailyLossLimitPct: 4,
                minTradingDays: 5,
                maxTradingDays: 30,
                maxCalendarDays: 45,
            }),
            { model: "paid", currency: "usd" }
        ),
        make(
            "standard-25k",
            "standard-25k",
            "Standard $25K (Pro)",
            "standard",
            "Balanced rules: a 10% target inside a 6% drawdown envelope (included for Pro).",
            basePolicy({
                startingBalanceCents: 25_000_00,
                profitTargetPct: 10,
                maxDrawdownPct: 6,
                dailyLossLimitPct: 3,
                minTradingDays: 4,
                maxTradingDays: 30,
                maxCalendarDays: 40,
            }),
            { model: "pro" }
        ),
        make(
            "pro-100k",
            "pro-100k",
            "Pro $100K Challenge",
            "pro",
            "The flagship simulated evaluation: $100K virtual, 10% target, 8% max drawdown.",
            basePolicy({}),
            { model: "pro" }
        ),
        make(
            "paid-100k",
            "paid-100k",
            "Paid Professional $100K Challenge",
            "pro",
            "Professional prop-style evaluation with $100,000 virtual capital.",
            basePolicy({}),
            { model: "paid", currency: "usd" }
        ),
        make(
            "elite-200k",
            "elite-200k",
            "Elite $200K Challenge",
            "elite",
            "Largest virtual account with tighter daily-loss and consistency rules.",
            basePolicy({
                startingBalanceCents: 200_000_00,
                profitTargetPct: 12,
                maxDrawdownPct: 7,
                dailyLossLimitPct: 3.5,
                minTradingDays: 7,
                maxTradingDays: 40,
                maxCalendarDays: 60,
                maxConcurrentPositions: 8,
                maxDailyTrades: 30,
                consistency: {
                    required: true,
                    maxSingleDayPnlSharePct: 40,
                    minTradesForConsistency: 15,
                },
            }),
            { model: "pro" }
        ),
        make(
            "paid-200k",
            "paid-200k",
            "Paid Advanced $200K Challenge",
            "elite",
            "Advanced prop-style evaluation with $200,000 virtual capital.",
            basePolicy({
                startingBalanceCents: 200_000_00,
                profitTargetPct: 12,
                maxDrawdownPct: 7,
                dailyLossLimitPct: 3.5,
                minTradingDays: 7,
                maxTradingDays: 40,
                maxCalendarDays: 60,
                maxConcurrentPositions: 8,
                maxDailyTrades: 30,
                consistency: {
                    required: true,
                    maxSingleDayPnlSharePct: 40,
                    minTradesForConsistency: 15,
                },
            }),
            { model: "paid", currency: "usd" }
        ),
    ];
}

// ──────────── Shipped default reward policies ────────────────────────────────

/**
 * Reward policies are configuration. Amounts below are product defaults that
 * admins can change — the rule/reward engines never hard-code them.
 */
export function defaultRewardPolicies(now: number): RewardPolicy[] {
    return [
        {
            id: "arena-standard-rewards",
            name: "Arena Standard Rewards",
            description: "Default non-cash reward set for simulated challenges. Cash rewards are not part of this policy.",
            enabled: true,
            version: 1,
            grants: [
                { when: "CHALLENGE_PASSED", type: "PLATFORM_POINTS", amount: 5_000, unit: "AV_POINTS" },
                { when: "CHALLENGE_PASSED", type: "PRO_DAYS", amount: 14, unit: "days" },
                { when: "CHALLENGE_PASSED", type: "AI_CREDITS", amount: 2_000, unit: "credits" },
                { when: "CHALLENGE_PASSED", type: "RESEARCH_CREDITS", amount: 10, unit: "runs" },
                { when: "CHALLENGE_PASSED", type: "BADGE", amount: 1, unit: "badge", badgeId: "verified-trader" },
                { when: "CHALLENGE_COMPLETED", type: "PLATFORM_POINTS", amount: 500, unit: "AV_POINTS" },
                { when: "CHALLENGE_COMPLETED", type: "BACKTEST_CREDITS", amount: 2, unit: "runs" },
                { when: "CONSISTENCY_ACHIEVED", type: "PLATFORM_POINTS", amount: 1_500, unit: "AV_POINTS" },
                { when: "CONSISTENCY_ACHIEVED", type: "BADGE", amount: 1, unit: "badge", badgeId: "consistent-operator" },
            ],
            createdAt: now,
            updatedAt: now,
        },
    ];
}

// ──────────── Leaderboard policy (composite scoring, never raw profit) ───────

export function defaultLeaderboardPolicy(): LeaderboardPolicy {
    return {
        weights: {
            return: 0.35,
            drawdown: 0.25,
            consistency: 0.2,
            riskDiscipline: 0.1,
            completion: 0.1,
        },
        minTrades: 5,
        includeStatuses: ["PASSED", "FAILED", "EXPIRED", "ACTIVE"],
    };
}

// ──────────── AV Points spend catalog (configurable) ────────────────────────

export interface PointsSpendItem {
    id: string;
    label: string;
    costPoints: number;
    grants: Array<{ walletField: "aiCredits" | "researchCredits" | "backtestCredits" | "proDays"; amount: number; unit: string }>;
    description: string;
}

export const POINTS_SPEND_CATALOG: PointsSpendItem[] = [
    {
        id: "ai-credits-500",
        label: "500 AI Credits",
        costPoints: 1_000,
        grants: [{ walletField: "aiCredits", amount: 500, unit: "credits" }],
        description: "Fund Challenge Guardian AI analyses and arena AI features.",
    },
    {
        id: "research-runs-10",
        label: "10 Research Runs",
        costPoints: 1_000,
        grants: [{ walletField: "researchCredits", amount: 10, unit: "runs" }],
        description: "Strategy Research compatibility runs against your challenge rules.",
    },
    {
        id: "backtest-runs-5",
        label: "5 Backtest Runs",
        costPoints: 800,
        grants: [{ walletField: "backtestCredits", amount: 5, unit: "runs" }],
        description: "Extra backtest capacity for strategy iteration.",
    },
    {
        id: "pro-day-1",
        label: "1 Pro Day",
        costPoints: 500,
        grants: [{ walletField: "proDays", amount: 1, unit: "days" }],
        description: "One day of Pro access credited to your account (applies while Pro is active).",
    },
];

export function findSpendItem(id: string): PointsSpendItem | null {
    return POINTS_SPEND_CATALOG.find((item) => item.id === id) ?? null;
}
