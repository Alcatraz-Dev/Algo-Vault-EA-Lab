import { NextRequest, NextResponse } from "next/server";
import {
    adminAuth,
    adminDatabase,
} from "@/lib/firebase-admin";

type AnyRecord = Record<string, unknown>;

function isObject(
    value: unknown
): value is AnyRecord {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

/**
 * GET /api/admin/developers
 *
 * Lists all developers (role = developer) plus their
 * Stripe Connect status from the `stripeConnect` node.
 */
export async function GET(
    request: NextRequest
) {
    try {
        // ---------------------------------------------------------
        // 1. Verify admin
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

        const token =
            authorization.substring(7);

        const decodedToken =
            await adminAuth.verifyIdToken(
                token
            );

        const adminUid =
            decodedToken.uid;

        const adminSnapshot =
            await adminDatabase
                .ref(`users/${adminUid}`)
                .get();

        if (
            !adminSnapshot.exists() ||
            adminSnapshot.val()?.role !==
            "admin"
        ) {
            return NextResponse.json(
                { error: "Admin access required." },
                { status: 403 }
            );
        }

        // ---------------------------------------------------------
        // 2. Load users
        // ---------------------------------------------------------

        const usersSnapshot =
            await adminDatabase
                .ref("users")
                .get();

        const users = usersSnapshot.exists()
            ? usersSnapshot.val()
            : {};

        if (
            !users ||
            typeof users !== "object"
        ) {
            return NextResponse.json({
                developers: [],
                stats: {
                    totalDevelopers: 0,
                    connected: 0,
                    onboarding: 0,
                    notConnected: 0,
                },
                generatedAt: Date.now(),
            });
        }

        // ---------------------------------------------------------
        // 3. Build developer rows
        // ---------------------------------------------------------

        const rows: AnyRecord[] = [];

        for (const [
            uid,
            rawUser,
        ] of Object.entries(
            users as AnyRecord
        )) {
            if (
                !isObject(rawUser) ||
                rawUser.role !== "developer"
            ) {
                continue;
            }

            let authEmail = "";
            let authDisplayName = "";
            let authPhotoURL = "";

            try {
                const firebaseUser =
                    await adminAuth.getUser(
                        uid
                    );

                authEmail =
                    firebaseUser.email || "";

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

            const stripeConnect = isObject(
                rawUser.stripeConnect
            )
                ? rawUser.stripeConnect
                : {};

            const accountId =
                typeof stripeConnect.accountId ===
                "string"
                    ? stripeConnect.accountId
                    : null;

            const chargesEnabled = Boolean(
                stripeConnect.chargesEnabled
            );

            const payoutsEnabled = Boolean(
                stripeConnect.payoutsEnabled
            );

            const restrictions = isObject(
                stripeConnect.restrictions
            )
                ? stripeConnect.restrictions
                : {};

            const requirements = isObject(
                stripeConnect.requirements
            )
                ? stripeConnect.requirements
                : {};

            const currentlyDue = Array.isArray(
                requirements.currentlyDue
            )
                ? requirements.currentlyDue
                : [];

            const pastDue = Array.isArray(
                requirements.pastDue
            )
                ? requirements.pastDue
                : [];

            const eventuallyDue =
                Array.isArray(
                    requirements.eventuallyDue
                )
                    ? requirements.eventuallyDue
                    : [];

            let status: string;

            if (
                !accountId ||
                !stripeConnect.accountId
            ) {
                status = "not_connected";
            } else if (
                chargesEnabled ||
                payoutsEnabled
            ) {
                status = "active";
            } else if (
                currentlyDue.length > 0 ||
                pastDue.length > 0
            ) {
                status = "requirements";
            } else {
                status = "onboarding";
            }

            rows.push({
                id: uid,

                email:
                    rawUser.email ||
                    authEmail ||
                    "",

                displayName:
                    rawUser.displayName ||
                    authDisplayName ||
                    "Unnamed Developer",

                photoURL:
                    rawUser.photoURL ||
                    authPhotoURL ||
                    "",

                createdAt: Number(
                    rawUser.createdAt || 0
                ),

                hasDeveloperPlan: Boolean(
                    isObject(
                        rawUser.developerSubscription
                    ) &&
                    rawUser.developerSubscription
                        .status === "active"
                ),

                plan:
                    isObject(
                        rawUser.developerSubscription
                    )
                        ? rawUser
                              .developerSubscription
                              .plan || null
                        : null,

                accountId,

                chargesEnabled,

                payoutsEnabled,

                restrictions: {
                    disabledReason:
                        restrictions.disabledReason ??
                        null,
                },

                requirements: {
                    currentlyDue,
                    pastDue,
                    eventuallyDue,
                    currentDeadline:
                        requirements.currentDeadline ??
                        null,
                },

                onboardedAt:
                    Number(
                        stripeConnect.onboardedAt ||
                        0
                    ) || null,

                lastOnboardingLinkCreatedAt:
                    Number(
                        stripeConnect.lastOnboardingLinkCreatedAt ||
                        0
                    ) || null,

                status,

                updatedAt:
                    Number(
                        stripeConnect.updatedAt ||
                        0
                    ) || null,
            });
        }

        // ---------------------------------------------------------
        // 4. Sort: onboarding first, then requirements,
        //    then active, then never connected
        // ---------------------------------------------------------

        const statusRank: Record<
            string,
            number
        > = {
            onboarding: 0,
            requirements: 1,
            not_connected: 2,
            active: 3,
        };

        rows.sort((a, b) => {
            const rankDiff =
                (statusRank[
                    String(a.status ?? "")
                ] ?? 99) -
                (statusRank[
                    String(b.status ?? "")
                ] ?? 99);

            if (rankDiff !== 0) {
                return rankDiff;
            }

            return Number(
                b.updatedAt || b.createdAt || 0
            ) -
                Number(
                    a.updatedAt ||
                    a.createdAt ||
                    0
                );
        });

        // ---------------------------------------------------------
        // 5. Summary
        // ---------------------------------------------------------

        const stats = {
            totalDevelopers: rows.length,

            connected: rows.filter(
                (r) => r.status === "active"
            ).length,

            onboarding: rows.filter(
                (r) =>
                    r.status === "onboarding" ||
                    r.status === "requirements"
            ).length,

            notConnected: rows.filter(
                (r) =>
                    r.status === "not_connected"
            ).length,
        };

        return NextResponse.json({
            developers: rows,
            stats,
            generatedAt: Date.now(),
        });
    } catch (error) {
        console.error(
            "ADMIN DEVELOPERS API ERROR:",
            error
        );

        return NextResponse.json(
            { error: "Failed to load developers." },
            { status: 500 }
        );
    }
}