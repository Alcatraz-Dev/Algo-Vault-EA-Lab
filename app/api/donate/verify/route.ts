import { NextRequest, NextResponse } from "next/server";
import {
    adminAuth,
    adminDatabase,
} from "@/lib/firebase-admin";
import { stripeClient } from "@/lib/stripe";

type DonationRecord = Record<string, unknown>;

function isValidId(value: string) {
    return (
        value.length > 0 &&
        value.length <= 200 &&
        !value.includes("/") &&
        !value.includes("\\") &&
        !value.includes("..")
    );
}

function jsonError(message: string, status: number) {
    return NextResponse.json(
        {
            success: false,
            error: message,
        },
        { status }
    );
}

function parseRewardIds(value: unknown) {
    if (Array.isArray(value)) {
        return value.filter(
            (rewardId): rewardId is string =>
                typeof rewardId === "string"
        );
    }

    if (typeof value !== "string") {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter(
                  (rewardId): rewardId is string =>
                      typeof rewardId === "string"
              )
            : [];
    } catch {
        throw new Error("Invalid donation reward metadata.");
    }
}

export async function GET(request: NextRequest) {
    try {
        const donationId =
            request.nextUrl.searchParams.get("donation") || "";
        const uid =
            request.nextUrl.searchParams.get("uid") || "";
        const requestedSessionId =
            request.nextUrl.searchParams.get("session_id") || "";

        if (
            !isValidId(donationId) ||
            !isValidId(uid) ||
            (requestedSessionId &&
                !isValidId(requestedSessionId))
        ) {
            return jsonError(
                "Invalid donation verification parameters.",
                400
            );
        }

        if (uid !== "guest") {
            const authorization =
                request.headers.get("authorization");

            if (
                !authorization ||
                !authorization.startsWith("Bearer ")
            ) {
                return jsonError(
                    "Authentication is required.",
                    401
                );
            }

            const token =
                authorization.substring("Bearer ".length).trim();
            const decodedToken =
                await adminAuth.verifyIdToken(token);

            if (decodedToken.uid !== uid) {
                return jsonError(
                    "Donation ownership verification failed.",
                    403
                );
            }
        }

        const donationRef =
            adminDatabase.ref(
                `donations/${uid}/${donationId}`
            );
        const donationSnapshot =
            await donationRef.get();

        if (!donationSnapshot.exists()) {
            return jsonError(
                "Donation not found.",
                404
            );
        }

        const donation =
            donationSnapshot.val() as DonationRecord;

        if (
            (donation.userId || "guest") !== uid
        ) {
            return jsonError(
                "Donation ownership verification failed.",
                403
            );
        }

        if (donation.status === "completed") {
            return NextResponse.json({
                success: true,
                donation,
                status: donation.status,
                verificationAvailable: true,
                stripePaymentStatus: null,
                stripeSessionStatus: null,
            });
        }

        const sessionId =
            requestedSessionId ||
            (typeof donation.stripeSessionId === "string"
                ? donation.stripeSessionId
                : "");
        let stripePaymentStatus: string | null = null;
        let stripeSessionStatus: string | null = null;

        if (!sessionId) {
            return NextResponse.json({
                success: true,
                donation,
                status: donation.status || "pending",
                verificationAvailable: false,
                stripePaymentStatus: null,
                stripeSessionStatus: null,
            });
        }

        const session =
            await stripeClient.checkout.sessions.retrieve(
                sessionId
            );
        const metadata =
            session.metadata || {};

        if (
            metadata.orderType !== "donation" ||
            metadata.donationId !== donationId ||
            (metadata.userId || "guest") !== uid
        ) {
            return jsonError(
                "Stripe donation verification failed.",
                400
            );
        }

        await donationRef.update({
            stripeSessionId: session.id,
            updatedAt: Date.now(),
        });

        stripePaymentStatus =
            session.payment_status;
        stripeSessionStatus =
            session.status;

        if (session.payment_status === "paid") {
            const rewardIds =
                parseRewardIds(
                    metadata.rewardIds
                );
            const paidAt =
                donation.paidAt || Date.now();

            await donationRef.update({
                status: "completed",
                paidAt,
                updatedAt: Date.now(),
                rewardIds,
            });

            if (
                uid !== "guest" &&
                rewardIds.length > 0
            ) {
                for (const rewardProductId of rewardIds) {
                    await adminDatabase
                        .ref(
                            `donation_rewards/${uid}/${rewardProductId}`
                        )
                        .set({
                            productId:
                                rewardProductId,
                            donationId,
                            grantedAt: Date.now(),
                            status: "active",
                        });
                }
            }

            const updatedSnapshot =
                await donationRef.get();
            Object.assign(
                donation,
                updatedSnapshot.val() || {}
            );
        }

        return NextResponse.json({
            success: true,
            donation,
            status: donation.status || "pending",
            verificationAvailable: true,
            stripePaymentStatus,
            stripeSessionStatus,
        });
    } catch (error) {
        console.error(
            "DONATION VERIFY ERROR:",
            error
        );

        return jsonError(
            "Unable to verify the donation right now.",
            500
        );
    }
}
