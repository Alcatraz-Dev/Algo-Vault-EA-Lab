import { createSuite } from "./harness";
import { verifyChallengePayment, type ArenaPaymentOrder, type ArenaStripeSession } from "../billing";

const order: ArenaPaymentOrder = {
    orderId: "order_1",
    userId: "user_1",
    orderType: "challenge",
    definitionId: "paid-25k",
    stripeSessionId: "cs_1",
    priceCents: 2500,
    currency: "usd",
};
const session: ArenaStripeSession = {
    id: "cs_1",
    status: "complete",
    payment_status: "paid",
    mode: "payment",
    amount_total: 2500,
    currency: "usd",
    metadata: {
        orderId: "order_1",
        userId: "user_1",
        definitionId: "paid-25k",
        orderType: "challenge",
    },
};

export async function runBillingTests(): Promise<boolean> {
    const s = createSuite("billing-verification");
    const good = verifyChallengePayment({ uid: "user_1", requestedOrderId: "order_1", order, session });
    s.check(good.ok && good.amountCents === 2500 && good.definitionId === "paid-25k", "accepts exact completed paid session bound to server order");

    const reject = (label: string, overrides: {
        uid?: string;
        requestedOrderId?: string;
        order?: Partial<ArenaPaymentOrder>;
        session?: Partial<ArenaStripeSession>;
    }, expectedCode: string) => {
        const result = verifyChallengePayment({
            uid: overrides.uid ?? "user_1",
            requestedOrderId: overrides.requestedOrderId ?? "order_1",
            order: { ...order, ...overrides.order },
            session: { ...session, ...overrides.session },
        });
        s.check(!result.ok && result.code === expectedCode, label);
    };

    reject("denies another user", { uid: "attacker" }, "ORDER_OWNERSHIP_MISMATCH");
    reject("denies changed order ID", { requestedOrderId: "other_order" }, "ORDER_OWNERSHIP_MISMATCH");
    reject("denies non-challenge order", { order: { orderType: "subscription" } }, "INVALID_CHALLENGE_ORDER");
    reject("denies mismatched Stripe session", { session: { id: "cs_other" } }, "SESSION_MISMATCH");
    reject("denies altered Stripe metadata", { session: { metadata: { ...session.metadata, definitionId: "other" } } }, "SESSION_METADATA_MISMATCH");
    reject("denies incomplete session", { session: { status: "open" } }, "PAYMENT_PENDING");
    reject("denies unpaid session", { session: { payment_status: "unpaid" } }, "PAYMENT_PENDING");
    reject("denies subscription checkout", { session: { mode: "subscription" } }, "PAYMENT_PENDING");
    reject("denies amount mismatch", { session: { amount_total: 1 } }, "PAYMENT_AMOUNT_MISMATCH");
    reject("denies currency mismatch", { session: { currency: "eur" } }, "PAYMENT_CURRENCY_MISMATCH");
    reject("denies missing configured amount", { order: { priceCents: undefined, price: undefined, amount: undefined } }, "PAYMENT_AMOUNT_MISMATCH");
    s.check(!verifyChallengePayment({ uid: "user_1", requestedOrderId: "order_1", order: { ...order, stripeSessionId: null }, session }).ok, "denies order with no bound checkout session");
    return s.finish();
}
