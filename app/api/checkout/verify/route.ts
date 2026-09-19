import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
    adminAuth,
    adminDatabase,
} from "@/lib/firebase-admin";

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

export async function POST(
    request: NextRequest
) {
    try {
        /*
         * --------------------------------------------------
         * 1. Verify Firebase authentication
         * --------------------------------------------------
         */

        const authorization =
            request.headers.get(
                "authorization"
            );

        if (
            !authorization ||
            !authorization.startsWith(
                "Bearer "
            )
        ) {
            return NextResponse.json(
                {
                    error: "Unauthorized.",
                },
                { status: 401 }
            );
        }

        const token =
            authorization.substring(
                "Bearer ".length
            );

        const decodedToken =
            await adminAuth.verifyIdToken(
                token
            );

        const authenticatedUserId =
            decodedToken.uid;

        /*
         * --------------------------------------------------
         * 2. Read request
         * --------------------------------------------------
         */

        const body =
            await request.json();

        const orderId =
            typeof body?.orderId === "string"
                ? body.orderId.trim()
                : "";

        if (!orderId) {
            return NextResponse.json(
                {
                    error:
                        "orderId is required.",
                },
                { status: 400 }
            );
        }

        /*
         * --------------------------------------------------
         * 3. Load order
         * --------------------------------------------------
         */

        const orderRef =
            adminDatabase.ref(
                `orders/${authenticatedUserId}/${orderId}`
            );

        const orderSnapshot =
            await orderRef.get();

        if (!orderSnapshot.exists()) {
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
         * 4. Verify ownership
         * --------------------------------------------------
         */

        if (
            order.userId &&
            order.userId !==
            authenticatedUserId
        ) {
            return NextResponse.json(
                {
                    error:
                        "Unauthorized order.",
                },
                { status: 403 }
            );
        }

        /*
         * --------------------------------------------------
         * 5. Already paid
         *
         * Important:
         * Webhook may have completed the order first.
         * This is NOT an error.
         * --------------------------------------------------
         */

        if (
            order.status === "paid" ||
            order.paymentStatus === "paid"
        ) {
            return NextResponse.json({
                success: true,

                status: "paid",

                alreadyPaid: true,

                licenseId:
                    order.licenseId ||
                    null,
            });
        }

        /*
         * --------------------------------------------------
         * 6. Stripe session must exist
         * --------------------------------------------------
         */

        if (
            !order.stripeSessionId
        ) {
            return NextResponse.json(
                {
                    error:
                        "Order has no linked Stripe session.",
                },
                { status: 400 }
            );
        }

        /*
         * --------------------------------------------------
         * 7. Retrieve Stripe session
         * --------------------------------------------------
         */

        const session =
            await stripe.checkout.sessions.retrieve(
                order.stripeSessionId
            );

        /*
         * --------------------------------------------------
         * 8. Verify Stripe metadata
         * --------------------------------------------------
         */

        const metadata =
            session.metadata || {};

        if (
            metadata.orderId !==
            orderId
        ) {
            return NextResponse.json(
                {
                    error:
                        "Stripe order verification failed.",
                },
                { status: 400 }
            );
        }

        if (
            metadata.userId &&
            metadata.userId !==
            authenticatedUserId
        ) {
            return NextResponse.json(
                {
                    error:
                        "Stripe user verification failed.",
                },
                { status: 403 }
            );
        }

        if (
            metadata.productId &&
            metadata.productId !==
            order.productId
        ) {
            return NextResponse.json(
                {
                    error:
                        "Stripe product verification failed.",
                },
                { status: 400 }
            );
        }

        /*
         * --------------------------------------------------
         * 9. SUBSCRIPTION FLOW
         *
         * For plan subscriptions (orderType === "subscription"),
         * skip product/license logic and directly set the
         * user's subscription status in Firebase.
         * --------------------------------------------------
         */

        if (
            order.orderType === "subscription" ||
            orderId.startsWith("sub_")
        ) {
            const plan = order.plan ||
                (orderId.startsWith("sub_") ? orderId.slice(4, orderId.lastIndexOf("_")) || orderId.split("_")[1] : "pro");

            const planTier = order.planTier ||
                (plan.startsWith("dev_") ? "dev" : "pro");

            const stripeCustomerId =
                typeof session.customer === "string"
                    ? session.customer
                    : session.customer?.id || null;

            const stripeSubscriptionId =
                typeof session.subscription === "string"
                    ? session.subscription
                    : session.subscription?.id || null;

            const subscriptionRef = adminDatabase.ref(
                `users/${authenticatedUserId}/subscription`
            );

            await subscriptionRef.set({
                plan,
                status: "active",
                orderId,
                stripeSessionId: session.id,
                stripeSubscriptionId,
                stripeCustomerId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });

            if (planTier === "dev") {
                await adminDatabase.ref(
                    `users/${authenticatedUserId}/developerSubscription`
                ).set({
                    plan,
                    status: "active",
                    orderId,
                    stripeSessionId: session.id,
                    stripeSubscriptionId,
                    stripeCustomerId,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });

                await adminDatabase.ref(
                    `users/${authenticatedUserId}/developerPlan`
                ).set(plan);
            }

            await orderRef.update({
                status: "paid",
                paymentStatus: "paid",
                paymentProvider: "stripe",
                stripeSessionId: session.id,
                stripePaymentIntent:
                    typeof session.payment_intent === "string"
                        ? session.payment_intent
                        : null,
                stripeSubscriptionId,
                stripeCustomerId,
                paidAt: Date.now(),
                updatedAt: Date.now(),
                plan,
                planTier,
                orderType: "subscription",
            });

            console.log(
                "SUBSCRIPTION VERIFIED:",
                orderId,
                "plan:",
                plan
            );

            return NextResponse.json({
                success: true,
                status: "paid",
                updated: true,
                subscription: true,
                plan,
                planTier,
            });
        }

        /*
         * --------------------------------------------------
         * 9. Payment must actually be paid
         * --------------------------------------------------
         */

        if (
            session.payment_status !==
            "paid"
        ) {
            return NextResponse.json({
                success: true,

                status:
                    order.status ||
                    "pending",

                stripePaymentStatus:
                    session.payment_status,

                stripeSessionStatus:
                    session.status,
            });
        }

        /*
         * --------------------------------------------------
         * 10. Load product
         * --------------------------------------------------
         */

        if (!order.productId) {
            return NextResponse.json(
                {
                    error:
                        "Order has no product.",
                },
                { status: 400 }
            );
        }

        const productSnapshot =
            await adminDatabase
                .ref(
                    `bots/${order.productId}`
                )
                .get();

        if (!productSnapshot.exists()) {
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
         * 11. Verify amount/currency
         * --------------------------------------------------
         */

        const expectedPrice =
            Math.round(
                Number(
                    product.pricing?.price ||
                    0
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
                "CHECKOUT VERIFY: amount/currency mismatch",
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
         * 12. License
         *
         * Deterministic ID means:
         *
         * same order -> same license
         *
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
                    `licenses/${authenticatedUserId}/${licenseId}`
                );

            const licenseSnapshot =
                await licenseRef.get();

            if (
                !licenseSnapshot.exists()
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

                    userId:
                        authenticatedUserId,

                    productId:
                        order.productId,

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
         * 13. Finalize order
         * --------------------------------------------------
         */

        const paidAt =
            order.paidAt ||
            Date.now();

        const updates: Record<
            string,
            any
        > = {
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

            paidAt,

            updatedAt:
                Date.now(),
        };

        if (licenseId) {
            updates.licenseId =
                licenseId;

            updates.licenseCreatedAt =
                order.licenseCreatedAt ||
                Date.now();
        }

        await orderRef.update(
            updates
        );

        console.log(
            "CHECKOUT VERIFIED:",
            orderId
        );

        return NextResponse.json({
            success: true,

            status: "paid",

            updated: true,

            licenseId:
                licenseId || null,
        });
    } catch (error: any) {
        console.error(
            "CHECKOUT VERIFY ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    error?.message ||
                    "Unable to verify checkout session.",
            },
            { status: 500 }
        );
    }
}