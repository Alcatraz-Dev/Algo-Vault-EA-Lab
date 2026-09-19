import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

// Reward tiers: donate >= amount → unlock these free product IDs
const DONATION_TIERS = [
    {
        minAmount: 500, // $5.00
        label: "Supporter",
        rewardIds: ["free_indicator_1"],
        description: "1 Free Indicator",
    },
    {
        minAmount: 1000, // $10.00
        label: "Contributor",
        rewardIds: ["free_indicator_1", "free_ea_basic"],
        description: "1 Free Indicator + 1 Free EA",
    },
    {
        minAmount: 2500, // $25.00
        label: "Champion",
        rewardIds: ["free_indicator_1", "free_ea_basic", "free_ea_premium"],
        description: "Full Free Resources Bundle",
    },
];

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));

        const {
            amount, // amount in cents e.g. 500 = $5
            currency = "usd",
            donorName,
            donorMessage,
        } = body;

        const amountCents = Number(amount);
        if (!amountCents || amountCents < 100) {
            return NextResponse.json(
                { error: "Minimum donation is $1.00." },
                { status: 400 }
            );
        }

        // Optional auth — rewards only if logged in
        let userId: string | null = null;
        let userEmail: string | null = null;

        const authorization = request.headers.get("authorization");
        if (authorization?.startsWith("Bearer ")) {
            try {
                const idToken = authorization.substring(7).trim();
                const decoded = await adminAuth.verifyIdToken(idToken);
                userId = decoded.uid;
                const user = await adminAuth.getUser(userId);
                userEmail = user.email || null;
            } catch {
                // Guest donation — no rewards
            }
        }

        // Determine reward tier
        const tier = [...DONATION_TIERS]
            .sort((a, b) => b.minAmount - a.minAmount)
            .find((t) => amountCents >= t.minAmount);

        const appUrl =
            process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

        // Create pending donation record
        const donationRef = adminDatabase
            .ref(`donations/${userId || "guest"}`)
            .push();
        const donationId = donationRef.key!;

        await donationRef.set({
            id: donationId,
            userId: userId || null,
            donorName: donorName || null,
            donorMessage: donorMessage || null,
            amount: amountCents,
            currency: currency.toUpperCase(),
            status: "pending",
            rewardIds: tier?.rewardIds || [],
            tierLabel: tier?.label || "Friend",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            customer_email: userEmail || undefined,
            line_items: [
                {
                    price_data: {
                        currency,
                        product_data: {
                            name: "AlgoVault Donation",
                            description: tier
                                ? `${tier.label} Tier — Thank you! Unlocks: ${tier.description}`
                                : "Community support donation",
                        },
                        unit_amount: amountCents,
                    },
                    quantity: 1,
                },
            ],
            metadata: {
                orderType: "donation",
                donationId,
                userId: userId || "guest",
                donorName: donorName || "",
                amount: String(amountCents),
                currency,
                tierLabel: tier?.label || "Friend",
                rewardIds: JSON.stringify(tier?.rewardIds || []),
            },
            success_url: `${appUrl}/donate/success?donation=${encodeURIComponent(donationId)}&uid=${encodeURIComponent(userId || "guest")}`,
            cancel_url: `${appUrl}/donate?cancelled=1`,
        });

        await donationRef.update({
            stripeSessionId: session.id,
            updatedAt: Date.now(),
        });

        return NextResponse.json({
            success: true,
            checkoutUrl: session.url,
            sessionId: session.id,
            donationId,
            tier: tier || null,
        });
    } catch (error: any) {
        console.error("DONATION CREATE ERROR:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to create donation checkout." },
            { status: 500 }
        );
    }
}
