// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — server-side feature flags.
//
// Read from environment variables only: they can be flipped by a controlled
// deployment/configuration change, never by a client or an admin UI toggle.
// Defaults match the product spec:
//
//   PERFORMANCE_ARENA_ENABLED      = true
//   ARENA_CATALOG_ENABLED          = true
//   ARENA_PAID_CHALLENGES_ENABLED  = false   (paid model needs explicit rollout)
//   ARENA_STRIPE_BILLING_VERIFIED  = false   (deployment owner confirms live Stripe/webhook test)
//   ARENA_LEADERBOARDS_ENABLED     = true
//   ARENA_PLATFORM_REWARDS_ENABLED = true
//   CASH_REWARDS_ENABLED           = false   ← HARD OFF BY DEFAULT, see below
//
// CASH_REWARDS_ENABLED is the only flag that can ever enable monetary rewards,
// and even when it is true no payout provider is registered (./payout.ts), so
// production remains architecture-only. There is deliberately NO database key
// and NO admin endpoint that can flip it.
// ─────────────────────────────────────────────────────────────────────────────

function readFlag(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const normalized = raw.trim().toLowerCase();
    if (["false", "0", "off", "no", "disabled"].includes(normalized)) return false;
    if (["true", "1", "on", "yes", "enabled"].includes(normalized)) return true;
    return fallback;
}

export const ARENA_FLAG_ENV = {
    arena: "PERFORMANCE_ARENA_ENABLED",
    catalog: "ARENA_CATALOG_ENABLED",
    paidChallenges: "ARENA_PAID_CHALLENGES_ENABLED",
    leaderboards: "ARENA_LEADERBOARDS_ENABLED",
    platformRewards: "ARENA_PLATFORM_REWARDS_ENABLED",
    cashRewards: "CASH_REWARDS_ENABLED",
} as const;

export function isArenaEnabled(): boolean {
    return readFlag(ARENA_FLAG_ENV.arena, true);
}

export function isCatalogEnabled(): boolean {
    return isArenaEnabled() && readFlag(ARENA_FLAG_ENV.catalog, true);
}

export function isPaidChallengesEnabled(): boolean {
    return isArenaEnabled() &&
        readFlag(ARENA_FLAG_ENV.paidChallenges, false) &&
        readFlag("ARENA_STRIPE_BILLING_VERIFIED", false);
}

export function isLeaderboardsEnabled(): boolean {
    return isArenaEnabled() && readFlag(ARENA_FLAG_ENV.leaderboards, true);
}

export function isPlatformRewardsEnabled(): boolean {
    return isArenaEnabled() && readFlag(ARENA_FLAG_ENV.platformRewards, true);
}

/**
 * CASH REWARDS — default false, fail-closed.
 *
 * This is the single server-side gate for every monetary reward path. The
 * client can never set it: it is an env var, not state, and no API route
 * accepts it as input. All cash reward requests must consult this function
 * and reject when it is false.
 */
export function isCashRewardsEnabled(): boolean {
    // Hard invariant for this product stage: even an accidental deployment
    // variable cannot activate a monetary path. Future work must deliberately
    // replace this guard only after compliance + payout controls are approved.
    return false;
}

/** Snapshot surfaced to the UI so disabled surfaces are hidden, not faked. */
export function arenaFlagSnapshot(): {
    performanceArenaEnabled: boolean;
    challengeCatalogEnabled: boolean;
    paidChallengesEnabled: boolean;
    leaderboardsEnabled: boolean;
    platformRewardsEnabled: boolean;
    cashRewardsEnabled: boolean;
} {
    return {
        performanceArenaEnabled: isArenaEnabled(),
        challengeCatalogEnabled: isCatalogEnabled(),
        paidChallengesEnabled: isPaidChallengesEnabled(),
        leaderboardsEnabled: isLeaderboardsEnabled(),
        platformRewardsEnabled: isPlatformRewardsEnabled(),
        // Always reported to clients as-is (server truth), but the payout
        // surface itself never renders a cash flow — see ./payout.ts.
        cashRewardsEnabled: isCashRewardsEnabled(),
    };
}
