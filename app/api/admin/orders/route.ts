import { NextRequest, NextResponse } from "next/server";
import {
    adminAuth,
    adminDatabase,
} from "@/lib/firebase-admin";

type Order = {
    productId?: string;
    productName?: string;
    productSlug?: string;

    status?: string;
    paymentStatus?: string;

    amount?: number;
    price?: number;
    currency?: string;

    createdAt?: number;
    paidAt?: number;

    stripeSessionId?: string;
    stripePaymentIntentId?: string;
    stripePaymentIntent?: string;

    paymentProvider?: string;

    licenseId?: string;

    email?: string;

    [key: string]: unknown;
};

export async function GET(
    request: NextRequest
) {
    try {
        // --------------------------------------------------
        // 1. AUTHENTICATION
        // --------------------------------------------------

        const authorization =
            request.headers.get(
                "authorization"
            );

        if (
            !authorization ||
            !authorization.startsWith(
                "Bearer "
            )
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
            await adminAuth.verifyIdToken(
                token
            );

        const uid =
            decodedToken.uid;

        // --------------------------------------------------
        // 2. ADMIN CHECK
        // --------------------------------------------------

        const userSnapshot =
            await adminDatabase
                .ref(`users/${uid}`)
                .get();

        if (
            !userSnapshot.exists()
        ) {
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

        const user =
            userSnapshot.val();

        if (
            user?.role !==
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

        // --------------------------------------------------
        // 3. LOAD ALL ORDERS
        // --------------------------------------------------

        const ordersSnapshot =
            await adminDatabase
                .ref("orders")
                .get();

        if (
            !ordersSnapshot.exists()
        ) {
            return NextResponse.json({
                orders: [],
                total: 0,
            });
        }

        const ordersData =
            ordersSnapshot.val();

        const orders: Array<
            Order & {
                id: string;
                userId: string;
            }
        > = [];

        /*
         * Firebase structure:
         *
         * orders/
         *   USER_ID/
         *     ORDER_ID/
         */

        Object.entries(
            ordersData
        ).forEach(
            ([
                userId,
                userOrders,
            ]) => {
                if (
                    !userOrders ||
                    typeof userOrders !==
                    "object"
                ) {
                    return;
                }

                Object.entries(
                    userOrders as Record<
                        string,
                        unknown
                    >
                ).forEach(
                    ([
                        orderId,
                        rawOrder,
                    ]) => {
                        if (
                            !rawOrder ||
                            typeof rawOrder !==
                            "object"
                        ) {
                            return;
                        }

                        const order =
                            rawOrder as Order;

                        /*
                         * Support both:
                         *
                         * amount: 49
                         *
                         * and older:
                         *
                         * price: 49
                         */

                        const amount =
                            typeof order.amount ===
                                "number"
                                ? order.amount
                                : typeof order.price ===
                                    "number"
                                    ? order.price
                                    : 0;

                        orders.push({
                            ...order,

                            id: orderId,

                            userId,

                            amount,
                        });
                    }
                );
            }
        );

        // --------------------------------------------------
        // 4. LOAD USER EMAILS
        // --------------------------------------------------

        /*
         * Some older orders were created without
         * an email field.
         *
         * For those orders we retrieve the email
         * securely from Firebase Authentication.
         */

        const uniqueUserIds =
            Array.from(
                new Set(
                    orders.map(
                        (order) =>
                            order.userId
                    )
                )
            );

        const emailMap: Record<
            string,
            string
        > = {};

        await Promise.all(
            uniqueUserIds.map(
                async (userId) => {
                    try {
                        /*
                         * If order already contains
                         * email, use it first.
                         */

                        const orderWithEmail =
                            orders.find(
                                (order) =>
                                    order.userId ===
                                    userId &&
                                    !!order.email
                            );

                        if (
                            orderWithEmail?.email
                        ) {
                            emailMap[userId] =
                                orderWithEmail.email;

                            return;
                        }

                        /*
                         * Otherwise get the verified
                         * Firebase Authentication email.
                         */

                        const firebaseUser =
                            await adminAuth.getUser(
                                userId
                            );

                        if (
                            firebaseUser.email
                        ) {
                            emailMap[userId] =
                                firebaseUser.email;
                        }
                    } catch (error) {
                        console.warn(
                            "ADMIN ORDERS: Unable to resolve email for user:",
                            userId,
                            error
                        );
                    }
                }
            )
        );

        // --------------------------------------------------
        // 5. SORT ORDERS
        // --------------------------------------------------

        orders.sort(
            (a, b) =>
                Number(
                    b.createdAt || 0
                ) -
                Number(
                    a.createdAt || 0
                )
        );

        // --------------------------------------------------
        // 6. LOAD PRODUCTS
        // --------------------------------------------------

        const productsSnapshot =
            await adminDatabase
                .ref("bots")
                .get();

        const products =
            productsSnapshot.exists()
                ? productsSnapshot.val()
                : {};

        // --------------------------------------------------
        // 7. ENRICH ORDERS
        // --------------------------------------------------

        const enrichedOrders =
            orders.map(
                (order) => {
                    const product =
                        order.productId
                            ? products[
                            order.productId
                            ]
                            : null;

                    /*
                     * Email priority:
                     *
                     * 1. Email stored in order
                     * 2. Firebase Authentication email
                     * 3. Empty string
                     */

                    const customerEmail =
                        order.email ||
                        emailMap[
                        order.userId
                        ] ||
                        "";

                    /*
                     * Support both payment
                     * intent field names.
                     */

                    const stripePaymentIntentId =
                        order.stripePaymentIntentId ||
                        order.stripePaymentIntent ||
                        "";

                    return {
                        ...order,

                        email:
                            customerEmail,

                        amount:
                            typeof order.amount ===
                                "number"
                                ? order.amount
                                : typeof order.price ===
                                    "number"
                                    ? order.price
                                    : 0,

                        stripePaymentIntentId,

                        product: product
                            ? {
                                id:
                                    order.productId,

                                name:
                                    product.name,

                                slug:
                                    product.slug,

                                version:
                                    product.version,

                                platform:
                                    product.platform,

                                productType:
                                    product.productType,

                                status:
                                    product.status,
                            }
                            : null,
                    };
                }
            );

        // --------------------------------------------------
        // 8. RESPONSE
        // --------------------------------------------------

        return NextResponse.json(
            {
                orders:
                    enrichedOrders,

                total:
                    enrichedOrders.length,
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
            "ADMIN ORDERS API ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    "Failed to load orders.",
            },
            {
                status: 500,
            }
        );
    }
}