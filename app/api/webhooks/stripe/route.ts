import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDatabase } from "@/lib/firebase-admin";
import { stripeClient } from "@/lib/stripe";
import {
    INCLUDE_ACCOUNT_SECTIONS,
    cacheStripeConnectStatus,
    getV2AccountStatus,
} from "@/lib/stripe-connect-utils";

export const runtime = "nodejs";

/*
 * =============================================================================
 * Stripe webhook endpoint
 * =============================================================================
 *
 * Single endpoint for BOTH delivery modes:
 *
 * 1. V1 webhook events (donations, platform subscriptions, marketplace product
 *    licenses, and — when connected-account events are forwarded here — store
 *    orders). Verified with `stripeClient.webhooks.constructEvent(...)`.
 *
 * 2. V2 thin events delivered via an Event Destination
 *    (`object === "v2.core.event_notification"` / `v2.`-prefixed type).
 *    Verified with `stripeClient.parseEventNotification(...)` and handled by
 *    refreshing the affected account's status straight from Stripe.
 *
 * Connect V2 note on delivery: sessions created on a connected account
 * ("Direct Charge" / `customer_account` subscriptions) belong to that account,
 * so their events are delivered to the account's event destination / Connect
 * webhook endpoint, not the platform's standard endpoint. Point the Connect
 * forwarding at this same route (e.g. `stripe listen --forward-connect-to
 * http://localhost:3000/api/webhooks/stripe`) and the metadata written by
 * `/api/store/checkout` tells us which order to finalize.
 *
 * Every event is claimed once in `webhook_events/{eventId}` (V2 thin events
 * keyed `v2:{id}`) so a redelivery cannot double-process.
 */

