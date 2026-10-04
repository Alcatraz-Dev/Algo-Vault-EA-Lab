// ──────────── Access / entitlement (pure decision logic) ─────────────────────
//
// The single decision function for "may this user join this challenge?".
//
// Deliberately PURE: no RTDB, no network, no Firebase imports. The
// entitlement lookup (Pro/license check) and the wallet read are injected by
// the caller so this logic can be tested offline (repo test convention:
// pure-function tests only — no Firebase, no I/O).
//
// Production wiring lives in service.ts (evaluateAccess), which injects the
// canonical Strategy Lab gate (checkAccess — same source of truth as Strategy
// Lab / Strategy Research) and the RTDB AV Points wallet. Nothing here ever
// reads an entitlement or price from client input.
//
// Feature flags come from ./flags (env-only, no database dependency), so the
// flag gates are part of the pure decision too.

import type { AccessStatus } from "@/lib/strategy-lab/types";
import { isArenaEnabled, isPaidChallengesEnabled, isPlatformRewardsEnabled } from "./flags";
import type { ChallengeDefinition } from "./types";

export interface AccessEvaluation {
    allowed: boolean;
    reason?: string;
    level?: "free" | "pro" | "paid" | "credits";
}

export interface EntitlementDeps {
    /**
     * Server-side entitlement check. Production: Strategy Lab `checkAccess`
     * (feature licenses + Pro/enterprise subscription). Never client-supplied.
     */
    checkEntitlement: (uid: string) => Promise<AccessStatus>;
    /**
     * AV Points balance for credits-priced entry. Production: RTDB wallet.
     * A missing wallet must resolve to 0 points (fail-closed, no free entry).
     */
    getWalletPoints: (uid: string) => Promise<number>;
    /**
     * Check if user has an unconsumed paid challenge grant for a paid definition.
     */            checkPaidChallengeGrant?: (uid: string, definitionId: string) => Promise<boolean>;
}

export async function evaluateEntitlement(
    uid: string,
    definition: ChallengeDefinition,
    deps: EntitlementDeps
): Promise<AccessEvaluation> {
    if (!isArenaEnabled()) return { allowed: false, reason: "Performance Arena is currently disabled." };

    switch (definition.access.model) {
        case "free":
            return { allowed: true, level: "free" };

        case "pro": {
            // Reuse the canonical Pro gate (same source of truth as Strategy
            // Lab / Strategy Research — subscriptions + feature licenses).
            const access = await deps.checkEntitlement(uid);
            return access.accessible
                ? { allowed: true, level: "pro" }
                : { allowed: false, reason: access.reason ?? "This challenge requires an active Pro subscription." };
        }

        case "paid": {
            if (!isPaidChallengesEnabled()) {
                return { allowed: false, reason: "Paid challenges are not available yet." };
            }
            if (deps.checkPaidChallengeGrant) {
                const hasGrant = await deps.checkPaidChallengeGrant(uid, definition.id);
                if (hasGrant) return { allowed: true, level: "paid" };
            }
            return { allowed: false, reason: "A verified purchase for this challenge is required." };
        }

        case "credits": {
            if (!isPlatformRewardsEnabled()) {
                return { allowed: false, reason: "Points-based challenge access is currently disabled." };
            }
            const points = await deps.getWalletPoints(uid);
            const cost = definition.access.pricePoints ?? 0;
            return points >= cost
                ? { allowed: true, level: "credits" }
                : { allowed: false, reason: `Requires ${cost} AV Points (you have ${points}).` };
        }

        default:
            return { allowed: false, reason: "Unknown access model." };
    }
}
