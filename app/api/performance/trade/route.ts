import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { notifyUser } from "@/lib/notifications";
import { collectMatchingConfigs, mirrorMasterClose, mirrorMasterOrder, reconcileCopiedClose } from "@/lib/copy-trading";
import { findMatchingBots, indexBotTrade } from "@/lib/bots";

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
    console.error(`[Trade] ERROR ${status}: ${message}`);
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

function parseTradeType(value: unknown): string {
    if (value === 0 || value === "0" || String(value).toUpperCase() === "BUY" || String(value).toUpperCase() === "OP_BUY") {
        return "BUY";
    }
    if (value === 1 || value === "1" || String(value).toUpperCase() === "SELL" || String(value).toUpperCase() === "OP_SELL") {
        return "SELL";
    }
    const str = String(value ?? "").trim().toUpperCase();
    if (str.includes("BUY")) return "BUY";
    if (str.includes("SELL")) return "SELL";
    return "";
}

async function validateLicense(
    productId: string,
    licenseKey: string,
    mt5Account: string
) {
    const licensesSnapshot = await adminDatabase.ref("licenses").get();
    const licenses = licensesSnapshot.val() || {};

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

            const expiresAt = Number(license.expiresAt || 0);

            if (expiresAt > 0 && Date.now() >= expiresAt) {
                return {
                    valid: false,
                    error: "License has expired.",
                };
            }

            const boundAccount = String(license.mt5Account || "").trim();

            if (boundAccount && boundAccount !== mt5Account) {
                return {
                    valid: false,
                    error: "MT5 account does not match the license.",
                };
            }

            return {
                valid: true,
                licenseId,
                userId,
            };
        }
    }

    return {
        valid: false,
        error: "Invalid license.",
    };
}

type BridgedTrade = {
    accountId: string;
    mt5Account: string;
    ticket: string;
    symbol: string;
    type: string;
    volume: number;
    openPrice: number;
};

/**
 * Mirrors a master account's own newly opened trade out to every matching
 * follower config. Orders that were themselves copies are skipped to avoid
 * copy-of-copy recursion.
 */
async function bridgeMasterOpen(tradeData: BridgedTrade) {
    const ordersSnap = await adminDatabase.ref(`mt5_orders/${tradeData.mt5Account}`).get();
    const orders = (ordersSnap.val() || {}) as Record<string, Record<string, unknown>>;

    const isCopied = Object.values(orders).some(
        (o) =>
            String(o.source ?? "") === "copy_follower" &&
            (String(o.mt5Ticket ?? "") === String(tradeData.ticket) ||
                String(o.ticket ?? "") === String(tradeData.ticket))
    );
    if (isCopied) return;

    const configs = await collectMatchingConfigs(tradeData.accountId, tradeData.mt5Account);
    if (configs.length === 0) return;

    await mirrorMasterOrder({
        masterId: tradeData.accountId,
        masterMt5Account: tradeData.mt5Account,
        configs,
        notify: true,
        order: {
            ticket: tradeData.ticket,
            symbol: tradeData.symbol,
            type: tradeData.type,
            volume: tradeData.volume,
            openPrice: tradeData.openPrice,
            stopLoss: null,
            takeProfit: null,
        },
    });
}

