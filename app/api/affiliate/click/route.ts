import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);

        const offerId = searchParams.get("offerId");

        if (!offerId) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Affiliate offer ID is required.",
                },
                { status: 400 }
            );
        }

        const offerSnapshot = await adminDatabase
            .ref(`affiliate_offers/${offerId}`)
            .get();

        if (!offerSnapshot.exists()) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Affiliate offer not found.",
                },
                { status: 404 }
            );
        }

        const offer =
            offerSnapshot.val() as Record<string, unknown>;

        if (offer.status !== "active") {
            return NextResponse.json(
                {
                    success: false,
                    error: "This affiliate offer is inactive.",
                },
                { status: 410 }
            );
        }

        const affiliateUrl =
            typeof offer.affiliateUrl === "string"
                ? offer.affiliateUrl.trim()
                : "";

        if (!affiliateUrl) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Affiliate URL is missing.",
                },
                { status: 500 }
            );
        }

        let parsedUrl: URL;

        try {
            parsedUrl = new URL(affiliateUrl);
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid affiliate URL.",
                },
                { status: 500 }
            );
        }

        /*
         * Security:
         * Only HTTPS affiliate URLs are allowed.
         */
        if (parsedUrl.protocol !== "https:") {
            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid affiliate URL protocol.",
                },
                { status: 500 }
            );
        }

        /*
         * Optional authenticated user.
         *
         * We do NOT require login for affiliate clicks.
         */
        let uid: string | null = null;

        const authorization =
            request.headers.get("authorization");

        if (authorization?.startsWith("Bearer ")) {
            try {
                const token =
                    authorization
                        .replace("Bearer ", "")
                        .trim();

                if (token) {
                    const decodedToken =
                        await adminAuth.verifyIdToken(token);

                    uid = decodedToken.uid;
                }
            } catch {
                /*
                 * Invalid/expired token is treated as
                 * anonymous click.
                 */
                uid = null;
            }
        }

        const now = Date.now();

        /*
         * Collect basic attribution information.
         */
        const userAgent =
            request.headers.get("user-agent") || "";

        const referer =
            request.headers.get("referer") || "";

        /*
         * Create click record.
         */
        const clickRef = adminDatabase
            .ref("affiliate_clicks")
            .push();

        await clickRef.set({
            offerId,
            uid,
            anonymous: !uid,
            createdAt: now,
            userAgent: userAgent.slice(0, 500),
            referer: referer.slice(0, 500),
        });

        /*
         * Increment click counter atomically.
         */
        await adminDatabase
            .ref(`affiliate_offers/${offerId}/clicks`)
            .transaction((currentValue) => {
                const current =
                    Number(currentValue || 0);

                return current + 1;
            });

        /*
         * Redirect user to the affiliate partner.
         */
        return NextResponse.redirect(
            parsedUrl.toString(),
            302
        );
    } catch (error) {
        console.error(
            "AFFILIATE CLICK ERROR:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                error: "Unable to process affiliate click.",
            },
            { status: 500 }
        );
    }
}