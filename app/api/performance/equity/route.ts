import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";

function errorResponse(
    message: string,
    status = 400
) {
    return NextResponse.json(
        {
            success: false,
            error: message,
        },
        { status }
    );
}

async function validateLicense(
    productId: string,
    licenseKey: string,
    requestedMt5Account?: string
) {
    const snapshot = await adminDatabase
        .ref("licenses")
        .get();

    const licenses = snapshot.val() || {};

    for (const userId of Object.keys(licenses)) {
        const userLicenses =
            licenses[userId] || {};

        for (const licenseId of Object.keys(userLicenses)) {
            const license =
                userLicenses[licenseId];

            if (
                license?.productId !== productId ||
                license?.licenseKey !== licenseKey
            ) {
                continue;
            }

            if (license.status !== "active") {
                return {
                    valid: false,
                    error: "License is not active.",
                };
            }

            const expiresAt = Number(
                license.expiresAt || 0
            );

            if (
                expiresAt > 0 &&
                Date.now() >= expiresAt
            ) {
                return {
                    valid: false,
                    error: "License has expired.",
                };
            }

            const boundAccount =
                String(
                    license.mt5Account || ""
                ).trim();

            const mt5Account =
                requestedMt5Account ||
                boundAccount;

            if (
                boundAccount &&
                requestedMt5Account &&
                boundAccount !==
                requestedMt5Account
            ) {
                return {
                    valid: false,
                    error:
                        "MT5 account does not match the license.",
                };
            }

            return {
                valid: true,
                licenseId,
                userId,
                mt5Account,
                waitingForMt5:
                    !mt5Account,
            };
        }
    }

    return {
        valid: false,
        error: "Invalid license.",
    };
}

export async function GET(
    request: NextRequest
) {
    try {
        const { searchParams } =
            new URL(request.url);

        const productId =
            searchParams
                .get("productId")
                ?.trim() || "";

        const licenseKey =
            searchParams
                .get("licenseKey")
                ?.trim() || "";

        const requestedMt5Account =
            searchParams
                .get("mt5Account")
                ?.trim() || "";

        const hoursParam =
            Number(
                searchParams.get("hours") ||
                "24"
            );

        if (!productId) {
            return errorResponse(
                "Product ID is required."
            );
        }

        if (!licenseKey) {
            return errorResponse(
                "License key is required."
            );
        }

        const hours =
            Number.isFinite(hoursParam) &&
                hoursParam > 0
                ? Math.min(
                    hoursParam,
                    720
                )
                : 24;

        /*
         * ------------------------------------------------
         * PRODUCT
         * ------------------------------------------------
         */

        const productSnapshot =
            await adminDatabase
                .ref(`bots/${productId}`)
                .get();

        const product =
            productSnapshot.val();

        if (
            !product ||
            product.status !== "published"
        ) {
            return errorResponse(
                "Product not found.",
                404
            );
        }

        /*
         * ------------------------------------------------
         * LICENSE
         * ------------------------------------------------
         */

        const license =
            await validateLicense(
                productId,
                licenseKey,
                requestedMt5Account
            );

        if (!license.valid) {
            return errorResponse(
                license.error ||
                "License validation failed.",
                403
            );
        }

        /*
         * ------------------------------------------------
         * WAITING FOR MT5
         *
         * The license is valid but no MT5 account
         * has been bound yet.
         * The EA will bind it automatically.
         * ------------------------------------------------
         */

        const mt5Account =
            license.mt5Account || "";

        if (!mt5Account) {
            return NextResponse.json(
                {
                    success: true,
                    productId,
                    licenseId:
                        license.licenseId,
                    mt5Account: "",
                    hours,
                    waitingForMt5: true,
                    points: [],
                    count: 0,
                    timestamp: Date.now(),
                },
                {
                    status: 200,
                    headers: {
                        "Cache-Control":
                            "no-store",
                    },
                }
            );
        }

        /*
         * ------------------------------------------------
         * ACCOUNT ID
         * ------------------------------------------------
         */

        const accountId =
            `${productId}_${mt5Account}`;

        /*
         * ------------------------------------------------
         * CHECK ACCOUNT
         *
         * If the EA has not sent a heartbeat yet,
         * return an empty graph instead of an error.
         * ------------------------------------------------
         */

        const accountSnapshot =
            await adminDatabase
                .ref(
                    `live_accounts/${accountId}`
                )
                .get();

        const account =
            accountSnapshot.val();

        if (!account) {
            return NextResponse.json(
                {
                    success: true,
                    accountId,
                    productId,
                    licenseId:
                        license.licenseId,
                    mt5Account,
                    hours,
                    waitingForMt5: true,
                    points: [],
                    count: 0,
                    timestamp: Date.now(),
                },
                {
                    status: 200,
                    headers: {
                        "Cache-Control":
                            "no-store",
                    },
                }
            );
        }

        /*
         * ------------------------------------------------
         * EQUITY HISTORY
         * ------------------------------------------------
         */

        const fromTimestamp =
            Date.now() -
            hours *
            60 *
            60 *
            1000;

        const snapshot =
            await adminDatabase
                .ref(
                    `live_equity/${accountId}`
                )
                .orderByKey()
                .startAt(
                    String(fromTimestamp)
                )
                .get();

        const data =
            snapshot.val() || {};

        /*
         * ------------------------------------------------
         * NORMALIZE POINTS
         * ------------------------------------------------
         */

        const points =
            Object.values(data)
                .map(
                    (point: any) => ({
                        timestamp:
                            Number(
                                point?.timestamp ||
                                0
                            ),

                        balance:
                            Number(
                                point?.balance ||
                                0
                            ),

                        equity:
                            Number(
                                point?.equity ||
                                0
                            ),

                        floatingProfit:
                            Number(
                                point?.floatingProfit ||
                                0
                            ),

                        peakEquity:
                            Number(
                                point?.peakEquity ||
                                0
                            ),

                        drawdown:
                            Number(
                                point?.drawdown ||
                                0
                            ),
                    })
                )
                .filter(
                    (point) =>
                        point.timestamp >
                        0
                )
                .sort(
                    (a, b) =>
                        a.timestamp -
                        b.timestamp
                );

        /*
         * ------------------------------------------------
         * RESPONSE
         * ------------------------------------------------
         */

        return NextResponse.json(
            {
                success: true,

                accountId,

                productId,

                licenseId:
                    license.licenseId,

                mt5Account,

                hours,

                waitingForMt5: false,

                points,

                count:
                    points.length,

                timestamp:
                    Date.now(),
            },
            {
                status: 200,
                headers: {
                    "Cache-Control":
                        "no-store",
                },
            }
        );
    } catch (error) {
        console.error(
            "PERFORMANCE EQUITY ERROR:",
            error
        );

        return errorResponse(
            "Unable to load equity history.",
            500
        );
    }
}