export async function POST(request: NextRequest) {
    console.log("==================================================");
    console.log("[Trade] POST /api/performance/trade");
    console.log("[Trade] Time:", new Date().toISOString());

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

        const rawTicket = rawBody.ticket ?? rawBody.Ticket ?? rawBody.dealTicket ?? rawBody.positionTicket ?? "";
        const ticket = String(rawTicket).trim();

        const symbol = String(rawBody.symbol ?? rawBody.Symbol ?? "").trim();
        const type = parseTradeType(rawBody.type ?? rawBody.Type ?? rawBody.tradeType ?? rawBody.cmd);

        const volume = parseNumber(rawBody.volume ?? rawBody.Volume ?? rawBody.lots);
        const openPrice = parseNumber(rawBody.openPrice ?? rawBody.open_price ?? rawBody.OpenPrice);
        const closePrice = parseNumber(rawBody.closePrice ?? rawBody.close_price ?? rawBody.ClosePrice);

        const profit = parseNumber(rawBody.profit ?? rawBody.Profit ?? rawBody.floatingProfit ?? 0);
        const commission = parseNumber(rawBody.commission ?? rawBody.Commission ?? 0) ?? 0;
        const swap = parseNumber(rawBody.swap ?? rawBody.Swap ?? 0) ?? 0;

        const openedAt = parseNumber(rawBody.openedAt ?? rawBody.opened_at ?? rawBody.OpenedAt);
        const closedAt = parseNumber(rawBody.closedAt ?? rawBody.closed_at ?? rawBody.ClosedAt);

        console.log("[Trade] Ticket:", ticket || "(empty)");
        console.log("[Trade] Symbol:", symbol || "(empty)");
        console.log("[Trade] Type:", type || "(empty)");
        console.log("[Trade] Volume:", volume);
        console.log("[Trade] Open Price:", openPrice);
        console.log("[Trade] Profit:", profit);

        if (!productId) {
            return errorResponse("Product ID is required.");
        }

        if (!licenseKey) {
            return errorResponse("License key is required.");
        }

        if (!mt5Account) {
            return errorResponse("MT5 account is required.");
        }

        if (!ticket) {
            return errorResponse("Trade ticket is required.");
        }

        if (!symbol) {
            return errorResponse("Symbol is required.");
        }

        if (type !== "BUY" && type !== "SELL") {
            return errorResponse("Trade type must be BUY or SELL.");
        }

        if (volume === null || volume <= 0) {
            return errorResponse("Valid trade volume is required.");
        }

        if (openPrice === null) {
            return errorResponse("Valid open price is required.");
        }

        if (profit === null) {
            return errorResponse("Valid trade profit is required.");
        }

        const productSnapshot = await adminDatabase
            .ref(`bots/${productId}`)
            .get();

        const product = productSnapshot.val();

        if (!product || product.status !== "published") {
            return errorResponse("Product not found.", 404);
        }

        const license = await validateLicense(
            productId,
            licenseKey,
            mt5Account
        );

        if (!license.valid) {
            return errorResponse(
                license.error || "License validation failed.",
                403
            );
        }

        const accountId = `${productId}_${mt5Account}`;
        const tradeId = `${accountId}_${ticket}`;

        const tradeRef = adminDatabase.ref(`trades/${accountId}/${ticket}`);
        const existingSnapshot = await tradeRef.get();
        const existing = existingSnapshot.val();

        const now = Date.now();

        const tradeData = {
            productId,
            licenseId: license.licenseId,
            userId: license.userId,
            mt5Account,

            accountId,
            tradeId,

            ticket,

            symbol,
            type,

            volume,
            openPrice,
            closePrice,

            profit,
            commission,
            swap,

            openedAt: openedAt ?? now,
            closedAt: closedAt ?? (closePrice !== null ? now : null),

            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        await tradeRef.set(tradeData);

        console.log(`[Trade] SUCCESS: Trade ${ticket} saved under account ${accountId}.`);

        // ── Bot attribution (marketplace + custom) ─────────────────────────
        // Marketplace bots keep using this route as before. When a matched
        // user bot exists (by magic), index the trade under bot_trades so the
        // unified bot dashboard reflects it too.
        const matches = await findMatchingBots(license.userId as string, mt5Account, rawBody.magic ?? rawBody.magicNumber, symbol, String(rawBody.comment || ""));
        if (matches.length > 0) {
            const magic = String(rawBody.magic ?? rawBody.magicNumber ?? "");
            await indexBotTrade(matches[0].bot.id, {
                ...tradeData,
                magic,
                comment: String(rawBody.comment || ""),
            });
        }

        // ── Discord / Telegram notifications ────────────────────────────────
        // Notify once on entry (new trade) and once on close (open → closed).
        const isNewOpen = !existing;
        const isClose = !existing?.closedAt && tradeData.closedAt !== null && tradeData.closedAt !== undefined;

        if ((isNewOpen || isClose) && tradeData.userId) {
            const sign = Number(tradeData.profit || 0) >= 0 ? "+" : "";
            void notifyUser(tradeData.userId, {
                title: isClose ? "Trade Closed" : "Trade Opened",
                message: `${tradeData.symbol} ${tradeData.type} · ${tradeData.volume} lots @ ${tradeData.openPrice}` +
                    (isClose ? `\nProfit: ${sign}$${Number(tradeData.profit || 0).toFixed(2)}` : ""),
                level: isClose ? (Number(tradeData.profit || 0) >= 0 ? "success" : "error") : "info",
                link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/account`,
            });
        }

// ── Copy trading bridge ─────────────────────────────────────────────
        // A master's newly opened trade is mirrored out to follower accounts;
        // a follower reporting a close settles the copied_trades ledger and
        // the config's totalProfit.
        if (tradeData.accountId && tradeData.mt5Account) {
            if (isClose) {
                await reconcileCopiedClose({
                    accountId: tradeData.accountId,
                    mt5Account: tradeData.mt5Account,
                    ticket: tradeData.ticket,
                    closePrice: tradeData.closePrice,
                    profit: Number(tradeData.profit || 0),
                    closedAt: Number(tradeData.closedAt || now),
                });

                const ordersSnap = await adminDatabase.ref(`mt5_orders/${tradeData.mt5Account}`).get();
                const orders = (ordersSnap.val() || {}) as Record<string, Record<string, unknown>>;
                const isCopied = Object.values(orders).some(
                    (o) =>
                        String(o.source ?? "") === "copy_follower" &&
                        (String(o.mt5Ticket ?? "") === String(tradeData.ticket) ||
                            String(o.ticket ?? "") === String(tradeData.ticket))
                );
                if (!isCopied) {
                    await mirrorMasterClose({
                        masterId: tradeData.accountId,
                        masterMt5Account: tradeData.mt5Account,
                        masterTicket: tradeData.ticket,
                        closePrice: tradeData.closePrice,
                        notify: true,
                    });
                }
            } else if (isNewOpen) {
                await bridgeMasterOpen({
                    accountId: tradeData.accountId,
                    mt5Account: tradeData.mt5Account,
                    ticket: tradeData.ticket,
                    symbol: tradeData.symbol,
                    type: tradeData.type,
                    volume: tradeData.volume,
                    openPrice: tradeData.openPrice,
                });
            }
        }

        return NextResponse.json(
            {
                success: true,
                created: !existing,
                updated: !!existing,
                tradeId,
                accountId,
                licenseId: license.licenseId,
                trade: tradeData,
            },
            {
                status: 200,
                headers: corsHeaders,
            }
        );
    } catch (error) {
        console.error("PERFORMANCE TRADE ERROR:", error);
        return errorResponse("Unable to save trade.", 500);
    }
}