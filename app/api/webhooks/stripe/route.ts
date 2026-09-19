import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDatabase } from "@/lib/firebase-admin";

const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY || ""
);

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

export async function POST(
    request: NextRequest
) {
    console.log("🔥 STRIPE WEBHOOK ROUTE HIT");

    const body = await request.text();

    const signature =
        request.headers.get("stripe-signature");

    if (!signature) {
        return NextResponse.json(
            {
                error: "Missing Stripe signature.",
            },
            { status: 400 }
        );
    }

    try {
        const webhookSecret =
            process.env.STRIPE_WEBHOOK_SECRET;

        if (!webhookSecret) {
            throw new Error(
                "STRIPE_WEBHOOK_SECRET is not configured."
            );
        }

        const event =
            stripe.webhooks.constructEvent(
                body,
                signature,
                webhookSecret
            );

        console.log(
            "STRIPE WEBHOOK:",
            event.type
        );

        /*
         * --------------------------------------------------
         * Only process completed checkout sessions
         * --------------------------------------------------
         */

        /*
         * --------------------------------------------------
         * Handle subscription lifecycle events
         * --------------------------------------------------
         */

        const subscriptionEvents = new Set([
            "customer.subscription.deleted",
            "customer.subscription.updated",
            "invoice.payment_failed",
        ]);

        if (subscriptionEvents.has(event.type)) {
            const sub = event.data.object as Stripe.Subscription;
            const subscriptionId = sub.id;
            const newStatus = event.type === "customer.subscription.deleted"
                ? "canceled"
                : event.type === "invoice.payment_failed"
                    ? "past_due"
                    : sub.status;

            const customersSnap = await adminDatabase
                .ref("users")
                .orderByChild("subscription/stripeSubscriptionId")
                .equalTo(subscriptionId)
                .get();

            const devCustomersSnap = await adminDatabase
                .ref("users")
                .orderByChild("developerSubscription/stripeSubscriptionId")
                .equalTo(subscriptionId)
                .get();

            if (customersSnap.hasChildren()) {
                const userId = Object.keys(
                    customersSnap.val()
                )[0];

                await adminDatabase.ref(
                    `users/${userId}/subscription`
                ).update({
                    status: newStatus,
                    updatedAt: Date.now(),
                });
            }

            if (devCustomersSnap.hasChildren()) {
                const userId = Object.keys(
                    devCustomersSnap.val()
                )[0];

                await adminDatabase.ref(
                    `users/${userId}/developerSubscription`
                ).update({
                    status: newStatus,
                    updatedAt: Date.now(),
                });
            }

            return NextResponse.json({
                received: true,
                subscriptionUpdated: true,
                status: newStatus,
            });
        }

        if (
            event.type !==
            "checkout.session.completed"
        ) {
            return NextResponse.json({
                received: true,
                ignored: true,
            });
        }

        const session =
            event.data.object as Stripe.Checkout.Session;

        // --------------------------------------------------
        // Donation flow (separate from product purchase)
        // --------------------------------------------------
        if (
            session.metadata?.orderType === "donation"
        ) {
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

        if (
            session.payment_status !==
            "paid"
        ) {
            console.log(
                "Stripe session is not paid:",
                session.id,
                session.payment_status
            );

            return NextResponse.json({
                received: true,
                paymentStatus:
                    session.payment_status,
            });
        }

        /*
         * --------------------------------------------------
         * Read metadata
         * --------------------------------------------------
         */

        const orderId =
            session.metadata?.orderId;

        const userId =
            session.metadata?.userId;

        const orderType =
            session.metadata?.orderType;

        /*
         * --------------------------------------------------
         * SUBSCRIPTION FLOW
         *
         * Subscription orders don't have a productId.
         * Set the user's subscription status directly.
         * --------------------------------------------------
         */

        if (
            orderType === "subscription" ||
            orderId?.startsWith("sub_")
        ) {
            if (
                !orderId ||
                !userId
            ) {
                console.error(
                    "Missing subscription checkout metadata."
                );
                return NextResponse.json(
                    {
                        error:
                            "Missing checkout metadata.",
                    },
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
            const orderSnapshot =
                await orderRef.get();

            if (
                !orderSnapshot.exists()
            ) {
                console.error(
                    "Subscription order not found:",
                    orderId
                );
                return NextResponse.json(
                    {
                        error:
                            "Order not found.",
                    },
                    { status: 404 }
                );
            }

            /*
             * Already fully processed.
             */

            const order = orderSnapshot.val();

            if (
                order.status === "paid" &&
                order.licenseId
            ) {
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
         * PRODUCT PURCHASE FLOW (existing logic)
         * --------------------------------------------------
         */

        const productId =
            session.metadata?.productId;

        if (
            !orderId ||
            !userId ||
            !productId
        ) {
            console.error(
                "Missing checkout metadata."
            );

            return NextResponse.json(
                {
                    error:
                        "Missing checkout metadata.",
                },
                { status: 400 }
            );
        }

        /*
         * --------------------------------------------------
         * Load order
         * --------------------------------------------------
         */

        const orderRef =
            adminDatabase.ref(
                `orders/${userId}/${orderId}`
            );

        const orderSnapshot =
            await orderRef.get();

        if (!orderSnapshot.exists()) {
            console.error(
                "Order not found:",
                orderId
            );

            return NextResponse.json(
                {
                    error:
                        "Order not found.",
                },
                { status: 404 }
            );
        }

        const order =
            orderSnapshot.val();

        /*
         * --------------------------------------------------
         * Verify ownership
         * --------------------------------------------------
         */

        if (
            order.userId &&
            order.userId !== userId
        ) {
            console.error(
                "Order user mismatch."
            );

            return NextResponse.json(
                {
                    error:
                        "Order ownership verification failed.",
                },
                { status: 400 }
            );
        }

        /*
         * --------------------------------------------------
         * Already fully processed
         *
         * Stripe may send the same webhook more than once.
         * --------------------------------------------------
         */

        if (
            order.status === "paid" &&
            order.licenseId
        ) {
            console.log(
                "Order already fully processed:",
                orderId
            );

            return NextResponse.json({
                received: true,
                alreadyProcessed: true,
                licenseId:
                    order.licenseId,
            });
        }

        /*
         * --------------------------------------------------
         * Load product
         * --------------------------------------------------
         */

        const productSnapshot =
            await adminDatabase
                .ref(`bots/${productId}`)
                .get();

        if (!productSnapshot.exists()) {
            console.error(
                "Product not found:",
                productId
            );

            return NextResponse.json(
                {
                    error:
                        "Product not found.",
                },
                { status: 404 }
            );
        }

        const product =
            productSnapshot.val();

        /*
         * --------------------------------------------------
         * Verify amount and currency
         * --------------------------------------------------
         */

        const expectedPrice =
            Math.round(
                Number(
                    product.pricing?.price || 0
                ) * 100
            );

        const expectedCurrency =
            String(
                product.pricing?.currency ||
                "USD"
            ).toLowerCase();

        const actualCurrency =
            session.currency
                ? session.currency.toLowerCase()
                : "";

        if (
            session.amount_total !==
            expectedPrice ||
            (
                actualCurrency &&
                actualCurrency !==
                expectedCurrency
            )
        ) {
            console.error(
                "Payment amount/currency mismatch.",
                {
                    orderId,
                    expectedPrice,
                    actualPrice:
                        session.amount_total,
                    expectedCurrency,
                    actualCurrency,
                }
            );

            return NextResponse.json(
                {
                    error:
                        "Payment verification failed.",
                },
                { status: 400 }
            );
        }

        /*
         * --------------------------------------------------
         * Deterministic License ID
         *
         * The same order ALWAYS gets the same license ID.
         * This prevents duplicate licenses even if:
         *
         * Webhook + Verify
         *
         * run at the same time.
         * --------------------------------------------------
         */

        let licenseId =
            order.licenseId ||
            null;

        if (
            product.license?.required
        ) {
            licenseId =
                licenseId ||
                createLicenseId(orderId);

            const licenseRef =
                adminDatabase.ref(
                    `licenses/${userId}/${licenseId}`
                );

            const existingLicenseSnapshot =
                await licenseRef.get();

            if (
                !existingLicenseSnapshot.exists()
            ) {
                const startedAt =
                    Date.now();

                const durationDays =
                    Number(
                        product.license
                            ?.durationDays ||
                        30
                    );

                const expiresAt =
                    startedAt +
                    durationDays *
                    24 *
                    60 *
                    60 *
                    1000;

                await licenseRef.set({
                    id: licenseId,

                    licenseKey:
                        createLicenseKey(),

                    userId,

                    productId,

                    productName:
                        product.name || "",

                    orderId,

                    status: "active",

                    startedAt,

                    expiresAt,

                    durationDays,

                    maxAccounts:
                        Number(
                            product.license
                                ?.maxAccounts ||
                            1
                        ),

                    mt5Account: null,

                    createdAt:
                        startedAt,

                    updatedAt:
                        startedAt,
                });

                console.log(
                    "LICENSE CREATED:",
                    licenseId
                );
            } else {
                console.log(
                    "LICENSE ALREADY EXISTS:",
                    licenseId
                );
            }
        }

        /*
         * --------------------------------------------------
         * Finalize order
         * --------------------------------------------------
         */

        const paidAt =
            order.paidAt ||
            Date.now();

        await orderRef.update({
            userId,

            productId,

            status: "paid",

            paymentStatus: "paid",

            paymentProvider:
                "stripe",

            stripeSessionId:
                session.id,

            stripePaymentIntent:
                typeof session.payment_intent ===
                    "string"
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
                        order.licenseCreatedAt ||
                        Date.now(),
                }
                : {}),

            updatedAt:
                Date.now(),
        });

        console.log(
            "PAYMENT COMPLETED:",
            orderId
        );

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
    } catch (error: any) {
        console.error(
            "STRIPE WEBHOOK ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    error?.message ||
                    "Webhook processing failed.",
            },
            { status: 400 }
        );
    }
}