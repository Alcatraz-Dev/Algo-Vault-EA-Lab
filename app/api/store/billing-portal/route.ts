import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { stripeClient, formatStripeError } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/store/billing-portal
 *
 * Opens the Stripe Billing Portal for a connected account (customer
 * configuration) managed by the authenticated user — e.g. subscriptions
 * attached via `customer_account` in store checkout (Android flow).
 *
 * Ownership is enforced server-side: the caller must own the account
 * (`users/{uid}/stripeConnect.accountId === accountId`).
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
        const uid = user.uid;

        const body = await request.json().catch(() => ({}));
        const accountId =
            typeof body.accountId === "string" ? body.accountId : "";

        if (!accountId.startsWith("acct_")) {
            return NextResponse.json({ error: "Invalid account." }, { status: 400 });
        }

        const userSnap = await adminDatabase.ref(`users/${uid}/stripeConnect/accountId`).get();
        const ownedAccountId = userSnap.val();
        if (typeof ownedAccountId !== "string" || ownedAccountId !== accountId) {
            return NextResponse.json({ error: "Unauthorized account." }, { status: 403 });
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

        const session = await stripeClient.billingPortal.sessions.create({
            customer_account: accountId,
            return_url: `${appUrl}/developer/dashboard`,
        });

        return NextResponse.json({ success: true, url: session.url });
    } catch (error: unknown) {
        console.error("STORE BILLING PORTAL ERROR:", error);
        return NextResponse.json(
            { error: formatStripeError(error) || "Unable to open the billing portal." },
            { status: 500 }
        );
    }
}