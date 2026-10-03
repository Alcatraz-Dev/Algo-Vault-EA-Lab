// Deterministic fixtures — pure objects only (no Firebase, no network).

import { defaultChallengeDefinitions, defaultRewardPolicies } from "../policies";
import type {
    ChallengeAttempt,
    ChallengePolicy,
    ChallengeTrade,
    VirtualAccount,
} from "../types";

export const NOW = Date.UTC(2026, 0, 5, 12, 0, 0); // Monday 2026-01-05 12:00 UTC
export const DAY = 24 * 60 * 60 * 1000;

export function makePolicy(overrides: Partial<ChallengePolicy> = {}): ChallengePolicy {
    const definitions = defaultChallengeDefinitions(NOW);
    const pro = definitions.find((d) => d.key === "pro-100k")!;
    return { ...pro.policy, ...overrides };
}

export function makeAttempt(overrides: Partial<ChallengeAttempt> = {}): ChallengeAttempt {
    const policy = overrides.policy ?? makePolicy();
    return {
        id: "att_test_0001",
        userId: "user_test_001",
        definitionId: "pro-100k",
        definitionKey: "pro-100k",
        policy,
        rewardPolicyId: "arena-standard-rewards",
        status: "ACTIVE",
        createdAt: NOW,
        updatedAt: NOW,
        startedAt: NOW,
        expiresAt: NOW + policy.maxCalendarDays * DAY,
        settledAt: null,
        result: null,
        tradingDayKeys: {},
        dailyTradeCounts: {},
        ...overrides,
    };
}

export function makeAccount(policy: ChallengePolicy, overrides: Partial<VirtualAccount> = {}): VirtualAccount {
    const starting = policy.startingBalanceCents;
    return {
        accountId: "acct_test",
        attemptId: "att_test_0001",
        userId: "user_test_001",
        startingBalanceCents: starting,
        balanceCents: starting,
        equityCents: starting,
        peakEquityCents: starting,
        realizedPnLCents: 0,
        unrealizedPnLCents: 0,
        feesCents: 0,
        dayStartEquityCents: starting,
        dayKey: new Date(NOW).toISOString().slice(0, 10),
        dailyPnLCcents: 0,
        exposureCents: 0,
        lastQuoteAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

export function makeOpenTrade(overrides: Partial<ChallengeTrade> = {}): ChallengeTrade {
    return {
        tradeId: "trd_0001",
        attemptId: "att_test_0001",
        userId: "user_test_001",
        symbol: "EURUSD",
        market: "forex",
        side: "long",
        sizeCentiLots: 100, // 1.00 lot
        entryPriceMicros: 1_100_000, // 1.10000
        entryAt: NOW,
        entryQuoteAt: NOW,
        costs: { spreadCostCents: 1200, slippageCostCents: 400, commissionCents: 350 },
        stopLossMicros: 1_095_000,
        takeProfitMicros: 1_110_000,
        riskCents: 690,
        status: "open",
        closedAt: null,
        exitPriceMicros: null,
        exitQuoteAt: null,
        exitReason: null,
        realizedPnLCents: null,
        clientRequestId: null,
        ...overrides,
    };
}

export function standardRewardPolicy() {
    return defaultRewardPolicies(NOW).find((p) => p.id === "arena-standard-rewards")!;
}

let seq = 0;
export function nextEventId(): string {
    seq += 1;
    return `evt_test_${seq}`;
}
