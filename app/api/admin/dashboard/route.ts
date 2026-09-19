import { NextRequest, NextResponse } from "next/server";
import {
    adminAuth,
    adminDatabase,
} from "@/lib/firebase-admin";

type AnyRecord = Record<string, any>;

function isObject(value: unknown): value is AnyRecord {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

export async function GET(request: NextRequest) {
    try {
        // ---------------------------------------------------------
        // 1. Verify Firebase Authentication token
        // ---------------------------------------------------------

        const authorization =
            request.headers.get("authorization");

        if (
            !authorization ||
            !authorization.startsWith("Bearer ")
        ) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const token = authorization.substring(7);

        const decodedToken =
            await adminAuth.verifyIdToken(token);

        const uid = decodedToken.uid;

        // ---------------------------------------------------------
        // 2. Verify Admin role
        // ---------------------------------------------------------

        const userSnapshot =
            await adminDatabase
                .ref(`users/${uid}`)
                .get();

        if (!userSnapshot.exists()) {
            return NextResponse.json(
                {
                    error: "User profile not found.",
                },
                { status: 403 }
            );
        }

        const user = userSnapshot.val();

        if (user?.role !== "admin") {
            return NextResponse.json(
                {
                    error: "Admin access required.",
                },
                { status: 403 }
            );
        }

        // ---------------------------------------------------------
        // 3. Load Firebase data
        // ---------------------------------------------------------

        const [
            botsSnapshot,
            usersSnapshot,
            ordersSnapshot,
            licensesSnapshot,
        ] = await Promise.all([
            adminDatabase.ref("bots").get(),
            adminDatabase.ref("users").get(),
            adminDatabase.ref("orders").get(),
            adminDatabase.ref("licenses").get(),
        ]);

        const bots = botsSnapshot.exists()
            ? botsSnapshot.val()
            : {};

        const users = usersSnapshot.exists()
            ? usersSnapshot.val()
            : {};

        const orders = ordersSnapshot.exists()
            ? ordersSnapshot.val()
            : {};

        const licenses = licensesSnapshot.exists()
            ? licensesSnapshot.val()
            : {};

        // ---------------------------------------------------------
        // 4. Total Bots
        // ---------------------------------------------------------

        const botEntries = isObject(bots)
            ? Object.entries(bots)
            : [];

        const totalBots = botEntries.length;

        const publishedBots = botEntries.filter(
            ([, bot]) =>
                isObject(bot) &&
                bot.status === "published"
        ).length;

        // ---------------------------------------------------------
        // 5. Users
        // ---------------------------------------------------------

        const userEntries = isObject(users)
            ? Object.entries(users)
            : [];

        const totalUsers = userEntries.length;

        // ---------------------------------------------------------
        // 6. Orders
        // ---------------------------------------------------------

        const orderEntries: Array<{
            id: string;
            userId: string;
            order: AnyRecord;
        }> = [];

        if (isObject(orders)) {
            Object.entries(orders).forEach(
                ([userId, userOrders]) => {
                    if (!isObject(userOrders)) {
                        return;
                    }

                    Object.entries(userOrders).forEach(
                        ([orderId, rawOrder]) => {
                            if (!isObject(rawOrder)) {
                                return;
                            }

                            orderEntries.push({
                                id: orderId,
                                userId,
                                order: rawOrder,
                            });
                        }
                    );
                }
            );
        }

        const paidOrders =
            orderEntries.filter(
                ({ order }) =>
                    order.status === "paid" ||
                    order.paymentStatus === "paid"
            );

        const totalSales = paidOrders.length;

        // ---------------------------------------------------------
        // 7. Revenue
        // ---------------------------------------------------------

        const now = new Date();

        const startOfMonth = new Date(
            now.getFullYear(),
            now.getMonth(),
            1,
            0,
            0,
            0,
            0
        ).getTime();

        const revenueThisMonth = paidOrders
            .filter(({ order }) => {
                const paidAt =
                    Number(
                        order.paidAt ||
                        order.createdAt ||
                        0
                    );

                return paidAt >= startOfMonth;
            })
            .reduce((total, { order }) => {
                const amount =
                    typeof order.amount === "number"
                        ? order.amount
                        : typeof order.price === "number"
                            ? order.price
                            : 0;

                return total + amount;
            }, 0);

        const totalRevenue = paidOrders.reduce(
            (total, { order }) => {
                const amount =
                    typeof order.amount === "number"
                        ? order.amount
                        : typeof order.price === "number"
                            ? order.price
                            : 0;

                return total + amount;
            },
            0
        );

        // ---------------------------------------------------------
        // 7b. Revenue series (last 6 months)
        // ---------------------------------------------------------

        const revenueSeries: Array<{
            label: string;
            value: number;
        }> = [];

        for (let i = 5; i >= 0; i--) {
            const d = new Date(
                now.getFullYear(),
                now.getMonth() - i,
                1
            );
            const label = d.toLocaleDateString(
                "en-US",
                { month: "short" }
            );
            const start = d.getTime();
            const end = new Date(
                now.getFullYear(),
                now.getMonth() - i + 1,
                1
            ).getTime();

            const value = paidOrders
                .filter(({ order }) => {
                    const paidAt =
                        Number(
                            order.paidAt ||
                            order.createdAt ||
                            0
                        );
                    return (
                        paidAt >= start &&
                        paidAt < end
                    );
                })
                .reduce((total, { order }) => {
                    const amount =
                        typeof order.amount === "number"
                            ? order.amount
                            : typeof order.price === "number"
                                ? order.price
                                : 0;
                    return total + amount;
                }, 0);

            revenueSeries.push({ label, value });
        }

        // ---------------------------------------------------------
        // 8. Active Licenses
        // ---------------------------------------------------------

        const nowTimestamp = Date.now();

        let totalLicenses = 0;
        let activeLicenses = 0;
        let expiredLicenses = 0;
        let revokedLicenses = 0;

        if (isObject(licenses)) {
            Object.values(licenses).forEach(
                (userLicenses) => {
                    if (!isObject(userLicenses)) {
                        return;
                    }

                    Object.values(userLicenses).forEach(
                        (rawLicense) => {
                            if (!isObject(rawLicense)) {
                                return;
                            }

                            totalLicenses++;

                            const status =
                                rawLicense.status;

                            if (
                                status === "revoked"
                            ) {
                                revokedLicenses++;
                                return;
                            }

                            const expiresAt =
                                Number(
                                    rawLicense.expiresAt ||
                                    0
                                );

                            if (
                                expiresAt > 0 &&
                                expiresAt < nowTimestamp
                            ) {
                                expiredLicenses++;
                                return;
                            }

                            if (
                                status === "active"
                            ) {
                                activeLicenses++;
                            }
                        }
                    );
                }
            );
        }

        // ---------------------------------------------------------
        // 9. Recent Bots
        // ---------------------------------------------------------

        const recentBots = botEntries
            .map(([id, rawBot]) => {
                if (!isObject(rawBot)) {
                    return null;
                }

                return {
                    id,
                    name:
                        rawBot.name ||
                        "Unnamed Product",
                    slug:
                        rawBot.slug || "",
                    market:
                        rawBot.symbol ||
                        "—",
                    timeframe:
                        rawBot.timeframe ||
                        "—",
                    platform:
                        rawBot.platform ||
                        "—",
                    productType:
                        rawBot.productType ||
                        "expert_advisor",
                    type:
                        rawBot.pricing?.type ===
                            "free"
                            ? "Free"
                            : "Paid",
                    status:
                        rawBot.status ||
                        "draft",
                    createdAt:
                        Number(
                            rawBot.createdAt ||
                            0
                        ),
                    updatedAt:
                        Number(
                            rawBot.updatedAt ||
                            rawBot.createdAt ||
                            0
                        ),
                };
            })
            .filter(Boolean)
            .sort(
                (a: any, b: any) =>
                    Number(b.updatedAt || 0) -
                    Number(a.updatedAt || 0)
            )
            .slice(0, 5);

        // ---------------------------------------------------------
        // 10. Recent Orders
        // ---------------------------------------------------------

        const recentOrders = paidOrders
            .map(({ id, userId, order }) => {
                const product =
                    order.productId &&
                        isObject(bots)
                        ? bots[order.productId]
                        : null;

                const amount =
                    typeof order.amount === "number"
                        ? order.amount
                        : typeof order.price === "number"
                            ? order.price
                            : 0;

                const customer =
                    isObject(users) &&
                        isObject(users[userId])
                        ? users[userId]
                        : null;

                return {
                    id,
                    userId,
                    email:
                        order.email ||
                        customer?.email ||
                        "",
                    productId:
                        order.productId ||
                        "",
                    productName:
                        order.productName ||
                        product?.name ||
                        "Unknown Product",
                    amount,
                    currency:
                        order.currency ||
                        product?.pricing?.currency ||
                        "USD",
                    paidAt:
                        Number(
                            order.paidAt ||
                            order.createdAt ||
                            0
                        ),
                    licenseId:
                        order.licenseId ||
                        "",
                };
            })
            .sort(
                (a, b) =>
                    b.paidAt -
                    a.paidAt
            )
            .slice(0, 5);

        // ---------------------------------------------------------
        // 11. Response
        // ---------------------------------------------------------

        return NextResponse.json(
            {
                stats: {
                    totalBots,
                    publishedBots,
                    totalUsers,
                    totalSales,
                    totalLicenses,
                    activeLicenses,
                    expiredLicenses,
                    revokedLicenses,
                    revenueThisMonth,
                    totalRevenue,
                },

                recentBots,

                recentOrders,

                revenueSeries,

                generatedAt: Date.now(),
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
            "ADMIN DASHBOARD API ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    "Failed to load dashboard data.",
            },
            {
                status: 500,
            }
        );
    }
}