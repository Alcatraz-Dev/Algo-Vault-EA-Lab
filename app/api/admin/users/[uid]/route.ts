import { NextRequest, NextResponse } from "next/server";
import {
    adminAuth,
    adminDatabase,
} from "@/lib/firebase-admin";

type RecordData = Record<string, any>;

async function verifyAdmin(
    request: NextRequest
) {
    const authorization =
        request.headers.get("authorization");

    if (
        !authorization ||
        !authorization.startsWith("Bearer ")
    ) {
        throw new Error("UNAUTHORIZED");
    }

    const token =
        authorization.substring(7);

    const decoded =
        await adminAuth.verifyIdToken(
            token
        );

    const adminUid =
        decoded.uid;

    const snapshot =
        await adminDatabase
            .ref(`users/${adminUid}`)
            .get();

    if (
        !snapshot.exists() ||
        snapshot.val()?.role !== "admin"
    ) {
        throw new Error("FORBIDDEN");
    }

    return adminUid;
}

export async function GET(
    request: NextRequest,
    context: {
        params: Promise<{
            uid: string;
        }>;
    }
) {
    try {
        await verifyAdmin(request);

        const { uid } =
            await context.params;

        if (!uid) {
            return NextResponse.json(
                {
                    error:
                        "User ID is required.",
                },
                { status: 400 }
            );
        }

        const [
            userSnapshot,
            ordersSnapshot,
            licensesSnapshot,
        ] = await Promise.all([
            adminDatabase
                .ref(`users/${uid}`)
                .get(),

            adminDatabase
                .ref(`orders/${uid}`)
                .get(),

            adminDatabase
                .ref(`licenses/${uid}`)
                .get(),
        ]);

        let authUser;

        try {
            authUser =
                await adminAuth.getUser(
                    uid
                );
        } catch {
            authUser = null;
        }

        if (
            !userSnapshot.exists() &&
            !authUser
        ) {
            return NextResponse.json(
                {
                    error:
                        "User not found.",
                },
                { status: 404 }
            );
        }

        const user =
            userSnapshot.exists()
                ? userSnapshot.val()
                : {};

        const orders: RecordData[] =
            [];

        if (
            ordersSnapshot.exists()
        ) {
            const raw =
                ordersSnapshot.val();

            if (
                raw &&
                typeof raw === "object"
            ) {
                Object.entries(raw).forEach(
                    ([id, value]) => {
                        if (
                            value &&
                            typeof value ===
                            "object"
                        ) {
                            orders.push({
                                id,
                                ...(value as RecordData),
                            });
                        }
                    }
                );
            }
        }

        const licenses: RecordData[] =
            [];

        if (
            licensesSnapshot.exists()
        ) {
            const raw =
                licensesSnapshot.val();

            if (
                raw &&
                typeof raw === "object"
            ) {
                Object.entries(raw).forEach(
                    ([id, value]) => {
                        if (
                            value &&
                            typeof value ===
                            "object"
                        ) {
                            licenses.push({
                                id,
                                ...(value as RecordData),
                            });
                        }
                    }
                );
            }
        }

        const paidOrders =
            orders.filter(
                (order) =>
                    order.status ===
                    "paid" ||
                    order.paymentStatus ===
                    "paid"
            );

        const totalSpent =
            paidOrders.reduce(
                (
                    total,
                    order
                ) => {
                    const amount =
                        typeof order.amount ===
                            "number"
                            ? order.amount
                            : typeof order.price ===
                                "number"
                                ? order.price
                                : 0;

                    return (
                        total +
                        amount
                    );
                },
                0
            );

        const now =
            Date.now();

        const activeLicenses =
            licenses.filter(
                (license) => {
                    if (
                        license.status ===
                        "revoked"
                    ) {
                        return false;
                    }

                    const expiresAt =
                        Number(
                            license.expiresAt ||
                            0
                        );

                    return (
                        license.status ===
                        "active" &&
                        (
                            !expiresAt ||
                            expiresAt > now
                        )
                    );
                }
            );

        return NextResponse.json(
            {
                user: {
                    id: uid,

                    email:
                        user.email ||
                        authUser?.email ||
                        "",

                    displayName:
                        user.displayName ||
                        authUser?.displayName ||
                        "Unnamed User",

                    role:
                        user.role ||
                        "customer",

                    photoURL:
                        user.photoURL ||
                        authUser?.photoURL ||
                        "",

                    createdAt:
                        Number(
                            user.createdAt ||
                                authUser?.metadata
                                    ?.creationTime
                                ? new Date(
                                    authUser
                                        ?.metadata
                                        ?.creationTime ||
                                    0
                                ).getTime()
                                : 0
                        ),
                },

                stats: {
                    totalOrders:
                        orders.length,

                    paidOrders:
                        paidOrders.length,

                    totalSpent,

                    totalLicenses:
                        licenses.length,

                    activeLicenses:
                        activeLicenses.length,
                },

                orders: orders.sort(
                    (a, b) =>
                        Number(
                            b.createdAt ||
                            b.paidAt ||
                            0
                        ) -
                        Number(
                            a.createdAt ||
                            a.paidAt ||
                            0
                        )
                ),

                licenses: licenses.sort(
                    (a, b) =>
                        Number(
                            b.startedAt ||
                            0
                        ) -
                        Number(
                            a.startedAt ||
                            0
                        )
                ),
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
            "ADMIN USER DETAILS API ERROR:",
            error
        );

        if (
            error instanceof Error &&
            error.message ===
            "UNAUTHORIZED"
        ) {
            return NextResponse.json(
                {
                    error:
                        "Unauthorized.",
                },
                { status: 401 }
            );
        }

        if (
            error instanceof Error &&
            error.message ===
            "FORBIDDEN"
        ) {
            return NextResponse.json(
                {
                    error:
                        "Admin access required.",
                },
                { status: 403 }
            );
        }

        return NextResponse.json(
            {
                error:
                    "Failed to load user.",
            },
            { status: 500 }
        );
    }
}

export async function PATCH(
    request: NextRequest,
    context: {
        params: Promise<{
            uid: string;
        }>;
    }
) {
    try {
        const adminUid =
            await verifyAdmin(
                request
            );

        const { uid } =
            await context.params;

        if (!uid) {
            return NextResponse.json(
                {
                    error:
                        "User ID is required.",
                },
                { status: 400 }
            );
        }

        // Prevent an admin from
        // accidentally removing
        // their own admin access.
        if (
            uid === adminUid
        ) {
            return NextResponse.json(
                {
                    error:
                        "You cannot change your own role.",
                },
                { status: 400 }
            );
        }

        const body =
            await request.json();

        const role =
            body?.role;

        const allowedRoles = [
            "customer",
            "developer",
            "admin",
        ];

        if (
            !allowedRoles.includes(
                role
            )
        ) {
            return NextResponse.json(
                {
                    error:
                        "Invalid role.",
                },
                { status: 400 }
            );
        }

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
                        "User not found.",
                },
                { status: 404 }
            );
        }

        await adminDatabase
            .ref(`users/${uid}/role`)
            .set(role);

        return NextResponse.json({
            success: true,
            uid,
            role,
        });
    } catch (error) {
        console.error(
            "ADMIN USER UPDATE ERROR:",
            error
        );

        if (
            error instanceof Error &&
            error.message ===
            "UNAUTHORIZED"
        ) {
            return NextResponse.json(
                {
                    error:
                        "Unauthorized.",
                },
                { status: 401 }
            );
        }

        if (
            error instanceof Error &&
            error.message ===
            "FORBIDDEN"
        ) {
            return NextResponse.json(
                {
                    error:
                        "Admin access required.",
                },
                { status: 403 }
            );
        }

        return NextResponse.json(
            {
                error:
                    "Failed to update user.",
            },
            { status: 500 }
        );
    }
}