import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

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

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring("Bearer ".length);
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const subscriber = request.nextUrl.searchParams.get("subscriber") || "pro";

    const snap = await adminDatabase.ref(getSubPath(uid, subscriber)).get();
    const sub = snap.val();

    if (!sub?.stripeCustomerId || !sub?.stripeSubscriptionId) {
        return NextResponse.json({ error: "No Stripe subscription found" }, { status: 404 });
    }

    const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: getReturnUrl(subscriber),
    });

    return NextResponse.json({ url: session.url });
}
