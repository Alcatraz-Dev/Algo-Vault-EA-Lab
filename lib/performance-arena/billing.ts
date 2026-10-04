// Performance Arena paid-checkout verification. This is a pure security
// boundary shared by the browser-return verifier and signed Stripe webhook.
// Never trust a success URL, browser callback, or `payment_status` in RTDB
// without matching it to the Stripe session created for the same order.

export interface ArenaPaymentOrder {
    orderId: string;
    userId: string;
    orderType: string;
    definitionId: string;
    stripeSessionId: string | null;
    priceCents?: number;
    price?: number;
    amount?: number;
    currency?: string;
}

export interface ArenaStripeSession {
    id: string;
    status: string | null;
    payment_status: string;
    mode: string;
    amount_total: number | null;
    currency: string | null;
    metadata: Record<string, string | undefined> | null;
}

export type ChallengePaymentCheck =
    | { ok: true; amountCents: number; definitionId: string }
    | { ok: false; code: string; message: string };

function rejected(code: string, message: string): ChallengePaymentCheck {
    return { ok: false, code, message };
}

/** Validate a challenge payment using only server-owned order data and Stripe's session. */
export function verifyChallengePayment(input: {
    uid: string;
    requestedOrderId: string;
    order: ArenaPaymentOrder;
    session: ArenaStripeSession;
}): ChallengePaymentCheck {
    const { uid, requestedOrderId, order, session } = input;
    if (!requestedOrderId || order.orderId !== requestedOrderId || order.userId !== uid) {
        return rejected("ORDER_OWNERSHIP_MISMATCH", "The checkout order does not belong to this account.");
    }
    if (order.orderType !== "challenge" || !order.definitionId) {
        return rejected("INVALID_CHALLENGE_ORDER", "This order is not a Performance Arena challenge purchase.");
    }
    if (!order.stripeSessionId || order.stripeSessionId !== session.id) {
        return rejected("SESSION_MISMATCH", "The Stripe session does not match the recorded checkout.");
    }

    const metadata = session.metadata ?? {};
    if (
        metadata.orderType !== "challenge" ||
        metadata.orderId !== requestedOrderId ||
        metadata.userId !== uid ||
        metadata.definitionId !== order.definitionId
    ) {
        return rejected("SESSION_METADATA_MISMATCH", "Stripe checkout metadata does not match this challenge order.");
    }
    if (session.status !== "complete" || session.payment_status !== "paid" || session.mode !== "payment") {
        return rejected("PAYMENT_PENDING", "Stripe has not confirmed a completed, paid challenge checkout.");
    }

    const configuredCents = Number.isSafeInteger(order.priceCents)
        ? Number(order.priceCents)
        : Math.round(Number(order.amount ?? order.price) * 100);
    if (!Number.isSafeInteger(configuredCents) || configuredCents <= 0 || session.amount_total !== configuredCents) {
        return rejected("PAYMENT_AMOUNT_MISMATCH", "The verified Stripe amount does not match the configured challenge fee.");
    }
    const expectedCurrency = String(order.currency ?? "USD").toLowerCase();
    if (!session.currency || session.currency.toLowerCase() !== expectedCurrency) {
        return rejected("PAYMENT_CURRENCY_MISMATCH", "The verified Stripe currency does not match the challenge order.");
    }

    return { ok: true, amountCents: configuredCents, definitionId: order.definitionId };
}
