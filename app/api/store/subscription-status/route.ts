import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { stripeClient, formatStripeError } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/store/subscription-status
 *
 * Returns the connected subscriptions recorded for the authenticated user at
 * `subscriptions/{uid}/{subscriptionId}` (written by the webhook from
 * webhook-confirmed state, never from redirect queries). When `accountId` is
 * provided the live status is refreshed from Stripe on the connected account.
 */
export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json(
                { error: "Authentication required." },
                { status: 401 }
            );
        }
        const uid = user.uid;

        const accountId =
            request.nextUrl.searchParams.get("accountId") || "";

        const subsSnap = await adminDatabase.ref(`subscriptions/${uid}`).get();
        const subs = subsSnap.exists() ? subsSnap.val() : {};

        const entries: Array<Record<string, unknown>> = [];
        for (const subscriptionId of Object.keys(subs)) {
            const record = subs[subscriptionId];
            let current = record;

            if (accountId && accIdOk(accountId) && record.accountId === accountId) {
                try {
                    const live = await stripeClient.subscriptions.retrieve(
                        subscriptionId,
                        {},
                        { stripeAccount: accountId }
                    );
                    current = {
                        ...record,
                        status: live.status,
                        // API v2442 period fields live on the subscription item.
                        currentPeriodEnd:
                            live.items?.data?.[0]?.current_period_end ?? null,
                        cancelAtPeriodEnd: live.cancel_at_period_end ?? null,
                        updatedAt: Date.now(),
                    };
                } catch {
                    // Keep the webhook-confirmed values; Stripe may not have
                    // the subscription in its 30-day window.
                }
            }

            entries.push({
                subscriptionId,
                ...current,
            });
        }

        entries.sort((a, b) =>
            (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
        );

        return NextResponse.json({ success: true, subscriptions: entries });
    } catch (error: unknown) {
        console.error("STORE SUBSCRIPTION STATUS ERROR:", error);
        return NextResponse.json(
            { error: formatStripeError(error) || "Failed to load subscriptions." },
            { status: 500 }
        );
    }
}

function accIdOk(accountId: string) {
    return accountId.startsWith("acct_");
}