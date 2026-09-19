import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { collectMatchingConfigs, mirrorMasterOrder } from "@/lib/copy-trading";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type LicenseRecord = {
    productId?: string;
    licenseKey?: string;
    status?: string;
    expiresAt?: number;
    mt5Account?: string | number;
    [key: string]: unknown;
};

type Mt5OrderRecord = {
    ticket?: string | number;
    status?: string;
    type?: string;
    symbol?: string;
    volume?: number;
    openPrice?: number;
    entryPrice?: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    source?: string;
    masterTicket?: string | number;
    [key: string]: unknown;
};

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: corsHeaders,
    });
}

function jsonError(message: string, status = 400) {
    console.error(
        `[Heartbeat] ERROR ${status}: ${message}`
    );

    return NextResponse.json(
        {
            success: false,
            error: message,
        },
        { status, headers: corsHeaders }
    );
}

function parseNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" || typeof value === "number") {
        const cleaned = String(value).trim();
        if (cleaned !== "") {
            const num = Number(cleaned);
            if (Number.isFinite(num)) {
                return num;
            }
        }
    }
    return null;
}

export async function POST(request: NextRequest) {
    console.log(
        "=================================================="
    );
    console.log(
        "[Heartbeat] POST /api/performance/heartbeat"
    );
    console.log(
        "[Heartbeat] Time:",
        new Date().toISOString()
    );

    try {
        const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;

        const productId = String(
            rawBody.productId ?? rawBody.product_id ?? rawBody.ProductId ?? ""
        ).trim();

        const licenseKey = String(
            rawBody.licenseKey ?? rawBody.license_key ?? rawBody.LicenseKey ?? ""
        ).trim();

        const mt5Account = String(
            rawBody.mt5Account ?? rawBody.mt5_account ?? rawBody.account ?? rawBody.Account ?? rawBody.accountNumber ?? ""
        ).trim();

        const balance = parseNumber(rawBody.balance ?? rawBody.Balance);
        const equity = parseNumber(rawBody.equity ?? rawBody.Equity);

        const rawFloating = rawBody.floatingProfit ?? rawBody.floating_profit ?? rawBody.FloatingProfit ?? rawBody.profit;
        const floatingProfit = parseNumber(rawFloating) ?? ((equity !== null && balance !== null) ? equity - balance : 0);

        const broker = String(rawBody.broker ?? rawBody.Broker ?? "").trim();
        const server = String(rawBody.server ?? rawBody.Server ?? "").trim();
        const currency = String(rawBody.currency ?? rawBody.Currency ?? "").trim();

        console.log(
            "[Heartbeat] Product:",
            productId || "(empty)"
        );

        console.log(
            "[Heartbeat] MT5 Account:",
            mt5Account || "(empty)"
        );

        console.log(
            "[Heartbeat] Broker:",
            broker || "(empty)"
        );

        console.log(
            "[Heartbeat] Server:",
            server || "(empty)"
        );

        console.log(
            "[Heartbeat] Balance:",
            balance
        );

        console.log(
            "[Heartbeat] Equity:",
            equity
        );

        if (!productId) {
            return jsonError(
                "Product ID is required."
            );
        }

        if (!licenseKey) {
            return jsonError(
                "License key is required."
            );
        }

        if (!mt5Account) {
            return jsonError(
                "MT5 account is required."
            );
        }

        if (balance === null) {
            return jsonError(
                "Valid balance is required."
            );
        }

        if (equity === null) {
            return jsonError(
                "Valid equity is required."
            );
        }

        // ------------------------------------------------
        // Product
        // ------------------------------------------------

        const productSnapshot =
            await adminDatabase
                .ref(`bots/${productId}`)
                .get();

        const product =
            productSnapshot.val();

        if (!product) {
            return jsonError(
                "Product not found.",
                404
            );
        }

        if (product.status !== "published") {
            return jsonError(
                "Product is not published.",
                403
            );
        }

        console.log(
            "[Heartbeat] Product OK:",
            product.name || productId
        );

        // ------------------------------------------------
        // Find license
        // ------------------------------------------------

        const licensesSnapshot =
            await adminDatabase
                .ref("licenses")
                .get();

        const licenses =
            licensesSnapshot.val() || {};

        let matchedLicense: LicenseRecord | null = null;
        let matchedLicenseId = "";
        let matchedUserId = "";

        for (const userId of Object.keys(
            licenses
        )) {
            const userLicenses =
                licenses[userId] || {};

            for (const licenseId of Object.keys(
                userLicenses
            )) {
                const license =
                    userLicenses[licenseId];

                if (
                    license?.productId ===
                    productId &&
                    license?.licenseKey ===
                    licenseKey
                ) {
                    matchedLicense =
                        license;

                    matchedLicenseId =
                        licenseId;

                    matchedUserId =
                        userId;

                    break;
                }
            }

            if (matchedLicense) {
                break;
            }
        }

        if (!matchedLicense) {
            return jsonError(
                "Invalid license.",
                403
            );
        }

        console.log(
            "[Heartbeat] License OK:",
            matchedLicenseId
        );

        // ------------------------------------------------
        // License status
        // ------------------------------------------------

        if (
            matchedLicense.status !==
            "active"
        ) {
            return jsonError(
                "License is not active.",
                403
            );
        }

        const expiresAt =
            Number(
                matchedLicense.expiresAt || 0
            );

        if (
            expiresAt > 0 &&
            Date.now() >= expiresAt
        ) {
            return jsonError(
                "License has expired.",
                403
            );
        }

        // ------------------------------------------------
        // Account binding
        // ------------------------------------------------

        const boundAccount =
            String(
                matchedLicense.mt5Account ??
                ""
            ).trim();

        console.log(
            "[Heartbeat] License account:",
            boundAccount || "(not bound)"
        );

        console.log(
            "[Heartbeat] Incoming account:",
            mt5Account
        );

        if (
            boundAccount &&
            boundAccount !== mt5Account
        ) {
            return jsonError(
                "MT5 account does not match the license.",
                403
            );
        }

        // ------------------------------------------------
        // Bind account if license has no account
        // ------------------------------------------------

        if (!boundAccount) {
            console.log(
                "[Heartbeat] Binding license to account:",
                mt5Account
            );

            await adminDatabase
                .ref(
                    `licenses/${matchedUserId}/${matchedLicenseId}`
                )
                .update({
                    mt5Account,
                    updatedAt: Date.now(),
                });
        }

        // ------------------------------------------------
        // Performance data
        // ------------------------------------------------

        const now = Date.now();

        const accountId =
            `${productId}_${mt5Account}`;

        console.log(
            "[Heartbeat] Account ID:",
            accountId
        );

        // ------------------------------------------------
        // Existing account
        // ------------------------------------------------

        const accountRef =
            adminDatabase.ref(
                `live_accounts/${accountId}`
            );

        const existingSnapshot =
            await accountRef.get();

        const existing =
            existingSnapshot.val() || {};

        const previousPeak =
            Number(
                existing.peakEquity || 0
            );

        const peakEquity =
            Math.max(
                previousPeak,
                equity
            );

        const drawdown =
            peakEquity > 0
                ? Number(
                    (
                        (
                            (peakEquity -
                                equity) /
                            peakEquity
                        ) *
                        100
                    ).toFixed(2)
                )
                : 0;

        // ------------------------------------------------
        // Account
        // ------------------------------------------------

        const accountData = {
            productId,
            productName: product.name || productId,

            licenseId:
                matchedLicenseId,

            userId:
                matchedUserId,
            ownerUid:
                matchedUserId,

            mt5Account,

            broker,
            server,
            currency,

            balance,
            equity,
            floatingProfit,

            peakEquity,
            drawdown,

            status: "online",
            allowCopyTrading:
                existing.allowCopyTrading === true,
            copyTradingOverride:
                existing.copyTradingOverride || null,

            lastHeartbeatAt: now,

            createdAt:
                existing.createdAt ||
                now,

            updatedAt: now,
        };

        await accountRef.set(
            accountData
        );

        console.log(
            "[Heartbeat] live_accounts updated."
        );

        // ------------------------------------------------
        // Live performance
        // ------------------------------------------------

        await adminDatabase
            .ref(
                `live_performance/${productId}/${accountId}`
            )
            .update({
                productId,
                accountId,
                mt5Account,
                balance,
                equity,
                floatingProfit,
                peakEquity,
                drawdown,
                status: "online",
                lastUpdateAt: now,
            });

        console.log(
            "[Heartbeat] live_performance updated."
        );

        // ------------------------------------------------
        // Equity history
        // ------------------------------------------------

        await adminDatabase
            .ref(
                `live_equity/${accountId}/${now}`
            )
            .set({
                timestamp: now,
                balance,
                equity,
                floatingProfit,
                peakEquity,
                drawdown,
            });

        // ------------------------------------------------
        // Check for pending signal trade orders to dispatch to MT5
        // ------------------------------------------------

        const ordersSnapshot = await adminDatabase
            .ref(`mt5_orders/${mt5Account}`)
            .get();

        const ordersData = ordersSnapshot.val() || {};
        const pendingOrders: Mt5OrderRecord[] = [];

        for (const orderTicket of Object.keys(ordersData)) {
            const item = ordersData[orderTicket];
            if (item && item.status === "PENDING_MT5_EXECUTION") {
                pendingOrders.push(item);
            }
        }

        console.log(
            `[Heartbeat] SUCCESS: ${pendingOrders.length} pending orders for MT5.`
        );

        // ------------------------------------------------
        // Copy trading: fan out pending orders to active follower accounts
        // ------------------------------------------------

        const copiedOrders: Record<string, unknown>[] = [];

        if (pendingOrders.length > 0) {
            const configs = await collectMatchingConfigs(accountId, mt5Account);

            for (const order of pendingOrders) {
                const mirrored = await mirrorMasterOrder({
                    masterId: accountId,
                    masterMt5Account: mt5Account,
                    order,
                    configs,
                    notify: true,
                });
                copiedOrders.push(...mirrored);
            }
        }

        console.log(
            `[Heartbeat] Copy trading: ${copiedOrders.length} orders fanned out to followers.`
        );

        console.log(
            "=================================================="
        );

        return NextResponse.json(
            {
                success: true,

                accountId,

                productId,

                licenseId:
                    matchedLicenseId,

                mt5Account,

                balance,
                equity,
                floatingProfit,

                peakEquity,
                drawdown,

                pendingOrders,

                copiedOrders,

                timestamp: now,
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
            "[Heartbeat] FATAL ERROR:",
            error
        );

        console.log(
            "=================================================="
        );

        return jsonError(
            "Unable to process heartbeat.",
            500
        );
    }
}
