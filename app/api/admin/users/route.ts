import { NextRequest, NextResponse } from "next/server";
import {
    adminAuth,
    adminDatabase,
} from "@/lib/firebase-admin";

type UserRecord = {
    email?: string;
    displayName?: string;
    role?: string;
    createdAt?: number;
    photoURL?: string;
    [key: string]: unknown;
};

type OrderRecord = {
    status?: string;
    paymentStatus?: string;
    amount?: number;
    price?: number;
    currency?: string;
    createdAt?: number;
    paidAt?: number;
    productId?: string;
    [key: string]: unknown;
};

export async function GET(request: NextRequest) {
    try {
        // ---------------------------------------------------------
        // 1. Verify Firebase token
        // ---------------------------------------------------------

        const authorization =
            request.headers.get("authorization");

        if (
            !authorization ||
            !authorization.startsWith("Bearer ")
        ) {
            return NextResponse.json(
                {
                    error: "Unauthorized",
                },
                {
                    status: 401,
                }
            );
        }

        const token =
            authorization.substring(7);

        const decodedToken =
            await adminAuth.verifyIdToken(token);

        const adminUid =
            decodedToken.uid;

        // ---------------------------------------------------------
        // 2. Verify admin role
        // ---------------------------------------------------------

        const adminSnapshot =
            await adminDatabase
                .ref(`users/${adminUid}`)
                .get();

        if (!adminSnapshot.exists()) {
            return NextResponse.json(
                {
                    error:
                        "User profile not found.",
                },
                {
                    status: 403,
                }
            );
        }

        const adminUser =
            adminSnapshot.val();

        if (
            adminUser?.role !==
            "admin"
        ) {
            return NextResponse.json(
                {
                    error:
                        "Admin access required.",
                },
                {
                    status: 403,
                }
            );
        }

        // ---------------------------------------------------------
        // 3. Load users + orders
        // ---------------------------------------------------------

        const [
            usersSnapshot,
            ordersSnapshot,
        ] = await Promise.all([
            adminDatabase
                .ref("users")
                .get(),

            adminDatabase
                .ref("orders")
                .get(),
        ]);

        const users = usersSnapshot.exists()
            ? usersSnapshot.val()
            : {};

        const orders = ordersSnapshot.exists()
            ? ordersSnapshot.val()
            : {};

        // ---------------------------------------------------------
        // 4. Build order statistics by user
        // ---------------------------------------------------------

        const userOrderStats: Record<
            string,
            {
                totalOrders: number;
                paidOrders: number;
                totalSpent: number;
            }
        > = {};

        if (
            orders &&
            typeof orders === "object"
        ) {
            Object.entries(
                orders
            ).forEach(
                ([userId, rawUserOrders]) => {
                    if (
                        !rawUserOrders ||
                        typeof rawUserOrders !==
                        "object"
                    ) {
                        return;
                    }

                    let totalOrders = 0;
                    let paidOrders = 0;
                    let totalSpent = 0;

                    Object.values(
                        rawUserOrders as Record<
                            string,
                            unknown
                        >
                    ).forEach(
                        (rawOrder) => {
                            if (
                                !rawOrder ||
                                typeof rawOrder !==
                                "object"
                            ) {
                                return;
                            }

                            const order =
                                rawOrder as OrderRecord;

                            totalOrders++;

                            const isPaid =
                                order.status ===
                                "paid" ||
                                order.paymentStatus ===
                                "paid";

                            if (!isPaid) {
                                return;
                            }

                            paidOrders++;

                            const amount =
                                typeof order.amount ===
                                    "number"
                                    ? order.amount
                                    : typeof order.price ===
                                        "number"
                                        ? order.price
                                        : 0;

                            totalSpent +=
                                amount;
                        }
                    );

                    userOrderStats[userId] = {
                        totalOrders,
                        paidOrders,
                        totalSpent,
                    };
                }
            );
        }

        // ---------------------------------------------------------
        // 5. Build users
        // ---------------------------------------------------------

        const userEntries =
            users &&
                typeof users === "object"
                ? Object.entries(users)
                : [];

        const result = await Promise.all(
            userEntries.map(
                async ([uid, rawUser]) => {
                    const user =
                        rawUser as UserRecord;

                    let authEmail =
                        "";

                    let authDisplayName =
                        "";

                    let authPhotoURL =
                        "";

                    try {
                        const firebaseUser =
                            await adminAuth.getUser(
                                uid
                            );

                        authEmail =
                            firebaseUser.email ||
                            "";

                        authDisplayName =
                            firebaseUser.displayName ||
                            "";

                        authPhotoURL =
                            firebaseUser.photoURL ||
                            "";
                    } catch {
                        // RTDB user can exist even
                        // if Auth lookup fails.
                    }

                    const stats =
                        userOrderStats[
                        uid
                        ] || {
                            totalOrders: 0,
                            paidOrders: 0,
                            totalSpent: 0,
                        };

                    return {
                        id: uid,

                        email:
                            user.email ||
                            authEmail ||
                            "",

                        displayName:
                            user.displayName ||
                            authDisplayName ||
                            "Unnamed User",

                        role:
                            user.role ||
                            "customer",

                        photoURL:
                            user.photoURL ||
                            authPhotoURL ||
                            "",

                        createdAt:
                            Number(
                                user.createdAt ||
                                0
                            ),

                        totalOrders:
                            stats.totalOrders,

                        paidOrders:
                            stats.paidOrders,

                        totalSpent:
                            stats.totalSpent,
                    };
                }
            )
        );

        // ---------------------------------------------------------
        // 6. Sort newest users first
        // ---------------------------------------------------------

        result.sort(
            (a, b) =>
                b.createdAt -
                a.createdAt
        );

        // ---------------------------------------------------------
        // 7. Summary
        // ---------------------------------------------------------

        const totalUsers =
            result.length;

        const admins =
            result.filter(
                (user) =>
                    user.role === "admin"
            ).length;

        const developers =
            result.filter(
                (user) =>
                    user.role ===
                    "developer"
            ).length;

        const customers =
            result.filter(
                (user) =>
                    user.role === "customer"
            ).length;

        const totalRevenue =
            result.reduce(
                (total, user) =>
                    total +
                    user.totalSpent,
                0
            );

        // ---------------------------------------------------------
        // 8. Response
        // ---------------------------------------------------------

        return NextResponse.json(
            {
                users: result,

                stats: {
                    totalUsers,
                    admins,
                    developers,
                    customers,
                    totalRevenue,
                },

                generatedAt:
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
            "ADMIN USERS API ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    "Failed to load users.",
            },
            {
                status: 500,
            }
        );
    }
}