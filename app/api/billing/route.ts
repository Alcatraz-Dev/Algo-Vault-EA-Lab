import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { stripeClient } from "@/lib/stripe";

function getSubPath(uid: string, subscriber: string) {
    return subscriber === "dev"
        ? `users/${uid}/developerSubscription`
        : `users/${uid}/subscription`;
}

function getReturnUrl(subscriber: string) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return subscriber === "dev"
        ? `${appUrl}/developer/subscription`
        : `${appUrl}/account/subscribe`;
}

async function getSubSnapshot(uid: string, subscriber: string) {
    const snap = await adminDatabase.ref(getSubPath(uid, subscriber)).get();
    return snap.val();
}

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring("Bearer ".length);
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const subscriber = request.nextUrl.searchParams.get("subscriber") || "pro";

    const sub = await getSubSnapshot(uid, subscriber);

    if (!sub?.stripeCustomerId || !sub?.stripeSubscriptionId) {
        return NextResponse.json({ error: "No Stripe subscription found" }, { status: 404 });
    }

    const session = await stripeClient.billingPortal.sessions.create(
        sub.stripeAccountId
            ? {
                  // Connected (customer_account) subscription — Android flow.
                  customer_account: sub.stripeAccountId,
                  return_url: getReturnUrl(subscriber),
              }
            : {
                  customer: sub.stripeCustomerId,
                  return_url: getReturnUrl(subscriber),
              }
    );

    return NextResponse.json({ url: session.url });
}

export async function POST(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring("Bearer ".length);
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const body = await request.json();
    const action = body.action;
    const subscriber = body.subscriber || "pro";
    const subPath = getSubPath(uid, subscriber);

    if (action === "cancel") {
        const sub = await getSubSnapshot(uid, subscriber);
        if (sub?.stripeSubscriptionId) {
            await stripeClient.subscriptions.cancel(
                sub.stripeSubscriptionId,
                {},
                sub.stripeAccountId
                    ? { stripeAccount: sub.stripeAccountId }
                    : undefined
            );
            await adminDatabase.ref(subPath).update({ status: "canceled", updatedAt: Date.now() });
        }
        return NextResponse.json({ success: true, cancelled: true });
    }

    if (action === "status") {
        const sub = await getSubSnapshot(uid, subscriber);
        if (!sub?.stripeSubscriptionId) {
            return NextResponse.json({ error: "No subscription found" }, { status: 404 });
        }
        const stripeSub = await stripeClient.subscriptions.retrieve(
            sub.stripeSubscriptionId,
            {},
            sub.stripeAccountId
                ? { stripeAccount: sub.stripeAccountId }
                : undefined
        );
        // API v2442 no longer exposes top-level current_period_* on the
        // Subscription object; the billing period lives on its first item.
        const billingItem = stripeSub.items?.data?.[0];
        return NextResponse.json({
            plan: sub.plan,
            status: stripeSub.status,
            currentPeriodStart: billingItem?.current_period_start ?? null,
            currentPeriodEnd: billingItem?.current_period_end ?? null,
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
