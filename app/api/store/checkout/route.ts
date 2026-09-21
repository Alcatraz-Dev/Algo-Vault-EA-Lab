import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { stripeClient, formatStripeError, platformFeeRate } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/store/checkout
 *
 * Creates a Checkout Session on a developer's connected account for one of
 * their connected-account products (Direct Charge for the developer, with an
 * application fee collected by the AlgoVault platform).
 *
 * The connected account (and its merchant `card_payments` capability) is
 * verified server-side; the application fee is computed server-side from the
 * developer's plan — never from client-supplied amounts.
 *
 * Subscription mode (Android support):
 * When the buyer has their own Stripe Connect account (customer configuration),
 * the subscription is attached with `customer_account: <buyerAccountId>` so it
 * can be managed through the billing portal via `customer_account`.
 */
export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json(
                { error: "Authentication required." },
                { status: 401 }
            );
        }
        const buyerUid = user.uid;

        const body = await request.json().catch(() => ({}));
        const {
            accountId,
            stripeProductId,
            stripePriceId,
            mode,
            orderId,
        } = body as {
            accountId?: string;
            stripeProductId?: string;
            stripePriceId?: string;
            mode?: string;
            orderId?: string;
        };

        if (typeof accountId !== "string" || !accountId.startsWith("acct_")) {
            return NextResponse.json({ error: "Invalid connected account." }, { status: 400 });
        }
        if (typeof stripePriceId !== "string" || !stripePriceId.startsWith("price_")) {
            return NextResponse.json({ error: "Invalid price." }, { status: 400 });
        }

        // ---------------------------------------------------------------
        // Resolve the seller from the reverse index (never trust the client
        // to say who owns the account).
        // ---------------------------------------------------------------
        const sellerIndexSnap = await adminDatabase.ref(`stripeAccounts/${accountId}`).get();
        const sellerIndex = sellerIndexSnap.val();
        if (!sellerIndex?.uid) {
            return NextResponse.json(
                { error: "No Stripe Connect account is configured for this developer." },
                { status: 400 }
            );
        }
        const sellerUid = String(sellerIndex.uid);

        // ---------------------------------------------------------------
        // The connected account must exist and be able to take card payments.
        // ---------------------------------------------------------------
        let account: import("stripe").Stripe.V2.Core.Account;
        try {
            account = await stripeClient.v2.core.accounts.retrieve(accountId, {
                include: ["configuration.merchant"],
            });
        } catch {
            return NextResponse.json(
                { error: "No Stripe Connect account is configured for this developer." },
                { status: 400 }
            );
        }
        const cardPayments =
            account.configuration?.merchant?.capabilities?.card_payments;
        if (cardPayments?.status !== "active") {
            return NextResponse.json(
                { error: "Complete Stripe onboarding before accepting payments." },
                { status: 400 }
            );
        }

        // ---------------------------------------------------------------
        // The price must live on the seller's connected account.
        // ---------------------------------------------------------------
        let price: import("stripe").Stripe.Price;
        try {
            price = await stripeClient.prices.retrieve(
                stripePriceId,
                {},
                { stripeAccount: accountId }
            );
        } catch {
            return NextResponse.json({ error: "Price not found on this store." }, { status: 404 });
        }

        const actualProductId =
            typeof price.product === "string" ? price.product : "";
        if (
            (stripeProductId && price.product !== stripeProductId) ||
            !actualProductId
        ) {
            return NextResponse.json({ error: "Price does not belong to this product." }, { status: 400 });
        }
        if (!price.active) {
            return NextResponse.json({ error: "This product is no longer available." }, { status: 400 });
        }

        let productName = "Store product";
        try {
            const stripeProduct = await stripeClient.products.retrieve(
                actualProductId,
                {},
                { stripeAccount: accountId }
            );
            productName = stripeProduct.name || productName;
        } catch {
            // Name is cosmetic; continue with the fallback.
        }

        const unitAmount = price.unit_amount ?? 0;
        const currency = price.currency || "usd";
        const subscriptionMode = mode === "subscription" || Boolean(price.recurring);
        if (unitAmount <= 0) {
            return NextResponse.json({ error: "This product does not require payment." }, { status: 400 });
        }

        // ---------------------------------------------------------------
        // Application fee, computed server-side from the developer's plan.
        // ---------------------------------------------------------------
        const sellerSnap = await adminDatabase.ref(`users/${sellerUid}/developerSubscription`).get();
        const sellerSub = sellerSnap.val();
        const feeRate = platformFeeRate(sellerSub?.plan);
        const feeAmount = Math.round(unitAmount * feeRate); // payment mode, in minor units
        const feePercent = feeRate * 100; // subscription mode

        // ---------------------------------------------------------------
        // Order record (idempotent).
        // ---------------------------------------------------------------
        const now = Date.now();
        let orderIdValue = typeof orderId === "string" && orderId ? orderId : "";
        const orderRef =
            orderIdValue
                ? adminDatabase.ref(`orders/${buyerUid}/${orderIdValue}`)
                : adminDatabase.ref(`orders/${buyerUid}`).push();
        if (!orderIdValue) orderIdValue = orderRef.key!;

        const existingOrderSnap = await orderRef.get();
        const existingOrder = existingOrderSnap.exists() ? existingOrderSnap.val() : null;

        if (existingOrder) {
            if (String(existingOrder.userId) !== buyerUid) {
                return NextResponse.json({ error: "Unauthorized order." }, { status: 403 });
            }
            if (
                existingOrder.status === "paid" ||
                existingOrder.paymentStatus === "paid"
            ) {
                return NextResponse.json({
                    success: true,
                    status: "paid",
                    alreadyPaid: true,
                    orderId: orderIdValue,
                });
            }
            // Reuse an open Checkout Session so re-clicks don't duplicate.
            if (existingOrder.stripeSessionId) {
                try {
                    const existingSession = await stripeClient.checkout.sessions.retrieve(
                        existingOrder.stripeSessionId,
                        {},
                        { stripeAccount: accountId }
                    );
                    if (existingSession.status === "open") {
                        return NextResponse.json({
                            success: true,
                            checkoutUrl: existingSession.url,
                            sessionId: existingSession.id,
                            reused: true,
                            orderId: orderIdValue,
                        });
                    }
                } catch {
                    // Old session unavailable → fall through and create a new one.
                }
            }
        }

        // ---------------------------------------------------------------
        // Create the Checkout Session on the connected account.
        // ---------------------------------------------------------------
        // Android subscription support: when the buyer owns a connected
        // account (customer configuration), attach the subscription with
        // `customer_account` instead of a plain Customer.
        const buyerAccountSnap = await adminDatabase.ref(`users/${buyerUid}/stripeConnect/accountId`).get();
        const buyerAccountIdValue = buyerAccountSnap.val();
        const buyerAccountId =
            typeof buyerAccountIdValue === "string" && buyerAccountIdValue.startsWith("acct_")
                ? buyerAccountIdValue
                : undefined;

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

        const session = await stripeClient.checkout.sessions.create(
            {
                mode: subscriptionMode ? "subscription" : "payment",
                payment_method_types: ["card"],
                line_items: [{ price: stripePriceId, quantity: 1 }],
                metadata: {
                    orderId: orderIdValue,
                    userId: buyerUid,
                    orderType: "store",
                    storeAccountId: accountId,
                    stripeProductId: actualProductId,
                    mode: subscriptionMode ? "subscription" : "payment",
                },
                ...(subscriptionMode
                    ? {
                        subscription_data: {
                            application_fee_percent: feePercent,
                        },
                        customer_account: buyerAccountId,
                    }
                    : {
                        payment_intent_data: {
                            application_fee_amount: feeAmount,
                        },
                    }),
                success_url: `${appUrl}/account/purchases?payment=success&order=${encodeURIComponent(orderIdValue)}`,
                cancel_url: `${appUrl}/store/${encodeURIComponent(accountId)}?payment=cancelled`,
            },
            {
                stripeAccount: accountId,
                idempotencyKey: `store-checkout-${orderIdValue}-${buyerUid}`,
            }
        );

        await orderRef.set({
            id: orderIdValue,
            userId: buyerUid,
            orderType: "store",
            storeAccountId: accountId,
            sellerUid,
            stripeProductId: actualProductId,
            stripePriceId,
            productName,
            amount: unitAmount / 100,
            price: unitAmount / 100,
            currency: currency.toUpperCase(),
            status: "pending",
            paymentStatus: "pending",
            paymentProvider: "stripe",
            mode: subscriptionMode ? "subscription" : "payment",
            stripeSessionId: session.id,
            checkoutCreatedAt: now,
            createdAt: now,
            updatedAt: now,
        });

        return NextResponse.json({
            success: true,
            checkoutUrl: session.url,
            sessionId: session.id,
            orderId: orderIdValue,
        });
    } catch (error: unknown) {
        console.error("STORE CHECKOUT ERROR:", error);
        return NextResponse.json(
            { error: formatStripeError(error) || "Unable to create checkout session." },
            { status: 500 }
        );
    }
}