import Stripe from "stripe";

/**
 * ============================================================================
 * Single shared Stripe SDK client
 * ============================================================================
 *
 * Every server-side Stripe call in the platform goes through this one client.
 * The SDK determines the API version — we never hardcode an `apiVersion` here
 * (the installed `stripe@22.6.2` SDK tracks API version v2442).
 *
 * Why Connect V2?
 * --------------
 * Used to be V1 Express accounts (`type: "express"`) with a recipient
 * configuration and Stripe transfers. V1 account creation is deprecated and
 * the old payload also hit `capability_not_available_without_other_capability`
 * because `configuration.recipient.capabilities.stripe_balance.stripe_transfers`
 * was requested without the merchant `card_payments` prerequisite.
 *
 * We now create V2 accounts (`stripeClient.v2.core.accounts.create(...)`) with
 * both configurations requested together:
 *   - configuration.merchant.capabilities.card_payments (required prerequisite)
 *   - configuration.recipient.capabilities.stripe_balance.stripe_transfers
 * (enables developer payouts / separate-charge-and-transfer flows).
 *
 * AlgoVault is the merchant of record via Direct Charges with an application
 * fee (platform handles fees and losses), while also maintaining the recipient
 * transfer capability for backward compatibility.
 *
 * Secrets stay server-side
 * ------------------------
 * `STRIPE_SECRET_KEY` must never be exposed to the browser. This module is only
 * imported by API route handlers / server code. Do NOT create a
 * `NEXT_PUBLIC_STRIPE_SECRET_KEY` or similar.
 */
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
    throw new Error(
        "Stripe is not configured. Please set STRIPE_SECRET_KEY on the server."
    );
}

/** The one Stripe client. Use this everywhere; never call `new Stripe(...)` elsewhere. */
export const stripeClient = new Stripe(stripeSecretKey);

/**
 * Human-readable message from a Stripe/unknown error, safe for client
 * responses in development mode (mirrors the previous per-route helpers).
 */
export function formatStripeError(error: unknown): string {
    if (error instanceof Stripe.errors.StripeError) {
        return error.message || "Stripe request failed.";
    }
    return error instanceof Error ? error.message : String(error);
}

/**
 * Developer plan → platform application fee rate (fraction of each sale).
 *
 * This mirrors `DEVELOPER_PLANS` in `lib/subscription.ts`, which lives in
 * client code and must not be imported by server routes. Keep both in sync.
 *
 *   dev_starter   → 5%  (platform fee)
 *   dev_pro       → 2%
 *   dev_enterprise→ 0%
 */
export const DEVELOPER_FEE_RATES: Record<string, number> = {
    dev_starter: 0.05,
    dev_pro: 0.02,
    dev_enterprise: 0,
};

/** Resolve the application-fee rate for a developer plan (defaults to Starter 5%). */
export function platformFeeRate(
    plan: string | null | undefined
): number {
    if (plan && typeof DEVELOPER_FEE_RATES[plan] === "number") {
        return DEVELOPER_FEE_RATES[plan];
    }
    return DEVELOPER_FEE_RATES.dev_starter;
}