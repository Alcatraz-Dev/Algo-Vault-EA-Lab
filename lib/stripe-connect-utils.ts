import { adminDatabase } from "@/lib/firebase-admin";
import type Stripe from "stripe";

/**
 * Shared Connect V2 helpers used by both `/api/developer/stripe` and the
 * Stripe webhook so account status is derived identically everywhere.
 */

export type StripeAccountV2 = Stripe.V2.Core.Account;

/** Sections to include on every V2 account read. */
export const INCLUDE_ACCOUNT_SECTIONS: Stripe.V2.Core.AccountRetrieveParams.Include[] = [
    "configuration.merchant",
    "configuration.recipient",
    "configuration.customer",
    "requirements",
];

/**
 * Derive the admin-page-compatible requirements shape from a V2 account.
 *
 * V2 `Account.Requirements` is `{ entries, summary }`, NOT the V1 top-level
 * `currently_due / past_due / eventually_due` arrays. Each entry carries a
 * `minimum_deadline.status` (`currently_due | eventually_due | past_due`) and
 * a human-readable `description`.
 */
export function getV2Requirements(account: StripeAccountV2) {
    const entries = account.requirements?.entries ?? [];

    const due = (status: string) =>
        entries
            .filter((e) => e.minimum_deadline?.status === status)
            .map((e) => e.description)
            .filter(Boolean);

    const currentDeadlineTime =
        account.requirements?.summary?.minimum_deadline?.time;

    return {
        currentlyDue: due("currently_due"),
        eventuallyDue: due("eventually_due"),
        pastDue: due("past_due"),
        currentDeadline: currentDeadlineTime
            ? new Date(currentDeadlineTime).getTime()
            : null,
    };
}

/**
 * Account status always comes from Stripe — the local DB flags are only a
 * cache. Readiness for direct charges == merchant `card_payments` active.
 *
 * Labels (dashboard):
 *   "Payments Active"      – card_payments active, nothing due
 *   "Requirements Due"     – currently/past due requirements open
 *   "Restricted"           – capability restricted
 *   "Stripe Connected"     – account exists, onboarding not finished
 *   "Onboarding Required"  – no account at all (handled by the caller)
 */
export function getV2AccountStatus(account: StripeAccountV2) {
    const cardPayments =
        account.configuration?.merchant?.capabilities
            ?.card_payments;

    const cardPaymentsStatus: string | null =
        cardPayments?.status ?? null;

    const paymentsActive = cardPaymentsStatus === "active";

    const recipientTransfers =
        account.configuration?.recipient?.capabilities
            ?.stripe_balance?.stripe_transfers;

    const transfersStatus: string | null =
        recipientTransfers?.status ?? null;

    // Kept for backward compatibility with the admin page, which reads
    // stripeConnect.{chargesEnabled, payoutsEnabled, requirements.*}.
    const chargesEnabled = paymentsActive;
    const payoutsEnabled = paymentsActive;

    const requirements = getV2Requirements(account);

    let statusLabel: string;
    if (cardPaymentsStatus === "restricted") {
        statusLabel = "Restricted";
    } else if (
        requirements.currentlyDue.length > 0 ||
        requirements.pastDue.length > 0
    ) {
        statusLabel = "Requirements Due";
    } else if (paymentsActive) {
        statusLabel = "Payments Active";
    } else {
        statusLabel = "Stripe Connected";
    }

    return {
        cardPaymentsStatus,
        transfersStatus,
        paymentsActive,
        chargesEnabled,
        payoutsEnabled,
        requirements,
        statusLabel,
        accountClosed: Boolean(account.closed),
    };
}

export type V2AccountStatus = ReturnType<typeof getV2AccountStatus>;

/**
 * Persist the Stripe-derived status into the local cache at
 * `users/{uid}/stripeConnect` and maintain the `stripeAccounts/{accountId}`
 * reverse index used by the storefront and webhooks to resolve accountId → UID
 * (RTDB cannot deep-query).
 */
export async function cacheStripeConnectStatus(
    uid: string,
    accountId: string,
    status: V2AccountStatus,
    extra: { onboardedAt?: number | null } = {}
) {
    const now = Date.now();

    await adminDatabase
        .ref(`users/${uid}/stripeConnect`)
        .update({
            accountId,
            chargesEnabled: status.chargesEnabled,
            payoutsEnabled: status.payoutsEnabled,
            requirements: status.requirements,
            statusLabel: status.statusLabel,
            paymentsActive: status.paymentsActive,
            cardPaymentsStatus: status.cardPaymentsStatus,
            transfersStatus: status.transfersStatus,
            ...(extra.onboardedAt !== undefined
                ? { onboardedAt: extra.onboardedAt }
                : {}),
            updatedAt: now,
        });

    // Reverse index so `/store/[accountId]` and thin-event webhooks can
    // resolve the owning developer without a deep query.
    await adminDatabase
        .ref(`stripeAccounts/${accountId}`)
        .set({
            uid,
            accountId,
            updatedAt: now,
        });
}