import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../_shared";
import { isArenaEnabled, isPaidChallengesEnabled } from "@/lib/performance-arena/flags";
import * as store from "@/lib/performance-arena/store";
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
        if (!isPaidChallengesEnabled()) {
            return arenaJson({ error: "Paid challenges are currently disabled.", code: "PAID_CHALLENGES_DISABLED" }, 503);
        }

        const body = (await request.json().catch(() => null)) as { definitionId?: string } | null;
        const definitionId = typeof body?.definitionId === "string" ? body.definitionId.trim() : "";

        if (!definitionId) {
            return arenaJson({ error: "definitionId is required.", code: "INVALID_BODY" }, 400);
        }

        const definition = await store.getDefinition(definitionId);
        if (!definition || !definition.enabled || definition.status !== "AVAILABLE") {
            return arenaJson({ error: "Challenge not found or unavailable.", code: "NOT_FOUND" }, 404);
        }

        if (definition.access.model === "free") {
            return arenaJson({ error: "This challenge is free practice and does not require purchase.", code: "FREE_CHALLENGE" }, 400);
        }

        const priceCents = definition.access.priceCents || 2900;
        const priceUsd = priceCents / 100;
        const orderId = store.newArenaId("cha");
        const now = Date.now();

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

        // Read user email from Auth
        const userRef = adminDatabase.ref(`users/${auth.uid}`);
        const userSnap = await userRef.get();
        const userData = userSnap.val() || {};
        const email = userData.email || "";

        const session = await stripeClient.checkout.sessions.create(
            {
                mode: "payment",
                payment_method_types: ["card"],
                customer_email: email || undefined,
                line_items: [
                    {
                        price_data: {
                            currency: "usd",
                            product_data: {
                                name: `AlgoVault Challenge: ${definition.name}`,
                                description: `Prop-Style Trading Evaluation — ${definition.summary}`,
                            },
                            unit_amount: priceCents,
                        },
                        quantity: 1,
                    },
                ],
                metadata: {
                    orderId,
                    userId: auth.uid,
                    definitionId: definition.id,
                    orderType: "challenge",
                    price: String(priceUsd),
                    currency: "usd",
                },
                success_url: `${appUrl}/account/performance-arena/attempts/verify?payment=success&order=${encodeURIComponent(orderId)}&definitionId=${encodeURIComponent(definition.id)}`,
                cancel_url: `${appUrl}/performance-arena/challenges/${encodeURIComponent(definition.id)}?payment=cancelled`,
            },
            {
                idempotencyKey: `checkout-${orderId}`,
            }
        );

        // Store pending order in RTDB
        await adminDatabase.ref(`orders/${auth.uid}/${orderId}`).set({
            userId: auth.uid,
            email,
            orderId,
            productId: definition.id,
            definitionId: definition.id,
            productName: `AlgoVault Challenge: ${definition.name}`,
            price: priceUsd,
            amount: priceUsd,
            currency: "USD",
            stripeSessionId: session.id,
            paymentProvider: "stripe",
            orderType: "challenge",
            status: "pending",
            paymentStatus: "pending",
            createdAt: now,
            updatedAt: now,
        });

        return arenaJson({
            success: true,
            checkoutUrl: session.url,
            sessionId: session.id,
            orderId,
        });
    } catch (error) {
        return arenaError(error, "Failed to create challenge checkout session.");
    }
}
