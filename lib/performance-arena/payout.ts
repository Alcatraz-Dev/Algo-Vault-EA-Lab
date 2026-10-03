// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — FUTURE cash-reward layer (architecture only).
//
// ⚠ CASH REWARDS ARE DISABLED IN PRODUCTION. CASH_REWARDS_ENABLED defaults to
// false and is read server-side only; there is no admin UI or API that can
// flip it. This module defines the adapter seams a future, compliance-reviewed
// deployment would plug into — NO provider is registered, NO payout flow runs,
// and NO sensitive financial/KYC data is collected today.
//
// Future flow (documented in docs/FUTURE_CASH_REWARDS.md):
//   Challenge Passed → Performance Result → Reward Eligibility → Jurisdiction
//   → Identity/KYC → Fraud Review → Tax/Compliance → Manual/Policy Approval
//   → Payout Request → Payout Provider → Completed
//
// The current production implementation STOPS at "Reward Eligibility".
// ─────────────────────────────────────────────────────────────────────────────

import { isCashRewardsEnabled } from "./flags";
import type {
    PayoutAccount,
    PayoutProvider,
    PayoutRequest,
    PayoutProviderResult,
} from "./types";

/** Registry of payout providers. EMPTY by design — nothing to plug in yet. */
const PROVIDERS = new Map<string, PayoutProvider>();

export function registerPayoutProvider(provider: PayoutProvider): void {
    // Intentionally not exposed through any route today. Registration is a
    // future controlled-deployment step gated by compliance review.
    PROVIDERS.set(provider.id, provider);
}

export function getPayoutProvider(id: string): PayoutProvider | null {
    return PROVIDERS.get(id) ?? null;
}

export function listPayoutProviders(): Array<{ id: string; name: string }> {
    return Array.from(PROVIDERS.values()).map((p) => ({ id: p.id, name: p.name }));
}

export type CashRewardRejection =
    | "CASH_REWARDS_DISABLED"
    | "NO_PAYOUT_PROVIDER"
    | "INVALID_REQUEST"
    | "NOT_IMPLEMENTED";

export interface CashRewardOutcome {
    ok: false;
    code: CashRewardRejection;
    message: string;
}

/**
 * The single server-side entry point for any future cash reward request.
 *
 * INVARIANT (tested): with CASH_REWARDS_ENABLED=false this ALWAYS rejects —
 * regardless of any client-supplied flag, eligibility object or forged state.
 * With the flag on it still rejects until a provider is registered AND the
 * deployment explicitly opts into the adapter (never in this codebase).
 */
export async function requestCashReward(input: {
    userId: string;
    attemptId: string;
    amountCents: number;
    currency?: string;
    providerId?: string;
}): Promise<CashRewardOutcome | { ok: true; request: PayoutRequest; provider: PayoutProviderResult }> {
    if (!isCashRewardsEnabled()) {
        return {
            ok: false,
            code: "CASH_REWARDS_DISABLED",
            message:
                "Cash rewards are disabled. AlgoVault rewards are platform rewards only (points, credits, badges, Pro days) and have no cash value.",
        };
    }

    if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
        return { ok: false, code: "INVALID_REQUEST", message: "Invalid payout amount." };
    }

    const provider = input.providerId ? getPayoutProvider(input.providerId) : null;
    if (!provider) {
        return {
            ok: false,
            code: "NO_PAYOUT_PROVIDER",
            message: "No payout provider is configured. Cash payouts require a future compliance-reviewed deployment.",
        };
    }
    return {
        ok: false,
        code: "NOT_IMPLEMENTED",
        message: "Payout flow is not implemented in this deployment.",
    };
}

/**
 * Placeholder account/request constructors kept for the future adapter —
 * they never persist anything and exist so the interfaces compile against a
 * real usage site.
 */
export function draftPayoutRequest(params: {
    requestId: string;
    userId: string;
    attemptId: string;
    amountCents: number;
    currency: string;
    now: number;
}): PayoutRequest {
    return {
        requestId: params.requestId,
        userId: params.userId,
        attemptId: params.attemptId,
        amountCents: params.amountCents,
        currency: params.currency,
        status: "rejected",
        rejectionReason: "Cash rewards are disabled in this deployment.",
        createdAt: params.now,
        updatedAt: params.now,
    };
}

export type { PayoutAccount, PayoutProvider, PayoutRequest };
