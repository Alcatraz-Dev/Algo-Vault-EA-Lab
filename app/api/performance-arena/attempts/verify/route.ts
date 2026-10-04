import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../../_shared";
import { isArenaEnabled } from "@/lib/performance-arena/flags";
import * as store from "@/lib/performance-arena/store";
import { joinChallenge, getAttemptState } from "@/lib/performance-arena/service";
import { stripeClient } from "@/lib/stripe";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyChallengePayment } from "@/lib/performance-arena/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

export async function POST(request: NextRequest) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;

        if (!isArenaEnabled()) {
            return arenaJson({ error: "Performance Arena is currently disabled.", code: "ARENA_DISABLED" }, 503);
        }

        const body = (await request.json().catch(() => null)) as { orderId?: string } | null;
        const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";

        if (!orderId) {
            return arenaJson({ error: "orderId is required.", code: "INVALID_BODY" }, 400);
        }

        const orderRef = adminDatabase.ref(`orders/${auth.uid}/${orderId}`);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists()) {
            return arenaJson({ error: "Order not found.", code: "NOT_FOUND" }, 404);
        }

        const rawOrder = orderSnap.val() as Record<string, unknown>;
        if (rawOrder.userId !== auth.uid) {
            return arenaJson({ error: "Unauthorized order.", code: "UNAUTHORIZED" }, 403);
        }
        if (typeof rawOrder.stripeSessionId !== "string" || !rawOrder.stripeSessionId) {
            return arenaJson({ error: "Order has no Stripe checkout session.", code: "INVALID_ORDER" }, 400);
        }

        let session: Awaited<ReturnType<typeof stripeClient.checkout.sessions.retrieve>>;
        try {
            // Always retrieve canonical Stripe state. A `paid` bit on our order
            // record or a browser redirect is never sufficient authority.
            session = await stripeClient.checkout.sessions.retrieve(rawOrder.stripeSessionId);
        } catch {
            return arenaJson({ error: "Stripe could not verify this checkout right now. Retry shortly.", code: "PAYMENT_VERIFICATION_UNAVAILABLE" }, 503);
        }

        const check = verifyChallengePayment({
            uid: auth.uid,
            requestedOrderId: orderId,
            order: {
                orderId: String(rawOrder.orderId ?? ""),
                userId: String(rawOrder.userId ?? ""),
                orderType: String(rawOrder.orderType ?? ""),
                definitionId: String(rawOrder.definitionId ?? ""),
                stripeSessionId: String(rawOrder.stripeSessionId),
                priceCents: typeof rawOrder.priceCents === "number" ? rawOrder.priceCents : undefined,
                price: typeof rawOrder.price === "number" ? rawOrder.price : undefined,
                amount: typeof rawOrder.amount === "number" ? rawOrder.amount : undefined,
                currency: typeof rawOrder.currency === "string" ? rawOrder.currency : undefined,
            },
            session: {
                id: session.id,
                status: session.status,
                payment_status: session.payment_status,
                mode: session.mode,
                amount_total: session.amount_total,
                currency: session.currency,
                metadata: session.metadata,
            },
        });
        if (!check.ok) {
            const status = check.code === "PAYMENT_PENDING" ? 409 : 400;
            return arenaJson({ error: check.message, code: check.code }, status);
        }

        const definition = await store.getDefinition(check.definitionId);
        if (!definition || !definition.enabled || definition.status !== "AVAILABLE" || definition.access.model !== "paid") {
            return arenaJson({ error: "This paid challenge is no longer available.", code: "CHALLENGE_UNAVAILABLE" }, 409);
        }
        if (definition.access.priceCents !== check.amountCents || (definition.access.currency ?? "usd").toLowerCase() !== String(session.currency).toLowerCase()) {
            return arenaJson({ error: "Challenge pricing changed after checkout. Contact support before retrying.", code: "CHALLENGE_PRICE_CHANGED" }, 409);
        }

        const now = Date.now();
        const existingGrant = await store.getPaidGrantByOrder(auth.uid, orderId);
        if (!existingGrant) {
            const accepted = await store.savePaidGrant({
                uid: auth.uid,
                definitionId: check.definitionId,
                orderId,
                amountCents: check.amountCents,
                grantedAt: now,
                consumed: false,
            });
            if (!accepted) {
                return arenaJson({ error: "This order is already bound to a different challenge grant.", code: "GRANT_CONFLICT" }, 409);
            }
        } else if (existingGrant.definitionId !== check.definitionId || existingGrant.amountCents !== check.amountCents) {
            return arenaJson({ error: "This order is already bound to a different challenge grant.", code: "GRANT_CONFLICT" }, 409);
        }
        await orderRef.update({ status: "paid", paymentStatus: "paid", paidAt: rawOrder.paidAt ?? now, updatedAt: now });

        const attempt = await joinChallenge(auth.uid, check.definitionId, orderId);
        const state = await getAttemptState(auth.uid, attempt.id);
        return arenaJson({ verified: true, attempt: state.attempt, metrics: state.metrics }, 200);
    } catch (error) {
        return arenaError(error, "Failed to verify paid challenge order.");
    }
}
