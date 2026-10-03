import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../../_shared";
import { isArenaEnabled } from "@/lib/performance-arena/flags";
import * as store from "@/lib/performance-arena/store";
import { joinChallenge, getAttemptState, ArenaError } from "@/lib/performance-arena/service";
import { stripeClient } from "@/lib/stripe";
import { adminDatabase } from "@/lib/firebase-admin";

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

        const order = orderSnap.val();
        if (order.userId !== auth.uid) {
            return arenaJson({ error: "Unauthorized order.", code: "UNAUTHORIZED" }, 403);
        }

        const definitionId = order.definitionId || order.productId;
        if (!definitionId) {
            return arenaJson({ error: "Order does not specify a challenge definition.", code: "INVALID_ORDER" }, 400);
        }

        // Verify with Stripe
        let isPaid = order.status === "paid" || order.paymentStatus === "paid";

        if (!isPaid && order.stripeSessionId) {
            try {
                const session = await stripeClient.checkout.sessions.retrieve(order.stripeSessionId);
                if (session.status === "complete" && session.payment_status === "paid") {
                    isPaid = true;
                    const now = Date.now();
                    await orderRef.update({
                        status: "paid",
                        paymentStatus: "paid",
                        paidAt: order.paidAt || now,
                        updatedAt: now,
                    });
                }
            } catch (err) {
                console.warn("Verify challenge order retrieve session error:", err);
            }
        }

        if (!isPaid) {
            return arenaJson({ error: "Payment has not been completed yet.", code: "PAYMENT_PENDING" }, 400);
        }

        // Save paid grant server-authoritatively
        const existingGrant = await store.getPaidGrant(auth.uid, definitionId);
        if (!existingGrant) {
            await store.savePaidGrant({
                uid: auth.uid,
                definitionId,
                orderId,
                amountCents: Math.round(Number(order.price || 0) * 100),
                grantedAt: Date.now(),
                consumed: false,
            });
        }

        // Attempt join server-authoritatively
        try {
            const attempt = await joinChallenge(auth.uid, definitionId);
            const state = await getAttemptState(auth.uid, attempt.id);
            return arenaJson({ verified: true, attempt: state.attempt, metrics: state.metrics }, 200);
        } catch (joinErr) {
            if (joinErr instanceof ArenaError && joinErr.code === "ALREADY_ACTIVE") {
                // Return active attempt for this definition
                const attempts = await store.listAttempts(auth.uid, 50);
                const active = attempts.find((a) => a.definitionId === definitionId && a.status === "ACTIVE");
                if (active) {
                    const state = await getAttemptState(auth.uid, active.id);
                    return arenaJson({ verified: true, attempt: state.attempt, metrics: state.metrics }, 200);
                }
            }
            throw joinErr;
        }
    } catch (error) {
        return arenaError(error, "Failed to verify paid challenge order.");
    }
}