function createLicenseId(orderId: string) {
    return `lic_${orderId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function createLicenseKey() {
    return `ALG-${crypto
        .randomUUID()
        .replace(/-/g, "")
        .slice(0, 16)
        .toUpperCase()}`;
}

/**
 * Credit a referrer when a referred user makes a purchase.
 * Reads the commissionRate from settings, resolves the referrer UID,
 * and writes an earning record.
 */
async function creditReferrerCommission(
    buyerUserId: string,
    referredByCode: string,
    orderId: string,
    purchaseAmount: number,
    productName: string,
) {
    if (!referredByCode || !buyerUserId || !orderId || purchaseAmount <= 0) return;

    try {
        // Resolve referrer UID from the referral code
        const codeSnap = await adminDatabase
            .ref(`referral_codes/${referredByCode}`)
            .get();

        if (!codeSnap.exists()) {
            console.log("REFERRAL: Code not found:", referredByCode);
            return;
        }

        const referrerUid = codeSnap.val() as string;

        // Don't self-refer
        if (referrerUid === buyerUserId) {
            console.log("REFERRAL: Self-referal blocked:", buyerUserId);
            return;
        }

        // Read commission rate from admin settings
        const settingsSnap = await adminDatabase
            .ref("settings/commissionRate")
            .get();
        const commissionRate = Number(settingsSnap.val()) || 15;

        const commissionCents = Math.round(purchaseAmount * (commissionRate / 100));
        const commissionUsd = commissionCents / 100;

        const now = Date.now();
        const earningId = orderId;

        // Write the earning record
        await adminDatabase
            .ref(`referral_earnings/${referrerUid}/${earningId}`)
            .set({
                orderId,
                buyerUserId,
                referredByCode,
                productName: productName || "Purchase",
                purchaseAmountCents: purchaseAmount,
                commissionRate,
                commissionCents,
                commissionUsd,
                status: "completed",
                createdAt: now,
                updatedAt: now,
            });

        // Increment total earnings on the referral stats
        const statsRef = adminDatabase.ref(
            `referrals/${referrerUid}/${referredByCode}`
        );
        const statsSnap = await statsRef.get();
        const stats = statsSnap.val() || {};
        const currentEarnings = Number(stats.totalEarningsCents) || 0;
        const currentPaid = Number(stats.totalPaidCents) || 0;

        await statsRef.update({
            totalEarningsCents: currentEarnings + commissionCents,
            totalPaidCents: currentPaid,
            lastPurchaseAt: now,
            updatedAt: now,
        });

        // Log a purchase event
        await adminDatabase
            .ref(`referrals/${referrerUid}/${referredByCode}/events`)
            .push({
                type: "purchase",
                orderId,
                productName,
                commissionCents,
                buyerUserId,
                createdAt: now,
            });

        console.log(
            "REFERRAL COMMISSION CREDITED:",
            referredByCode,
            "referrer:",
            referrerUid,
            "commission:",
            commissionUsd,
            "USD"
        );
    } catch (err) {
        console.error("REFERRAL COMMISSION ERROR:", err);
    }
}

/**
 * V2 thin-event shape vs V1 event shape. Thin events have
 * `object === "v2.core.event_notification"` (and always a `v2.`-prefixed
 * type); V1 webhook events have `object === "event"`.
 */
function looksLikeV2ThinEvent(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== "object") return false;
    const obj = parsed as { object?: unknown; type?: unknown };
    return (
        obj.object === "v2.core.event_notification" ||
        (typeof obj.type === "string" && obj.type.startsWith("v2."))
    );
}

/**
 * Event-level idempotency. Atomically claim `webhook_events/{eventId}`; a
 * concurrent or repeated delivery of the same event sees the claim and is
 * short-circuited. If processing fails, the caller releases the claim so the
 * retry reprocesses the event.
 */
async function tryClaimEvent(eventId: string): Promise<boolean> {
    const ref = adminDatabase.ref(`webhook_events/${eventId}`);
    let claimed = false;
    await ref.transaction((current) => {
        if (current && current.processedAt) {
            // Already claimed — leave it untouched.
            return current;
        }
        claimed = true;
        return { eventId, processedAt: Date.now() };
    });
    return claimed;
}

async function releaseEventClaim(eventId: string) {
    await adminDatabase
        .ref(`webhook_events/${eventId}`)
        .remove()
        .catch(() => undefined);
}

/**
 * Sync a new status to every record that references a subscription:
 * legacy platform records `users/{uid}/subscription` and
 * `users/{uid}/developerSubscription` (queried by stripeSubscriptionId), plus
 * the store-connected mirror `subscriptions/{uid}/{subscriptionId}`.
 */
async function updateSubscriptionStatus(
    subscriptionId: string,
    status: string
) {
    if (!subscriptionId) return false;
    let matched = false;
    const now = Date.now();

    const byUser = await adminDatabase
        .ref("users")
        .orderByChild("subscription/stripeSubscriptionId")
        .equalTo(subscriptionId)
        .get();

    if (byUser.hasChildren()) {
        for (const userId of Object.keys(byUser.val())) {
            matched = true;
            await adminDatabase
                .ref(`users/${userId}/subscription`)
                .update({ status, updatedAt: now });
        }
    }

    const byDev = await adminDatabase
        .ref("users")
        .orderByChild("developerSubscription/stripeSubscriptionId")
        .equalTo(subscriptionId)
        .get();

    if (byDev.hasChildren()) {
        for (const userId of Object.keys(byDev.val())) {
            matched = true;
            await adminDatabase
                .ref(`users/${userId}/developerSubscription`)
                .update({ status, updatedAt: now });
        }
    }

    // Store-connected subscription mirror: subscriptions/{uid}/{subscriptionId}.
    const subsSnap = await adminDatabase.ref("subscriptions").get();
    if (subsSnap.exists()) {
        const byUid = subsSnap.val();
        for (const [uid, subs] of Object.entries<Record<string, unknown>>(byUid)) {
            if (
                subs &&
                typeof subs === "object" &&
                subscriptionId in subs
            ) {
                matched = true;
                await adminDatabase
                    .ref(`subscriptions/${uid}/${subscriptionId}`)
                    .update({ status, updatedAt: now });
            }
        }
    }

    return matched;
}

/**
 * V2 thin events for account status: resolve the owning developer from the
 * `stripeAccounts/{accountId}` reverse index and refresh the cached status
 * from Stripe (never from the event payload alone). Errors propagate so the
 * caller releases the event claim and Stripe retries.
 */
async function refreshV2AccountStatus(accountId: string) {
    if (!accountId) return;

    const indexSnap = await adminDatabase
        .ref(`stripeAccounts/${accountId}`)
        .get();
    const index = indexSnap.val();
    const uid = index?.uid;

    if (!uid) {
        console.log("V2 EVENT: no reverse index for account:", accountId);
        return;
    }

    const account = await stripeClient.v2.core.accounts.retrieve(
        accountId,
        { include: INCLUDE_ACCOUNT_SECTIONS }
    );
    const status = getV2AccountStatus(account);

    await cacheStripeConnectStatus(uid, accountId, status);

    if (status.accountClosed) {
        await adminDatabase
            .ref(`users/${uid}/stripeConnect`)
            .update({
                accountClosed: true,
                updatedAt: Date.now(),
            });
    }

    console.log(
        "V2 ACCOUNT STATUS REFRESHED:",
        accountId,
        status.statusLabel
    );
}

/**
 * Process a verified V2 thin event (already signature-checked). The caller
 * already claimed the event idempotency key; failures bubble up so the claim
 * is released and the event is retried.
 */
async function handleV2ThinEvent(
    notification: Stripe.V2.Core.EventNotification
) {
    const type = notification.type;

    console.log("STRIPE V2 WEBHOOK:", type);

    // Ping used to test an Event Destination connection — acknowledge only.
    if (type === "v2.core.event_destination.ping") {
        return;
    }

    // account_link.returned carries no related_object; the follow-up
    // requirements/capability events refresh the status. It matches the
    // `v2.core.account` prefix below, so it must be handled first.
    if (type === "v2.core.account_link.returned") {
        console.log("V2 EVENT: account link returned (onboarding reference)");
        return;
    }

    // All account events (requirements/capability/created/updated/closed)
    // refresh the cached status for the affected developer. `related_object`
    // is absent on some EventNotification union members, so narrow first.
    if (type.startsWith("v2.core.account")) {
        const related =
            "related_object" in notification
                ? notification.related_object
                : null;
        const accountId = related?.id || null;
        if (accountId) {
            await refreshV2AccountStatus(accountId);
        } else {
            console.log("V2 EVENT: no related account for", type);
        }
        return;
    }

    console.log("V2 EVENT: unhandled thin event", type);
}

export async function POST(request: NextRequest) {
    console.log("🔥 STRIPE WEBHOOK ROUTE HIT");

    const body = await request.text();

    const signature = request.headers.get("stripe-signature");

    if (!signature) {
        return NextResponse.json(
            { error: "Missing Stripe signature." },
            { status: 400 }
        );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        return NextResponse.json(
            { error: "STRIPE_WEBHOOK_SECRET is not configured." },
            { status: 500 }
        );
    }

    // Thin events are signed with the Event Destination's secret. Production
    // deployments should set STRIPE_V2_WEBHOOK_SECRET to that value; when
    // unset (e.g. local `stripe listen --thin-events`) we fall back to the
    // regular webhook secret.
    const v2WebhookSecret =
        process.env.STRIPE_V2_WEBHOOK_SECRET || webhookSecret;

    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return NextResponse.json(
            { error: "Invalid Stripe payload." },
            { status: 400 }
        );
    }

    // ----------------------------------------------------------------
    // V2 THIN EVENT PATH
    // ----------------------------------------------------------------
    if (looksLikeV2ThinEvent(parsed)) {
        const eventKey = `v2:${(parsed as { id?: string })?.id ?? "unknown"}`;

        if (!(await tryClaimEvent(eventKey))) {
            return NextResponse.json({
                received: true,
                alreadyProcessed: true,
            });
        }

        try {
            const notification = stripeClient.parseEventNotification(
                body,
                signature,
                v2WebhookSecret
            );

            await handleV2ThinEvent(notification);
        } catch (error: unknown) {
            console.error("STRIPE V2 WEBHOOK ERROR:", error);
            await releaseEventClaim(eventKey);
            return NextResponse.json(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : "V2 webhook processing failed.",
                },
                { status: 400 }
            );
        }

        return NextResponse.json({ received: true });
    }

    // ----------------------------------------------------------------
    // V1 WEBHOOK EVENT PATH
    // ----------------------------------------------------------------
    let event: Stripe.Event;
    try {
        event = stripeClient.webhooks.constructEvent(
            body,
            signature,
            webhookSecret
        );
    } catch (error: unknown) {
        console.error("STRIPE WEBHOOK SIGNATURE ERROR:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Webhook signature verification failed.",
            },
            { status: 400 }
        );
    }

    console.log("STRIPE WEBHOOK:", event.type);

    // Phase 6: Emit canonical business event for verified server-side Stripe events
    try {
      const { createEvent } = await import("@/lib/business-events/events");
      const { dispatcher } = await import("@/lib/business-events/dispatcher");
      if (["payment_intent.succeeded", "checkout.session.completed"].includes(event.type)) {
        await dispatcher.dispatch(createEvent("payment.succeeded", "payment", event.id || event.data.object?.id || "unknown", { stripeEventId: event.id, amount: (event.data.object as any)?.amount_total || 0 }));
      } else if (event.type === "payment_intent.payment_failed") {
        await dispatcher.dispatch(createEvent("payment.failed", "payment", event.id || event.data.object?.id || "unknown", { stripeEventId: event.id }));
      } else if (event.type === "charge.refunded") {
        await dispatcher.dispatch(createEvent("payment.refunded", "payment", event.id || event.data.object?.id || "unknown", { stripeEventId: event.id }));
      }
    } catch { /* event must never break webhook */ }

    const eventKey = event.id;

    if (!(await tryClaimEvent(eventKey))) {
        return NextResponse.json({
            received: true,
            alreadyProcessed: true,
        });
    }

    try {
        /*
         * --------------------------------------------------
         * Subscription lifecycle events
         *
         * invoice.paid / invoice.payment_failed carry an Invoice whose
         * `subscription` field names the subscription; subscription events
         * carry the Subscription object directly. Status always comes from
         * the webhook (never the checkout redirect).
         * --------------------------------------------------
         */
        const subscriptionEvents = new Set([
            "customer.subscription.updated",
            "customer.subscription.deleted",
            "customer.subscription.created",
        ]);

        if (subscriptionEvents.has(event.type)) {
            const sub = event.data.object as Stripe.Subscription;
            const newStatus =
                event.type === "customer.subscription.deleted"
                    ? "canceled"
                    : sub.status || "active";

            const matched = await updateSubscriptionStatus(
                sub.id,
                newStatus
            );

            return NextResponse.json({
                received: true,
                subscriptionUpdated: true,
                status: newStatus,
                matched,
            });
        }

        if (
            event.type === "invoice.paid" ||
            event.type === "invoice.payment_failed"
        ) {
            const invoice = event.data.object as Stripe.Invoice;
            // `subscription` is not part of the SDK Invoice type for API
            // v2442; the field is a plain subscription ID string.
            const invoiceRecord = invoice as unknown as {
                subscription?: string | { id?: string } | null;
            };
            const subscriptionId =
                typeof invoiceRecord.subscription === "string"
                    ? invoiceRecord.subscription
                    : invoiceRecord.subscription?.id || null;

            if (subscriptionId) {
                const newStatus =
                    event.type === "invoice.paid"
                        ? "active"
                        : "past_due";
                await updateSubscriptionStatus(subscriptionId, newStatus);
            }

            return NextResponse.json({
                received: true,
                invoiceHandled: true,
                subscriptionId,
                status:
                    event.type === "invoice.paid"
                        ? "active"
                        : "past_due",
            });
        }

        /*
         * --------------------------------------------------
         * Acknowledge-only events (customer/payment-method/billing portal)
         *
         * These change data owned by the buyer's Customer or Billing Portal.
         * They need no local DB write today; logging them keeps the endpoint
         * honest when configured for `*` in the dashboard.
         * --------------------------------------------------
         */
        const ackOnlyEvents = new Set([
            "payment_method.attached",
            "payment_method.detached",
            "payment_method.updated",
            "customer.updated",
            "customer.tax_id.created",
            "customer.tax_id.updated",
            "customer.tax_id.deleted",
            "billing_portal.configuration.created",
            "billing_portal.configuration.updated",
            "billing_portal.session.created",
        ]);

        if (ackOnlyEvents.has(event.type)) {
            console.log("STRIPE WEBHOOK ACK (no local write):", event.type);
            return NextResponse.json({
                received: true,
                acknowledged: true,
            });
        }

        if (event.type !== "checkout.session.completed") {
            return NextResponse.json({
                received: true,
                ignored: true,
            });
        }

        const session = event.data.object as Stripe.Checkout.Session;

        // --------------------------------------------------
        // Donation flow (separate from product purchase)
        // --------------------------------------------------
        if (session.metadata?.orderType === "donation") {
            if (session.payment_status !== "paid") {
                return NextResponse.json({ received: true });
            }

            const donationId = session.metadata?.donationId;
            const donorUserId = session.metadata?.userId;
            const rewardIds = JSON.parse(
                session.metadata?.rewardIds || "[]"
            ) as string[];

            if (donationId && donorUserId) {
                const donationRef = adminDatabase.ref(
                    `donations/${donorUserId}/${donationId}`
                );

                await donationRef.update({
                    status: "completed",
                    stripeSessionId: session.id,
                    paidAt: Date.now(),
                    updatedAt: Date.now(),
                    rewardIds,
                });

                // Write reward grants so download route can check them
                if (
                    donorUserId !== "guest" &&
                    rewardIds.length > 0
                ) {
                    for (const rewardProductId of rewardIds) {
                        await adminDatabase
                            .ref(
                                `donation_rewards/${donorUserId}/${rewardProductId}`
                            )
                            .set({
                                productId: rewardProductId,
                                donationId,
                                grantedAt: Date.now(),
                                status: "active",
                            });
                    }
                }

                console.log(
                    "DONATION COMPLETED:",
                    donationId,
                    "Rewards:",
                    rewardIds
                );
            }

            return NextResponse.json({
                received: true,
                donationProcessed: true,
                donationId,
            });
        }

        /*
         * --------------------------------------------------
         * Payment must actually be paid
         * --------------------------------------------------
         */
        if (session.payment_status !== "paid") {
            console.log(
                "Stripe session is not paid:",
                session.id,
                session.payment_status
            );

            return NextResponse.json({
                received: true,
                paymentStatus: session.payment_status,
            });
        }

        /*
         * --------------------------------------------------
         * Read metadata
         * --------------------------------------------------
         */
        const orderId = session.metadata?.orderId;
        const userId = session.metadata?.userId;
        const orderType = session.metadata?.orderType;

        /*
         * --------------------------------------------------
         * STORE FLOW (Direct Charge)
         *
         * Orders created by /api/store/checkout on a developer's connected
         * account. The order is finalized here — webhook-confirmed state,
         * never the checkout redirect. Subscription mode additionally mirrors
         * the subscription to subscriptions/{buyerUid}/{subscriptionId}.
         * --------------------------------------------------
         */
        if (orderType === "store" || session.metadata?.storeAccountId) {
            const storeAccountId = session.metadata?.storeAccountId;
            const stripeProductId = session.metadata?.stripeProductId;
            const mode = session.metadata?.mode || "payment";

            if (!orderId || !userId || !storeAccountId) {
                console.error(
                    "Missing store checkout metadata."
                );
                return NextResponse.json(
                    { error: "Missing checkout metadata." },
                    { status: 400 }
                );
            }

            const orderRef = adminDatabase.ref(
                `orders/${userId}/${orderId}`
            );
            const orderSnapshot = await orderRef.get();

            if (!orderSnapshot.exists()) {
                console.error("Store order not found:", orderId);
                return NextResponse.json(
                    { error: "Order not found." },
                    { status: 404 }
                );
            }

            const order = orderSnapshot.val();

            if (order.status === "paid" || order.paymentStatus === "paid") {
                console.log(
                    "Store order already processed:",
                    orderId
                );
                return NextResponse.json({
                    received: true,
                    alreadyProcessed: true,
                    orderId,
                });
            }

            // Seller resolved from the reverse index (never the client).
            const sellerIndexSnap = await adminDatabase
                .ref(`stripeAccounts/${storeAccountId}`)
                .get();
            const sellerIndex = sellerIndexSnap.val();
            const sellerUid = sellerIndex?.uid
                ? String(sellerIndex.uid)
                : order.sellerUid || null;

            if (!sellerUid) {
                console.error(
                    "No seller for store account:",
                    storeAccountId
                );
                return NextResponse.json(
                    { error: "No Stripe Connect account is configured for this developer." },
                    { status: 400 }
                );
            }

            /*
             * Verify amount. Compare against the server-created order record
             * (amount came from the connected-account price server-side) and,
             * when reachable, the live connected-account price. Subscriptions
             * with no immediate charge legitimately differ — skip the strict
             * check there.
             */
            const expectedCents = Math.round(
                Number(order.amount ?? order.price ?? 0) * 100
            );

            if (
                mode !== "subscription" &&
                typeof session.amount_total === "number"
            ) {
                let liveExpected: number | null = null;
                if (order.stripePriceId) {
                    try {
                        const livePrice = await stripeClient.prices.retrieve(
                            order.stripePriceId,
                            {},
                            { stripeAccount: storeAccountId }
                        );
                        liveExpected = livePrice.unit_amount ?? null;
                    } catch {
                        // Connected price unreachable from this webhook —
                        // fall back to the order record.
                    }
                }

                const expected = liveExpected ?? expectedCents;

                if (session.amount_total !== expected) {
                    console.error(
                        "STORE WEBHOOK: payment amount mismatch.",
                        {
                            orderId,
                            expected,
                            actualPrice: session.amount_total,
                        }
                    );
                    return NextResponse.json(
                        { error: "Payment verification failed." },
                        { status: 400 }
                    );
                }
            }

            const paidAt = order.paidAt || Date.now();

            await orderRef.update({
                userId,
                orderType: "store",
                storeAccountId,
                sellerUid,
                stripeProductId:
                    stripeProductId || order.stripeProductId || null,
                status: "paid",
                paymentStatus: "paid",
                paymentProvider: "stripe",
                stripeSessionId: session.id,
                stripePaymentIntent:
                    typeof session.payment_intent === "string"
                        ? session.payment_intent
                        : null,
                buyerEmail:
                    session.customer_details?.email ||
                    session.customer_details?.name ||
                    order.buyerEmail ||
                    null,
                paidAt,
                updatedAt: Date.now(),
            });

            // Mirror the connected subscription so /api/store/subscription-status
            // and lifecycle events can resolve it without guessing.
            if (mode === "subscription") {
                const subscriptionId =
                    typeof session.subscription === "string"
                        ? session.subscription
                        : session.subscription?.id || null;

                if (subscriptionId) {
                    await adminDatabase
                        .ref(`subscriptions/${userId}/${subscriptionId}`)
                        .set({
                            accountId: storeAccountId,
                            stripeAccountId: storeAccountId,
                            sellerUid,
                            productId: stripeProductId || order.stripeProductId || null,
                            priceId: order.stripePriceId || null,
                            orderId,
                            status: "active",
                            stripeSessionId: session.id,
                            customerAccountId: session.customer_account || null,
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                        });
                }
            }

            console.log("STORE PAYMENT COMPLETED:", orderId);

            return NextResponse.json({
                received: true,
                success: true,
                orderId,
                store: true,
            });
        }

        /*
         * --------------------------------------------------
         * SUBSCRIPTION FLOW
         *
         * Subscription orders don't have a productId.
         * Set the user's subscription status directly.
         * --------------------------------------------------
         */
        if (orderType === "subscription" || orderId?.startsWith("sub_")) {
            if (!orderId || !userId) {
                console.error(
                    "Missing subscription checkout metadata."
                );
                return NextResponse.json(
                    { error: "Missing checkout metadata." },
                    { status: 400 }
                );
            }

            const plan =
                session.metadata?.plan ||
                (orderId.startsWith("sub_")
                    ? orderId.slice(4, orderId.lastIndexOf("_")) ||
                      orderId.split("_")[1]
                    : "pro");

            const planTier =
                session.metadata?.planTier ||
                (plan.startsWith("dev_") ? "dev" : "pro");

            const orderRef = adminDatabase.ref(
                `orders/${userId}/${orderId}`
            );
            const orderSnapshot = await orderRef.get();

            if (!orderSnapshot.exists()) {
                console.error(
                    "Subscription order not found:",
                    orderId
                );
                return NextResponse.json(
                    { error: "Order not found." },
                    { status: 404 }
                );
            }

            // Already fully processed.
            const order = orderSnapshot.val();

            if (order.status === "paid" && order.licenseId) {
                console.log(
                    "Subscription already processed:",
                    orderId
                );
                return NextResponse.json({
                    received: true,
                    alreadyProcessed: true,
                    orderId,
                });
            }

            const subscriptionRef = adminDatabase.ref(
                `users/${userId}/subscription`
            );

            const stripeCustomerId =
                typeof session.customer === "string"
                    ? session.customer
                    : session.customer?.id || null;

            await subscriptionRef.set({
                plan,
                status: "active",
                orderId,
                stripeSessionId: session.id,
                stripeSubscriptionId:
                    typeof session.subscription === "string"
                        ? session.subscription
                        : session.subscription?.id || null,
                stripeCustomerId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });

            if (planTier === "dev") {
                const stripeAccountId =
                    typeof session.subscription === "string"
                        ? session.subscription
                        : session.subscription?.id || null;

                await adminDatabase.ref(
                    `users/${userId}/developerSubscription`
                ).set({
                    plan,
                    status: "active",
                    orderId,
                    stripeSessionId: session.id,
                    stripeSubscriptionId: stripeAccountId,
                    stripeCustomerId,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });

                await adminDatabase.ref(
                    `users/${userId}/developerPlan`
                ).set(plan);
            }

            await orderRef.update({
                userId,
                plan,
                planTier,
                orderType: "subscription",
                status: "paid",
                paymentStatus: "paid",
                paymentProvider: "stripe",
                stripeSessionId: session.id,
                stripePaymentIntent:
                    typeof session.payment_intent === "string"
                        ? session.payment_intent
                        : null,
                stripeSubscriptionId:
                    typeof session.subscription === "string"
                        ? session.subscription
                        : session.subscription?.id || null,
                stripeCustomerId,
                paidAt: Date.now(),
                updatedAt: Date.now(),
            });

            console.log(
                "SUBSCRIPTION COMPLETED:",
                orderId,
                "plan:",
                plan
            );

            // Credit referrer commission for subscription purchases
            const subReferredBy = session.metadata?.referredBy || "";
            const subPriceCents = Math.round(Number(session.metadata?.price || 0) * 100);
            if (subReferredBy && userId) {
                await creditReferrerCommission(userId, subReferredBy, orderId, subPriceCents, `Subscription: ${plan}`);
            }

            return NextResponse.json({
                received: true,
                success: true,
                orderId,
                subscription: true,
                plan,
            });
        }

        /*
         * --------------------------------------------------
         * PLUGIN / EXTENSION PURCHASE FLOW
         *
         * orderType === "plugin" writes a pluginLicenses/{uid}/{pluginId}
         * record and finalizes the order. Idempotent — duplicate webhook
         * deliveries never create duplicate grants.
         * --------------------------------------------------
         */

        if (orderType === "plugin" || orderId?.startsWith("plier_")) {
            if (!orderId || !userId) {
                console.error("Missing plugin checkout metadata.");
                return NextResponse.json({ error: "Missing checkout metadata." }, { status: 400 });
            }

            const pluginId = session.metadata?.pluginId || session.metadata?.productId;
            if (!pluginId) {
                console.error("Plugin checkout missing pluginId.");
                return NextResponse.json({ error: "Missing pluginId metadata." }, { status: 400 });
            }

            const pluginRef = adminDatabase.ref(`plugins/${pluginId}`);
            const pluginSnap = await pluginRef.get();
            if (!pluginSnap.exists()) {
                return NextResponse.json({ error: "Plugin not found." }, { status: 404 });
            }
            const plugin = pluginSnap.val();

            const pluginOrderRef = adminDatabase.ref(`orders/${userId}/${orderId}`);
            const pluginOrderSnap = await pluginOrderRef.get();
            if (!pluginOrderSnap.exists()) {
                return NextResponse.json({ error: "Order not found." }, { status: 404 });
            }
            const pluginOrder = pluginOrderSnap.val();

            if (pluginOrder.status === "paid" && pluginOrder.licenseId) {
                return NextResponse.json({ received: true, alreadyProcessed: true, licenseId: pluginOrder.licenseId });
            }

            // Amount/currency verification against the plugin manifest.
            const expectedPrice = Math.round(Number(plugin.pricing?.price || 0) * 100);
            const expectedCurrency = String(plugin.pricing?.currency || "usd").toLowerCase();
            if (session.amount_total !== expectedPrice) {
                return NextResponse.json({ error: "Payment verification failed (amount mismatch for plugin)." }, { status: 400 });
            }
            if (session.currency && session.currency.toLowerCase() !== expectedCurrency) {
                return NextResponse.json({ error: "Payment verification failed (currency mismatch for plugin)." }, { status: 400 });
            }

            const startedAt = Date.now();
            const isSubscription = plugin.pricing?.type === "subscription";
            const intervalMonths = Number(plugin.pricing?.intervalMonths || (isSubscription ? 1 : 0));
            const expiresAt = isSubscription
                ? new Date(new Date(startedAt).setUTCMonth(new Date(startedAt).getUTCMonth() + intervalMonths)).getTime()
                : 0;

            const licenseId = `plice_${orderId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
            const licenseRef = adminDatabase.ref(`pluginLicenses/${userId}/${pluginId}`);
            const existingLicense = await licenseRef.get();

            if (!existingLicense.exists()) {
                await licenseRef.set({
                    id: licenseId,
                    pluginId,
                    pluginName: plugin.displayName || plugin.name || "Plugin",
                    userId,
                    orderId,
                    pricingType: isSubscription ? "subscription" : "one_time",
                    amount: Math.round(session.amount_total || 0) / 100,
                    currency: expectedCurrency,
                    status: "active",
                    stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null,
                    startedAt,
                    expiresAt,
                    createdAt: startedAt,
                    updatedAt: startedAt,
                });
                console.log("PLUGIN LICENSE CREATED:", pluginId, userId);
            }

            await pluginOrderRef.update({
                userId,
                productId: pluginId,
                pluginId,
                productName: plugin.displayName || plugin.name || "",
                productSlug: plugin.slug || pluginId,
                productType: "plugin",
                orderType: "plugin",
                status: "paid",
                paymentStatus: "paid",
                paymentProvider: "stripe",
                stripeSessionId: session.id,
                stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
                licenseId,
                paidAt: pluginOrder.paidAt || startedAt,
                updatedAt: Date.now(),
            });

            // Notify the buyer that their plugin entitlement is live.
            const notifyRef = adminDatabase.ref(`notifications/${userId}`).push();
            await notifyRef.set({
                title: `✅ ${plugin.displayName || "Plugin"} activated`,
                message: `Your license for ${plugin.displayName || "Plugin"} is active. Install it from the Plugins marketplace.`,
                level: "success",
                link: "/marketplace/plugins/" + (plugin.slug || pluginId),
                read: false,
                createdAt: Date.now(),
            });

            const pluginReferredBy = session.metadata?.referredBy || "";
            if (pluginReferredBy && userId) {
                await creditReferrerCommission(userId, pluginReferredBy, orderId, session.amount_total || 0, `Plugin: ${plugin.displayName || plugin.name}`);
            }

            return NextResponse.json({ received: true, success: true, orderId, pluginId, licenseId });
        }

        /*
         * --------------------------------------------------
         * PRODUCT PURCHASE FLOW (existing logic)
         *
         * Product records live under `products/{id}` for developers and
         * `bots/{id}` for marketplace listings — try developers first, then
         * the marketplace.
         * --------------------------------------------------
         */
        const productId = session.metadata?.productId;

        if (!orderId || !userId || !productId) {
            console.error("Missing checkout metadata.");

            return NextResponse.json(
                { error: "Missing checkout metadata." },
                { status: 400 }
            );
        }

        const orderRef = adminDatabase.ref(
            `orders/${userId}/${orderId}`
        );
        const orderSnapshot = await orderRef.get();

        if (!orderSnapshot.exists()) {
            console.error("Order not found:", orderId);
            return NextResponse.json(
                { error: "Order not found." },
                { status: 404 }
            );
        }

        const order = orderSnapshot.val();

        // Verify ownership
        if (order.userId && order.userId !== userId) {
            console.error("Order user mismatch.");
            return NextResponse.json(
                { error: "Order ownership verification failed." },
                { status: 400 }
            );
        }

        // Already fully processed
        if (order.status === "paid" && order.licenseId) {
            console.log(
                "Order already fully processed:",
                orderId
            );
            return NextResponse.json({
                received: true,
                alreadyProcessed: true,
                licenseId: order.licenseId,
            });
        }

        // Load product (developers → marketplace fallback)
        let productSnapshot = await adminDatabase
            .ref(`products/${productId}`)
            .get();

        if (!productSnapshot.exists()) {
            productSnapshot = await adminDatabase
                .ref(`bots/${productId}`)
                .get();
        }

        if (!productSnapshot.exists()) {
            console.error("Product not found:", productId);
            return NextResponse.json(
                { error: "Product not found." },
                { status: 404 }
            );
        }

        const product = productSnapshot.val();

        // Verify amount and currency
        const expectedPrice = Math.round(
            Number(product.pricing?.price || 0) * 100
        );

        const expectedCurrency = String(
            product.pricing?.currency || "USD"
        ).toLowerCase();

        const actualCurrency = session.currency
            ? session.currency.toLowerCase()
            : "";

        if (
            session.amount_total !== expectedPrice ||
            (actualCurrency && actualCurrency !== expectedCurrency)
        ) {
            console.error(
                "Payment amount/currency mismatch.",
                {
                    orderId,
                    expectedPrice,
                    actualPrice: session.amount_total,
                    expectedCurrency,
                    actualCurrency,
                }
            );
            return NextResponse.json(
                { error: "Payment verification failed." },
                { status: 400 }
            );
        }

        /*
         * Deterministic License ID
         * The same order ALWAYS gets the same license ID.
         * This prevents duplicate licenses even if
         * webhook + verify run at the same time.
         */
        let licenseId = order.licenseId || null;

        if (product.license?.required) {
            licenseId = licenseId || createLicenseId(orderId);

            const licenseRef = adminDatabase.ref(
                `licenses/${userId}/${licenseId}`
            );
            const existingLicenseSnapshot = await licenseRef.get();

            if (!existingLicenseSnapshot.exists()) {
                const startedAt = Date.now();
                const durationDays = Number(
                    product.license?.durationDays || 30
                );
                const expiresAt =
                    startedAt +
                    durationDays * 24 * 60 * 60 * 1000;

                await licenseRef.set({
                    id: licenseId,
                    licenseKey: createLicenseKey(),
                    userId,
                    productId,
                    productName: product.name || "",
                    orderId,
                    status: "active",
                    startedAt,
                    expiresAt,
                    durationDays,
                    maxAccounts: Number(
                        product.license?.maxAccounts || 1
                    ),
                    mt5Account: null,
                    createdAt: startedAt,
                    updatedAt: startedAt,
                });

                console.log("LICENSE CREATED:", licenseId);
            } else {
                console.log("LICENSE ALREADY EXISTS:", licenseId);
            }
        }

        // Finalize order
        const paidAt = order.paidAt || Date.now();

        await orderRef.update({
            userId,
            productId,
            status: "paid",
            paymentStatus: "paid",
            paymentProvider: "stripe",
            stripeSessionId: session.id,
            stripePaymentIntent:
                typeof session.payment_intent === "string"
                    ? session.payment_intent
                    : null,
            developerUid:
                product.developerUid ||
                order.developerUid ||
                null,
            buyerEmail:
                session.customer_details?.email ||
                session.customer_details?.name ||
                order.buyerEmail ||
                null,
            paidAt,
            ...(licenseId
                ? {
                    licenseId,
                    licenseCreatedAt:
                        order.licenseCreatedAt || Date.now(),
                }
                : {}),
            updatedAt: Date.now(),
        });

        console.log("PAYMENT COMPLETED:", orderId);

        // Credit referrer commission for product purchases
        const purchaseReferredBy = session.metadata?.referredBy || "";
        const purchaseAmountCents = session.amount_total || 0;
        if (purchaseReferredBy && userId) {
            await creditReferrerCommission(
                userId,
                purchaseReferredBy,
                orderId,
                purchaseAmountCents,
                product?.name || "Product"
            );
        }

        return NextResponse.json({
            received: true,
            success: true,
            orderId,
            licenseId,
        });
    } catch (error: unknown) {
        console.error("STRIPE WEBHOOK ERROR:", error);
        await releaseEventClaim(eventKey);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Webhook processing failed.",
            },
            { status: 400 }
        );
    }
}