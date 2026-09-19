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

            /*
             * If the browser did not provide an MT5
             * account, use the account already bound
             * to the license.
             */
            const mt5Account =
                requestedMt5Account ||
                boundAccount;

            /*
             * If an account is already bound to the
             * license, it must match the requested one.
             */
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

            /*
             * The license may not have an account
             * bound yet. In that case the Live dashboard
             * cannot identify the account until MT5
             * sends its first heartbeat.
             */
            if (!mt5Account) {
                return {
                    valid: true,
                    licenseId,
                    userId,
                    mt5Account: "",
                    waitingForMt5: true,
                };
            }

            return {
                valid: true,
                licenseId,
                userId,
                mt5Account,
                waitingForMt5: false,
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

        /*
         * Optional now.
         *
         * The Live page does not need to provide
         * the MT5 account anymore.
         */
        const requestedMt5Account =
            searchParams
                .get("mt5Account")
                ?.trim() || "";

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

        const mt5Account =
            license.mt5Account || "";

        const emptyStats = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            breakevenTrades: 0,
            winRate: 0,
            netProfit: 0,
            totalProfit: 0,
            grossProfit: 0,
            grossLoss: 0,
            profitFactor: 0,
            averageWin: 0,
            averageLoss: 0,
            largestWin: 0,
            largestLoss: 0,
            bestTrade: 0,
            worstTrade: 0,
            maxDrawdown: 0,
        };

        /*
         * License exists but MT5 has never sent
         * a heartbeat and there is no bound account.
         */
        if (!mt5Account) {
            return NextResponse.json(
                {
                    success: true,
                    productId,
                    licenseId: license.licenseId,
                    mt5Account: "",
                    status: "offline",
                    online: false,
                    waitingForMt5: true,
                    account: null,
                    trades: [],
                    stats: emptyStats,
                    statistics: emptyStats,
                    timestamp: Date.now(),
                },
                {
                    status: 200,
                    headers: {
                        "Cache-Control": "no-store",
                    },
                }
            );
        }

        const accountId = `${productId}_${mt5Account}`;

        const accountSnapshot = await adminDatabase
            .ref(`live_accounts/${accountId}`)
            .get();

        const account = accountSnapshot.val();

        if (!account) {
            return NextResponse.json(
                {
                    success: true,
                    accountId,
                    productId,
                    licenseId: license.licenseId,
                    mt5Account,
                    status: "offline",
                    online: false,
                    waitingForMt5: true,
                    account: null,
                    trades: [],
                    stats: emptyStats,
                    statistics: emptyStats,
                    timestamp: Date.now(),
                },
                {
                    status: 200,
                    headers: {
                        "Cache-Control": "no-store",
                    },
                }
            );
        }

        const lastHeartbeatAt =
            Number(
                account.lastHeartbeatAt ||
                0
            );

        const online =
            lastHeartbeatAt > 0 &&
            Date.now() -
            lastHeartbeatAt <=
            2 * 60 * 1000;

        const tradesSnapshot =
            await adminDatabase
                .ref(
                    `trades/${accountId}`
                )
                .get();

        const tradesData =
            tradesSnapshot.val() || {};

        const trades = Object.values(tradesData)
            .map((trade: any) => {
                const profit = Number(trade?.profit || 0);
                const commission = Number(trade?.commission || 0);
                const swap = Number(trade?.swap || 0);
                const netProfit = Number((profit + commission + swap).toFixed(2));

                return {
                    ticket: String(trade?.ticket || ""),
                    symbol: trade?.symbol || "",
                    type: trade?.type || "",
                    volume: Number(trade?.volume || 0),
                    openPrice: Number(trade?.openPrice || 0),
                    closePrice:
                        trade?.closePrice !== null && trade?.closePrice !== undefined
                            ? Number(trade.closePrice)
                            : null,
                    profit,
                    commission,
                    swap,
                    netProfit,
                    openedAt: trade?.openedAt || null,
                    closedAt: trade?.closedAt || null,
                    createdAt: trade?.createdAt || 0,
                };
            })
            .sort(
                (a, b) =>
                    Number(b.closedAt || b.createdAt || 0) -
                    Number(a.closedAt || a.createdAt || 0)
            );

        let totalTrades = 0;
        let winningTrades = 0;
        let losingTrades = 0;
        let breakevenTrades = 0;

        let totalProfit = 0;
        let grossProfit = 0;
        let grossLoss = 0;

        let bestTrade = 0;
        let worstTrade = 0;

        for (const trade of trades) {
            const netProfit = Number(trade.netProfit || 0);

            totalTrades += 1;
            totalProfit += netProfit;

            if (netProfit > 0) {
                winningTrades += 1;
                grossProfit += netProfit;
            } else if (netProfit < 0) {
                losingTrades += 1;
                grossLoss += Math.abs(netProfit);
            } else {
                breakevenTrades += 1;
            }

            if (totalTrades === 1 || netProfit > bestTrade) {
                bestTrade = netProfit;
            }

            if (totalTrades === 1 || netProfit < worstTrade) {
                worstTrade = netProfit;
            }
        }

        const winRate =
            totalTrades > 0
                ? Number(((winningTrades / totalTrades) * 100).toFixed(2))
                : 0;

        const profitFactor =
            grossLoss > 0
                ? Number((grossProfit / grossLoss).toFixed(2))
                : grossProfit > 0
                    ? 999.99
                    : 0;

        const averageWin =
            winningTrades > 0
                ? Number((grossProfit / winningTrades).toFixed(2))
                : 0;

        const averageLoss =
            losingTrades > 0
                ? Number((grossLoss / losingTrades).toFixed(2))
                : 0;

        const maxDrawdown = Number(account.drawdown || 0);

        const statistics = {
            totalTrades,
            winningTrades,
            losingTrades,
            breakevenTrades,
            winRate,

            netProfit: Number(totalProfit.toFixed(2)),
            totalProfit: Number(totalProfit.toFixed(2)),

            grossProfit: Number(grossProfit.toFixed(2)),
            grossLoss: Number(grossLoss.toFixed(2)),

            profitFactor,
            averageWin,
            averageLoss,

            largestWin: Number(bestTrade.toFixed(2)),
            largestLoss: Number(Math.abs(worstTrade).toFixed(2)),

            bestTrade: Number(bestTrade.toFixed(2)),
            worstTrade: Number(worstTrade.toFixed(2)),

            maxDrawdown,
        };

        return NextResponse.json(
            {
                success: true,

                accountId,

                productId,

                licenseId: license.licenseId,

                mt5Account,

                status: online ? "online" : "offline",

                online,

                waitingForMt5: false,

                account: {
                    productId: account.productId,

                    mt5Account: account.mt5Account,

                    broker: account.broker || "",

                    server: account.server || "",

                    currency: account.currency || "",

                    balance: Number(account.balance || 0),

                    equity: Number(account.equity || 0),

                    floatingProfit: Number(account.floatingProfit || 0),

                    peakEquity: Number(account.peakEquity || 0),

                    drawdown: maxDrawdown,

                    status: online ? "online" : "offline",

                    lastHeartbeatAt: account.lastHeartbeatAt || null,

                    updatedAt: account.updatedAt || null,
                },

                stats: statistics,

                statistics,

                trades,

                timestamp: Date.now(),
            },
            {
                status: 200,
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    } catch (error) {
        console.error(
            "PERFORMANCE ACCOUNT ERROR:",
            error
        );

        return errorResponse(
            "Unable to load account performance.",
            500
        );
    }
}