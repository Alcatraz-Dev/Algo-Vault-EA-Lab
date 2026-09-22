import { NextRequest, NextResponse } from "next/server";
import {
    adminAuth,
    adminDatabase,
} from "@/lib/firebase-admin";
import { stripeClient } from "@/lib/stripe";

const SUBSCRIPTION_PLANS: Record<string, {
    name: string;
    price: number;
    currency: string;
    interval: "day" | "week" | "month" | "year";
    tier: "pro" | "dev";
}> = {
    pro: { name: "Pro Monthly", price: 29, currency: "usd", interval: "month", tier: "pro" },
    enterprise: { name: "Enterprise Monthly", price: 99, currency: "usd", interval: "month", tier: "pro" },
    dev_pro: { name: "Developer Pro Monthly", price: 19, currency: "usd", interval: "month", tier: "dev" },
    dev_enterprise: { name: "Developer Enterprise Monthly", price: 49, currency: "usd", interval: "month", tier: "dev" },
};

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
            !authorization?.startsWith(
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
         * 2. Get verified Firebase user
         * --------------------------------------------------
         */

        const firebaseUser =
            await adminAuth.getUser(
                authenticatedUserId
            );

        const email =
            firebaseUser.email || "";

        /*
         * --------------------------------------------------
         * 3. Read request
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
         * SUBSCRIPTION FLOW
         *
          * When orderId starts with "sub_", it is a plan
          * subscription (not a product purchase). The plan is
          * embedded in the orderId: sub_<plan>_<timestamp>.
          * Supports multi-part plan keys (e.g. sub_dev_pro_<ts>).
          * --------------------------------------------------
          */

        if (orderId.startsWith("sub_")) {
            const planKey = orderId.slice(4, orderId.lastIndexOf("_")) || "pro";
            const plan = SUBSCRIPTION_PLANS[planKey] || SUBSCRIPTION_PLANS.pro;

            const unitAmount = Math.round(plan.price * 100);

            const now = Date.now();
            const orderRef = adminDatabase.ref(
                `orders/${authenticatedUserId}/${orderId}`
            );

        const appUrl =
            process.env.NEXT_PUBLIC_APP_URL ||
            "http://localhost:3000";

        // Look up buyer's referral code to pass through checkout
        const buyerProfileSnap = await adminDatabase
            .ref(`users/${authenticatedUserId}`)
            .get();
        const buyerProfile = buyerProfileSnap.val();
        const referredBy = buyerProfile?.referredBy || null;

        const session = await stripeClient.checkout.sessions.create({
                mode: "subscription",
                payment_method_types: ["card"],
                customer_email: email || undefined,
                line_items: [
                    {
                        price_data: {
                            currency: plan.currency,
                            product_data: {
                                name: plan.name,
                                description: `${plan.name} subscription for trading platform access`,
                            },
                            unit_amount: unitAmount,
                            recurring: { interval: plan.interval },
                        },
                        quantity: 1,
                    },
                ],
                metadata: {
                    orderId,
                    userId: authenticatedUserId,
                    orderType: "subscription",
                    plan: planKey,
                    planTier: plan.tier,
                    price: String(plan.price),
                    currency: plan.currency,
                    referredBy: referredBy || "",
                },
                success_url: `${appUrl}/account/purchases?payment=success&order=${encodeURIComponent(orderId)}`,
                cancel_url: plan.tier === "dev"
                    ? `${appUrl}/developer/subscription`
                    : `${appUrl}/account/subscribe`,
            }, {
                idempotencyKey: `checkout-${orderId}`,
            });

            await orderRef.set({
                userId: authenticatedUserId,
                email,
                orderId,
                productName: plan.name,
                price: plan.price,
                amount: plan.price,
                currency: plan.currency,
                currencyUpper: plan.currency.toUpperCase(),
                stripeSessionId: session.id,
                paymentProvider: "stripe",
                orderType: "subscription",
                plan: planKey,
                planTier: plan.tier,
                status: "pending",
                paymentStatus: "pending",
                checkoutCreatedAt: now,
                createdAt: now,
                updatedAt: now,
            });

            return NextResponse.json({
                success: true,
                checkoutUrl: session.url,
                sessionId: session.id,
            });
        }

        /*
         * --------------------------------------------------
         * 4. Load order
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
         * 5. Verify ownership
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
         * 5.5 PLUGIN / EXTENSION FLOW
         *
         * Plugin orders carry orderType/productType === "plugin". The
         * product lives under plugins/{productId} and pricing/licensing use
         * the plugin's own manifest instead of the bots/ catalog.
         * --------------------------------------------------
         */

        if (
            order.productType === "plugin" ||
            order.orderType === "plugin" ||
            (typeof order.productId === "string" && order.productId.startsWith("plugin:"))
        ) {
            const pluginIdRaw = String(order.productId || "").replace(/^plugin:/, "");
            const pluginId = pluginIdRaw || String(order.pluginId || "");
            if (!pluginId) {
                return NextResponse.json({ error: "Plugin order has no product." }, { status: 400 });
            }

            const pluginSnap = await adminDatabase.ref(`plugins/${pluginId}`).get();
            if (!pluginSnap.exists()) {
                return NextResponse.json({ error: "Plugin not found." }, { status: 404 });
            }
            const plugin = pluginSnap.val();

            if (plugin.status !== "published") {
                return NextResponse.json({ error: "Plugin is not available." }, { status: 400 });
            }

            const pluginPricing = plugin.pricing || { type: "free", price: 0, currency: "usd" };
            const pluginPrice = Number(pluginPricing.price || 0);
            const pluginCurrency = String(pluginPricing.currency || "usd").toLowerCase();
            const isSubscription = pluginPricing.type === "subscription";

            if (pluginPrice <= 0) {
                return NextResponse.json({ error: "This plugin is free and does not require payment." }, { status: 400 });
            }

            const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
            const buyerProfileSnap = await adminDatabase.ref(`users/${authenticatedUserId}`).get();
            const buyerProfile = buyerProfileSnap.val();
            const referredBy = buyerProfile?.referredBy || null;

            const session = await stripeClient.checkout.sessions.create({
                mode: isSubscription ? "subscription" : "payment",
                payment_method_types: ["card"],
                customer_email: email || undefined,
                line_items: [
                    {
                        price_data: {
                            currency: pluginCurrency,
                            product_data: {
                                name: (plugin.displayName || plugin.name || "AlgoVault Plugin").slice(0, 120),
                                description: (plugin.description || "Trading intelligence plugin license").slice(0, 255),
                            },
                            unit_amount: Math.round(pluginPrice * 100),
                            ...(isSubscription ? { recurring: { interval: "month" as const } } : {}),
                        },
                        quantity: 1,
                    },
                ],
                metadata: {
                    orderId,
                    userId: authenticatedUserId,
                    orderType: "plugin",
                    pluginId,
                    productId: pluginId,
                    price: String(pluginPrice),
                    currency: pluginCurrency,
                    referredBy: referredBy || "",
                },
                success_url: `${appUrl}/account/plugins?payment=success&order=${encodeURIComponent(orderId)}`,
                cancel_url: `${appUrl}/marketplace/plugins/${encodeURIComponent(plugin.slug || pluginId)}?payment=cancelled`,
            });

            await orderRef.update({
                userId: authenticatedUserId,
                email,
                productId: pluginId,
                productName: plugin.displayName || plugin.name || "",
                productSlug: plugin.slug || pluginId,
                productType: "plugin",
                pluginId,
                price: pluginPrice,
                amount: pluginPrice,
                currency: pluginCurrency.toUpperCase(),
                pricingType: pluginPricing.type || "one_time",
                orderType: "plugin",
                stripeSessionId: session.id,
                paymentProvider: "stripe",
                checkoutCreatedAt: order.checkoutCreatedAt || Date.now(),
                updatedAt: Date.now(),
            });

            return NextResponse.json({
                success: true,
                checkoutUrl: session.url,
                sessionId: session.id,
            });
        }

        /*
         * --------------------------------------------------
         * 6. Already paid
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
         * 7. Load product
         * --------------------------------------------------
         */

        const productId =
            order.productId;

        if (!productId) {
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
                    `bots/${productId}`
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
         * 8. Product must be published
         * --------------------------------------------------
         */

        if (
            product.status !==
            "published" &&
            product.status !== "active"
        ) {
            return NextResponse.json(
                {
                    error:
                        "Product is not available.",
                },
                { status: 400 }
            );
        }

        // Verify Developer Active Subscription & Admin Approval
        if (product.developerUid) {
            const devSnap = await adminDatabase.ref(`users/${product.developerUid}`).get();
            const devUser = devSnap.val() || {};
            if (devUser.role !== "admin") {
                const isApproved = devUser.developerApproved === true || devUser.developerStatus === "approved";
                const devSubSnap = await adminDatabase.ref(`users/${product.developerUid}/developerSubscription`).get();
                const devSub = devSubSnap.val();
                const hasActiveSub = devSub?.status === "active" && Boolean(devSub?.plan);

                if (!isApproved || !hasActiveSub) {
                    return NextResponse.json(
                        {
                            error: "This seller's developer subscription or verification is not active. Purchase is currently unavailable.",
                        },
                        { status: 400 }
                    );
                }
            }
        }

        /*
         * --------------------------------------------------
         * 9. Get real product price
         * --------------------------------------------------
         */

        const price =
            Number(
                product.pricing?.price ||
                0
            );

        const currency =
            String(
                product.pricing?.currency ||
                "USD"
            ).toLowerCase();

        if (price <= 0) {
            return NextResponse.json(
                {
                    error:
                        "This product does not require payment.",
                },
                { status: 400 }
            );
        }

        const unitAmount =
            Math.round(
                price * 100
            );

        /*
         * --------------------------------------------------
         * 10. Reuse existing Stripe session
         *
         * Prevents duplicate Checkout Sessions
         * if user clicks Buy multiple times.
         * --------------------------------------------------
         */

        if (
            order.stripeSessionId
        ) {
            try {
                const existingSession =
                    await stripeClient.checkout.sessions.retrieve(
                        order.stripeSessionId
                    );

                if (
                    existingSession.status ===
                    "open"
                ) {
                    return NextResponse.json({
                        success: true,

                        checkoutUrl:
                            existingSession.url,

                        sessionId:
                            existingSession.id,

                        reused: true,
                    });
                }

                /*
                 * If the session is complete,
                 * do not create another payment.
                 */

                if (
                    existingSession.status ===
                    "complete" &&
                    existingSession.payment_status ===
                    "paid"
                ) {
                    return NextResponse.json({
                        success: true,

                        status: "paid",

                        alreadyPaid: true,

                        sessionId:
                            existingSession.id,

                        licenseId:
                            order.licenseId ||
                            null,
                    });
                }
            } catch (error) {
                /*
                 * If the old session cannot be retrieved,
                 * continue and create a new one.
                 */
                console.warn(
                    "Existing Stripe session could not be reused:",
                    error
                );
            }
        }

        /*
         * --------------------------------------------------
         * 11. Application URL
         * --------------------------------------------------
         */

        const appUrl =
            process.env
                .NEXT_PUBLIC_APP_URL ||
            "http://localhost:3000";

        /*
         * --------------------------------------------------
         * 12. Checkout mode
         * --------------------------------------------------
         */

        const isSubscription =
            product.pricing?.type ===
            "subscription";

        // Look up buyer's referral code to pass through checkout
        const buyerProfileSnap = await adminDatabase
            .ref(`users/${authenticatedUserId}`)
            .get();
        const buyerProfile = buyerProfileSnap.val();
        const referredBy = buyerProfile?.referredBy || null;

        /*
         * --------------------------------------------------
         * 13. Create Stripe Checkout
         * --------------------------------------------------
         */

        const session =
            await stripeClient.checkout.sessions.create(
                {
                    mode:
                        isSubscription
                            ? "subscription"
                            : "payment",

                    payment_method_types: [
                        "card",
                    ],

                    customer_email:
                        email || undefined,

                    line_items: [
                        {
                            price_data: {
                                currency,

                                product_data: {
                                    name:
                                        product.name ||
                                        "AlgoVault Product",

                                    description:
                                        product.description ||
                                        "Trading software license",
                                },

                                unit_amount:
                                    unitAmount,

                                ...(isSubscription
                                    ? {
                                        recurring: {
                                            interval:
                                                "month",
                                        },
                                    }
                                    : {}),
                            },

                            quantity: 1,
                        },
                    ],

                    metadata: {
                        orderId,

                        userId:
                            authenticatedUserId,

                        productId,

                        email,

                        price:
                            String(price),

                        currency,

                        referredBy: referredBy || "",
                    },

                    success_url:
                        `${appUrl}/account/purchases?payment=success&order=${encodeURIComponent(
                            orderId
                        )}`,

                    cancel_url:
                        `${appUrl}/marketplace/${encodeURIComponent(
                            order.productSlug || ""
                        )}?payment=cancelled`,
                },
                {
                    idempotencyKey: `checkout-${orderId}`,
                }
            );

        /*
         * --------------------------------------------------
         * 14. Save checkout information
         * --------------------------------------------------
         */

        await orderRef.update({
            userId:
                authenticatedUserId,

            email,

            productId,

            productName:
                product.name || "",

            productSlug:
                product.slug ||
                order.productSlug ||
                "",

            price,

            amount: price,

            currency:
                currency.toUpperCase(),

            stripeSessionId:
                session.id,

            paymentProvider:
                "stripe",

            checkoutCreatedAt:
                order.checkoutCreatedAt ||
                Date.now(),

            updatedAt:
                Date.now(),
        });

        /*
         * --------------------------------------------------
         * 15. Return Checkout URL
         * --------------------------------------------------
         */

        return NextResponse.json({
            success: true,

            checkoutUrl:
                session.url,

            sessionId:
                session.id,
        });
    } catch (error: unknown) {
        console.error(
            "CHECKOUT CREATE ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unable to create checkout session.",
            },
            { status: 500 }
        );
    }
}