// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — rewards engine (pure logic + idempotent id derivation).
//
// Non-cash rewards ONLY: AV Points, Pro days, AI / research / backtest
// credits, feature unlocks, badges and competition access. CASH exists as a
// type for the future adapter layer but every cash path is rejected
// server-side (see ./payout.ts + CASH_REWARDS_ENABLED=false).
//
// Idempotency: every ledger entry is derived from a DETERMINISTIC rewardId
// (source + type + index). Granting the same challenge result twice yields
// the same ids, so a second write can never create a second reward — the
// service layer only creates entries whose id does not already exist.
// ─────────────────────────────────────────────────────────────────────────────

import { isPlatformRewardsEnabled } from "./flags";
import type {
    CreditWallet,
    RewardLedgerEntry,
    RewardPolicy,
    RewardTrigger,
    RewardType,
} from "./types";

// ──────────── Deterministic reward ids ───────────────────────────────────────

/** RTDB-safe key slug: [A-Za-z0-9_-] only (no ./$#[]()). */
export function rtdbSlug(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

export function rewardIdFor(params: {
    userId: string;
    sourceType: string;
    sourceId: string;
    rewardType: RewardType;
    index: number;
}): string {
    const { userId, sourceType, sourceId, rewardType, index } = params;
    return rtdbSlug(`rw_${sourceType}_${sourceId}_${rewardType}_${index}_${userId}`);
}

export function spendRewardId(params: { userId: string; sourceId: string; itemId: string }): string {
    return rtdbSlug(`sp_${params.sourceId}_${params.itemId}_${params.userId}`);
}

// ──────────── Reward planning ────────────────────────────────────────────────

export interface RewardPlanInput {
    userId: string;
    trigger: RewardTrigger;
    policy: RewardPolicy;
    sourceType: RewardLedgerEntry["sourceType"];
    sourceId: string;
    now: number;
    /** Extra metadata stamped onto every entry (attempt id, definition key…). */
    metadata?: Record<string, string | number | boolean | null>;
    /** Consistency achievement gate (CHALLENGE_PASSED only). */
    consistencyAchieved?: boolean;
    firstChallenge?: boolean;
}

export interface RewardPlanResult {
    entries: RewardLedgerEntry[];
    /** True when platform rewards are flag-disabled — nothing is planned. */
    disabled: boolean;
}

/**
 * Expand a reward policy into concrete ledger entries for one trigger.
 * Pure: the caller persists entries only when their id is absent.
 */
export function planRewards(input: RewardPlanInput): RewardPlanResult {
    const { userId, trigger, policy, sourceType, sourceId, now, metadata, consistencyAchieved, firstChallenge } = input;

    if (!isPlatformRewardsEnabled() || !policy.enabled) {
        return { entries: [], disabled: true };
    }

    const matching = policy.grants.filter((grant) => {
        if (grant.when !== trigger) return false;
        if (grant.type === "CASH") return false; // never planned — architecture only.
        if (grant.when === "CONSISTENCY_ACHIEVED" && !consistencyAchieved) return false;
        if (grant.when === "FIRST_CHALLENGE" && !firstChallenge) return false;
        if (trigger === "CHALLENGE_PASSED" && grant.when === "CHALLENGE_COMPLETED") return false;
        return true;
    });

    const typeCounters = new Map<RewardType, number>();
    const entries: RewardLedgerEntry[] = matching.map((grant) => {
        const seen = typeCounters.get(grant.type) ?? 0;
        typeCounters.set(grant.type, seen + 1);
        return {
            rewardId: rewardIdFor({ userId, sourceType, sourceId, rewardType: grant.type, index: seen }),
            userId,
            sourceType,
            sourceId,
            rewardType: grant.type,
            amount: grant.amount,
            unit: grant.unit ?? "units",
            policyId: policy.id,
            status: "GRANTED" as const,
            createdAt: now,
            grantedAt: now,
            revokedAt: null,
            metadata: {
                ...(metadata ?? {}),
                trigger,
                ...(grant.badgeId ? { badgeId: grant.badgeId } : {}),
                ...(grant.featureKey ? { featureKey: grant.featureKey } : {}),
                ...(grant.label ? { label: grant.label } : {}),
            },
        };
    });

    return { entries, disabled: false };
}

// ──────────── Wallet ─────────────────────────────────────────────────────────

export function emptyWallet(userId: string, now: number): CreditWallet {
    return {
        userId,
        avPoints: 0,
        aiCredits: 0,
        researchCredits: 0,
        backtestCredits: 0,
        proDays: 0,
        badges: [],
        features: [],
        competitions: [],
        updatedAt: now,
    };
}

const WALLET_FIELDS = new Set(["avPoints", "aiCredits", "researchCredits", "backtestCredits", "proDays"]);

function walletFieldFor(type: RewardType): keyof CreditWallet | null {
    switch (type) {
        case "PLATFORM_POINTS":
            return "avPoints";
        case "PRO_DAYS":
            return "proDays";
        case "AI_CREDITS":
            return "aiCredits";
        case "RESEARCH_CREDITS":
            return "researchCredits";
        case "BACKTEST_CREDITS":
            return "backtestCredits";
        default:
            return null;
    }
}

/**
 * Apply one ledger entry to a wallet (pure). Badges/features/competitions are
 * deduplicated by id so re-grants are harmless.
 */
export function applyRewardToWallet(wallet: CreditWallet, entry: RewardLedgerEntry, now: number): CreditWallet {
    if (entry.status !== "GRANTED") return wallet;
    const next: CreditWallet = {
        ...wallet,
        badges: [...wallet.badges],
        features: [...wallet.features],
        competitions: [...wallet.competitions],
        updatedAt: now,
    };

    const field = walletFieldFor(entry.rewardType);
    if (field && WALLET_FIELDS.has(field)) {
        const current = next[field] as number;
        (next as unknown as Record<string, unknown>)[field] = Math.max(0, current + entry.amount);
    } else if (entry.rewardType === "BADGE") {
        const badgeId = String(entry.metadata?.badgeId ?? entry.rewardId);
        if (!next.badges.includes(badgeId)) next.badges.push(badgeId);
    } else if (entry.rewardType === "FEATURE_UNLOCK") {
        const featureKey = String(entry.metadata?.featureKey ?? entry.rewardId);
        if (!next.features.includes(featureKey)) next.features.push(featureKey);
    } else if (entry.rewardType === "COMPETITION_ACCESS") {
        const key = String(entry.metadata?.competitionId ?? entry.rewardId);
        if (!next.competitions.includes(key)) next.competitions.push(key);
    }
    return next;
}

/**
 * Reverse a reward on revocation (pure). Balances never go negative and
 * badges are removed once (idempotent).
 */
export function revokeRewardFromWallet(wallet: CreditWallet, entry: RewardLedgerEntry, now: number): CreditWallet {
    const next: CreditWallet = {
        ...wallet,
        badges: [...wallet.badges],
        features: [...wallet.features],
        competitions: [...wallet.competitions],
        updatedAt: now,
    };
    const field = walletFieldFor(entry.rewardType);
    if (field && WALLET_FIELDS.has(field)) {
        const current = next[field] as number;
        (next as unknown as Record<string, unknown>)[field] = Math.max(0, current - entry.amount);
    } else if (entry.rewardType === "BADGE") {
        const badgeId = String(entry.metadata?.badgeId ?? entry.rewardId);
        next.badges = next.badges.filter((b) => b !== badgeId);
    } else if (entry.rewardType === "FEATURE_UNLOCK") {
        const featureKey = String(entry.metadata?.featureKey ?? entry.rewardId);
        next.features = next.features.filter((f) => f !== featureKey);
    } else if (entry.rewardType === "COMPETITION_ACCESS") {
        const key = String(entry.metadata?.competitionId ?? entry.rewardId);
        next.competitions = next.competitions.filter((c) => c !== key);
    }
    return next;
}

// ──────────── AV Points spending ─────────────────────────────────────────────

export interface SpendPlan {
    ok: boolean;
    error?: string;
    wallet: CreditWallet;
    entries: RewardLedgerEntry[];
}

/**
 * Spend AV Points on a catalog item (pure). Produces debit + credit entries
 * with deterministic ids — persistence stays idempotent.
 */
export function planPointsSpend(params: {
    wallet: CreditWallet;
    itemId: string;
    costPoints: number;
    grants: Array<{ walletField: "aiCredits" | "researchCredits" | "backtestCredits" | "proDays"; amount: number; unit: string }>;
    now: number;
    requestSourceId: string;
}): SpendPlan {
    const { wallet, itemId, costPoints, grants, now, requestSourceId } = params;
    if (!isPlatformRewardsEnabled()) {
        return { ok: false, error: "Platform rewards are currently disabled.", wallet, entries: [] };
    }
    if (costPoints <= 0) return { ok: false, error: "Invalid item cost.", wallet, entries: [] };
    if (wallet.avPoints < costPoints) {
        return {
            ok: false,
            error: `Not enough AV Points: ${wallet.avPoints} available, ${costPoints} required.`,
            wallet,
            entries: [],
        };
    }

    const next: CreditWallet = { ...wallet, avPoints: wallet.avPoints - costPoints, updatedAt: now };

    const entries: RewardLedgerEntry[] = [];
    entries.push({
        rewardId: spendRewardId({ userId: wallet.userId, sourceId: requestSourceId, itemId: `debit_${itemId}` }),
        userId: wallet.userId,
        sourceType: "POINTS_SPEND",
        sourceId: requestSourceId,
        rewardType: "PLATFORM_POINTS",
        amount: -costPoints,
        unit: "AV_POINTS",
        policyId: "points-spend-catalog",
        status: "GRANTED",
        createdAt: now,
        grantedAt: now,
        revokedAt: null,
        metadata: { itemId, direction: "debit" },
    });

    grants.forEach((grant, index) => {
        const rewardType: RewardType =
            grant.walletField === "aiCredits"
                ? "AI_CREDITS"
                : grant.walletField === "researchCredits"
                  ? "RESEARCH_CREDITS"
                  : grant.walletField === "backtestCredits"
                    ? "BACKTEST_CREDITS"
                    : "PRO_DAYS";
        const entry: RewardLedgerEntry = {
            rewardId: spendRewardId({ userId: wallet.userId, sourceId: requestSourceId, itemId: `credit_${itemId}_${index}` }),
            userId: wallet.userId,
            sourceType: "POINTS_SPEND",
            sourceId: requestSourceId,
            rewardType,
            amount: grant.amount,
            unit: grant.unit,
            policyId: "points-spend-catalog",
            status: "GRANTED",
            createdAt: now,
            grantedAt: now,
            revokedAt: null,
            metadata: { itemId, direction: "credit", walletField: grant.walletField },
        };
        entries.push(entry);
        const credited = applyRewardToWallet(next, entry, now);
        Object.assign(next, credited);
    });

    return { ok: true, wallet: next, entries };
}

// ──────────── AI credit consumption (real usage) ─────────────────────────────

/** Guard: consume N AI credits only when the balance covers them (pure). */
export function consumeAiCredits(wallet: CreditWallet, amount: number, now: number): { ok: boolean; wallet: CreditWallet } {
    if (amount <= 0) return { ok: true, wallet };
    if (wallet.aiCredits < amount) return { ok: false, wallet };
    return { ok: true, wallet: { ...wallet, aiCredits: wallet.aiCredits - amount, updatedAt: now } };
}
