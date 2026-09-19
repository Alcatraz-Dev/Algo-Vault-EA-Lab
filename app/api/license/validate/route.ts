import { NextRequest, NextResponse } from 'next/server';
import { adminDatabase } from "@/lib/firebase-admin";

type License = {
    productId?: string;
    licenseKey?: string;
    status?: string;
    expiresAt?: number;
    mt5Account?: string | number | null;
    maxAccounts?: number;
};

export async function POST(
    request: NextRequest
) {

    try {
        // –––––––––––––––––––––––––
        // 1. Read request
        // –––––––––––––––––––––––––
        const body = await request.json();

        const licenseKey =
            typeof body.licenseKey === "string"
                ? body.licenseKey.trim()
                : "";

        const productId =
            typeof body.productId === "string"
                ? body.productId.trim()
                : "";

        const mt5Account =
            body.mt5Account !== undefined &&
                body.mt5Account !== null
                ? String(body.mt5Account).trim()
                : "";

        if (
            !licenseKey ||
            !productId ||
            !mt5Account
        ) {
            return NextResponse.json(
                {
                    valid: false,
                    error:
                        "licenseKey, productId and mt5Account are required.",
                },
                { status: 400 }
            );
        }

        // --------------------------------------------------
        // 2. Load licenses
        // --------------------------------------------------

        const snapshot =
            await adminDatabase
                .ref("licenses")
                .get();

        if (!snapshot.exists()) {
            return NextResponse.json(
                {
                    valid: false,
                    error: "License not found.",
                },
                { status: 404 }
            );
        }

        const allUsers =
            snapshot.val();

        let foundLicense: License | null =
            null;

        let foundUserId: string | null =
            null;

        let foundLicenseId: string | null =
            null;

        // --------------------------------------------------
        // 3. Find license
        // --------------------------------------------------

        for (
            const userId of Object.keys(
                allUsers
            )
        ) {
            const userLicenses =
                allUsers[userId];

            if (
                !userLicenses ||
                typeof userLicenses !==
                "object"
            ) {
                continue;
            }

            for (
                const licenseId of Object.keys(
                    userLicenses
                )
            ) {
                const license =
                    userLicenses[
                    licenseId
                    ] as License;

                if (
                    license &&
                    license.licenseKey ===
                    licenseKey
                ) {
                    foundLicense =
                        license;

                    foundUserId =
                        userId;

                    foundLicenseId =
                        licenseId;

                    break;
                }
            }

            if (foundLicense) {
                break;
            }
        }

        // --------------------------------------------------
        // 4. License not found
        // --------------------------------------------------

        if (
            !foundLicense ||
            !foundUserId ||
            !foundLicenseId
        ) {
            return NextResponse.json(
                {
                    valid: false,
                    error:
                        "Invalid license key.",
                    status: "not_found",
                },
                { status: 404 }
            );
        }

        // --------------------------------------------------
        // 5. Product validation
        // --------------------------------------------------

        if (
            foundLicense.productId !==
            productId
        ) {
            return NextResponse.json(
                {
                    valid: false,
                    error:
                        "License does not belong to this product.",
                    status:
                        "product_mismatch",
                },
                { status: 403 }
            );
        }

        // --------------------------------------------------
        // 6. Status validation
        // --------------------------------------------------

        if (
            foundLicense.status !==
            "active"
        ) {
            return NextResponse.json(
                {
                    valid: false,
                    error:
                        "License is not active.",
                    status:
                        foundLicense.status ||
                        "unknown",
                },
                { status: 403 }
            );
        }

        // --------------------------------------------------
        // 7. Expiration validation
        // --------------------------------------------------

        const now = Date.now();

        const expiresAt =
            Number(
                foundLicense.expiresAt ||
                0
            );

        if (
            !expiresAt ||
            expiresAt <= now
        ) {
            await adminDatabase
                .ref(
                    `licenses/${foundUserId}/${foundLicenseId}`
                )
                .update({
                    status: "expired",
                    updatedAt: now,
                });

            return NextResponse.json(
                {
                    valid: false,
                    error:
                        "License has expired.",
                    status: "expired",
                    expiresAt,
                },
                { status: 403 }
            );
        }

        // --------------------------------------------------
        // 8. MT5 account validation / binding
        // --------------------------------------------------

        const existingAccount =
            foundLicense.mt5Account
                ? String(
                    foundLicense.mt5Account
                ).trim()
                : "";

        if (existingAccount) {
            // Already bound
            if (
                existingAccount !==
                mt5Account
            ) {
                return NextResponse.json(
                    {
                        valid: false,
                        error:
                            "License is already bound to another MT5 account.",
                        status:
                            "account_mismatch",
                    },
                    { status: 403 }
                );
            }
        } else {
            // First MT5 account connection
            await adminDatabase
                .ref(
                    `licenses/${foundUserId}/${foundLicenseId}`
                )
                .update({
                    mt5Account,
                    boundAt: now,
                    updatedAt: now,
                });
        }

        // --------------------------------------------------
        // 9. Calculate remaining days
        // --------------------------------------------------

        const daysRemaining =
            Math.max(
                0,
                Math.ceil(
                    (expiresAt -
                        now) /
                    (1000 *
                        60 *
                        60 *
                        24)
                )
            );

        // --------------------------------------------------
        // 10. Update last validation
        // --------------------------------------------------

        await adminDatabase
            .ref(
                `licenses/${foundUserId}/${foundLicenseId}`
            )
            .update({
                lastValidatedAt:
                    now,
            });

        // --------------------------------------------------
        // 11. Successful validation
        // --------------------------------------------------

        return NextResponse.json({
            valid: true,
            status: "active",

            licenseId:
                foundLicenseId,

            productId:
                foundLicense.productId,

            expiresAt,

            mt5Account,

            daysRemaining,
        });
    } catch (error) {
        console.error(
            "LICENSE VALIDATION ERROR:",
            error
        );

        return NextResponse.json(
            {
                valid: false,
                error:
                    "License validation failed.",
                status: "server_error",
            },
            { status: 500 }
        );
    }
}