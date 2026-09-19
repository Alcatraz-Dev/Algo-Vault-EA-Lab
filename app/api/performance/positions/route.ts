import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: corsHeaders,
    });
}

function errorResponse(message: string, status = 400) {
    console.error(`[Positions] ERROR ${status}: ${message}`);

    return NextResponse.json(
        {
            success: false,
            error: message,
        },
        {
            status,
            headers: corsHeaders,
        }
    );
}

function parseNumber(value: unknown): number | null {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return null;
    }

    return number;
}

function parseType(value: unknown): "BUY" | "SELL" | "" {
    const str = String(value ?? "")
        .trim()
        .toUpperCase();

    if (
        str === "BUY" ||
        str === "0" ||
        str.includes("BUY")
    ) {
        return "BUY";
    }

    if (
        str === "SELL" ||
        str === "1" ||
        str.includes("SELL")
    ) {
        return "SELL";
    }

    return "";
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
        const userLicenses = licenses[userId] || {};

        for (const licenseId of Object.keys(userLicenses)) {
            const license = userLicenses[licenseId];

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

            const expiresAt =
                Number(license.expiresAt || 0);

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
                requestedMt5Account || boundAccount;

            if (
                boundAccount &&
                requestedMt5Account &&
                boundAccount !== requestedMt5Account
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
            };
        }
    }

    return {
        valid: false,
        error: "Invalid license.",
    };
}

export async function POST(
    request: NextRequest
) {
    console.log(
        "=================================================="
    );

    console.log(
        "[Positions] POST /api/performance/positions"
    );

    try {
        const body =
            (await request.json().catch(() => ({}))) as Record<
                string,
                unknown
            >;

        const productId = String(
            body.productId ?? ""
        ).trim();

        const licenseKey = String(
            body.licenseKey ?? ""
        ).trim();

        const mt5Account = String(
            body.mt5Account ??
            body.account ??
            ""
        ).trim();

        const positions =
            Array.isArray(body.positions)
                ? body.positions
                : [];

        console.log(
            "[Positions] Product:",
            productId
        );

        console.log(
            "[Positions] Account:",
            mt5Account
        );

        console.log(
            "[Positions] Incoming positions:",
            positions.length
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

        if (!mt5Account) {
            return errorResponse(
                "MT5 account is required."
            );
        }

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

        const license =
            await validateLicense(
                productId,
                licenseKey,
                mt5Account
            );

        if (!license.valid) {
            return errorResponse(
                license.error ||
                "License validation failed.",
                403
            );
        }

        const accountId =
            `${productId}_${mt5Account}`;

        const positionsRef =
            adminDatabase.ref(
                `live_positions/${accountId}`
            );

        const now = Date.now();

        // ------------------------------------------------
        // Build the current snapshot
        // ------------------------------------------------

        const snapshotData: Record<
            string,
            unknown
        > = {};

        for (const rawPosition of positions) {
            if (
                !rawPosition ||
                typeof rawPosition !== "object"
            ) {
                continue;
            }

            const position =
                rawPosition as Record<
                    string,
                    unknown
                >;

            const ticket = String(
                position.ticket ?? ""
            ).trim();

            const symbol = String(
                position.symbol ?? ""
            ).trim();

            const type =
                parseType(position.type);

            const volume =
                parseNumber(position.volume);

            const openPrice =
                parseNumber(position.openPrice);

            const currentPrice =
                parseNumber(position.currentPrice);

            const profit =
                parseNumber(position.profit);

            const swap =
                parseNumber(position.swap) ?? 0;

            const openedAt =
                parseNumber(position.openedAt);

            const magic =
                String(
                    position.magic ?? ""
                ).trim();

            if (!ticket) continue;
            if (!symbol) continue;

            if (
                type !== "BUY" &&
                type !== "SELL"
            ) {
                continue;
            }

            if (
                volume === null ||
                volume <= 0
            ) {
                continue;
            }

            if (openPrice === null) {
                continue;
            }

            if (currentPrice === null) {
                continue;
            }

            if (profit === null) {
                continue;
            }

            snapshotData[ticket] = {
                productId,
                licenseId: license.licenseId,
                userId: license.userId,

                mt5Account,
                accountId,

                ticket,
                symbol,
                type,

                volume,
                openPrice,
                currentPrice,

                profit,
                swap,

                openedAt:
                    openedAt ?? now,

                magic,

                lastSeenAt: now,
                updatedAt: now,
            };
        }

        // ------------------------------------------------
        // Replace current live snapshot
        // ------------------------------------------------

        await positionsRef.set(
            snapshotData
        );

        console.log(
            `[Positions] SUCCESS | Account: ${accountId} | Open: ${Object.keys(snapshotData).length}`
        );

        return NextResponse.json(
            {
                success: true,
                accountId,
                count:
                    Object.keys(snapshotData).length,
                positions:
                    Object.values(snapshotData),
            },
            {
                status: 200,
                headers: {
                    ...corsHeaders,
                    "Cache-Control":
                        "no-store",
                },
            }
        );
    } catch (error) {
        console.error(
            "[Positions] SERVER ERROR:",
            error
        );

        return errorResponse(
            "Unable to save open positions.",
            500
        );
    }
}
export async function GET(
    request: NextRequest
) {
    try {
        const { searchParams } =
            new URL(request.url);

        const productId =
            String(
                searchParams.get("productId") ||
                ""
            ).trim();

        const licenseKey =
            String(
                searchParams.get("licenseKey") ||
                ""
            ).trim();

        const requestedMt5Account =
            String(
                searchParams.get("mt5Account") ||
                ""
            ).trim();

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

        const mt5Account = license.mt5Account || "";

        if (!mt5Account) {
            return NextResponse.json(
                {
                    success: true,
                    accountId: "",
                    count: 0,
                    positions: [],
                },
                {
                    status: 200,
                    headers: corsHeaders,
                }
            );
        }

        const accountId =
            `${productId}_${mt5Account}`;

        let snapshot =
            await adminDatabase
                .ref(
                    `live_positions/${accountId}`
                )
                .get();

        let raw =
            snapshot.val() || {};

        if (Object.keys(raw).length === 0 && mt5Account) {
            const fallbackSnap = await adminDatabase
                .ref(`live_positions/live_${mt5Account}`)
                .get();
            raw = fallbackSnap.val() || {};
        }

        const now = Date.now();

        const positions =
            Object.values(raw).filter(
                (position: any) => {
                    if (!position) return false;
                    const lastSeenAt =
                        Number(
                            position?.lastSeenAt ||
                            position?.updatedAt ||
                            position?.openedAt ||
                            0
                        );

                    if (!lastSeenAt) return true;

                    // 24 hours window for active positions
                    return (
                        now - lastSeenAt <= 86400000
                    );
                }
            );

        return NextResponse.json(
            {
                success: true,
                accountId,
                count: positions.length,
                positions,
            },
            {
                status: 200,
                headers: {
                    ...corsHeaders,
                    "Cache-Control":
                        "no-store",
                },
            }
        );
    } catch (error) {
        console.error(
            "[Positions] GET ERROR:",
            error
        );

        return errorResponse(
            "Unable to load open positions.",
            500
        );
    }
}