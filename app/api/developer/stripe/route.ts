import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
}

const STRIPE_API_VERSION = "2026-01-28.clover";

function getBaseUrl(request: NextRequest): string {
    return (
        request.headers.get("origin") ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000"
    );
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

async function stripeV2<T>(
    path: string,
    options: {
        method: "GET" | "POST";
        body?: unknown;
        include?: string[];
    }
): Promise<T> {
    const url = new URL(`https://api.stripe.com${path}`);

    if (options.include?.length) {
        for (const value of options.include) {
            url.searchParams.append("include[]", value);
        }
    }

    const response = await fetch(url.toString(), {
        method: options.method,
        headers: {
            Authorization: `Bearer ${stripeSecretKey}`,
            "Content-Type": "application/json",
            "Stripe-Version": STRIPE_API_VERSION,
        },
        body:
            options.method === "POST"
                ? JSON.stringify(options.body ?? {})
                : undefined,
        cache: "no-store",
    });

    const text = await response.text();

    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = {
            error: {
                message: text || "Unknown Stripe response",
            },
        };
    }

    if (!response.ok) {
        const message =
            data?.error?.message ||
            data?.message ||
            `Stripe API returned ${response.status}`;

        const error = new Error(message) as Error & {
            statusCode?: number;
            stripeCode?: string;
            stripeType?: string;
            requestId?: string;
            raw?: unknown;
        };

        error.statusCode = response.status;
        error.stripeCode = data?.error?.code;
        error.stripeType = data?.error?.type;
        error.requestId =
            response.headers.get("request-id") ||
            data?.request_id ||
            undefined;
        error.raw = data;

        throw error;
    }

    return data as T;
}

type StripeAccountV2 = {
    id: string;
    object?: string;
    contact_email?: string;
    display_name?: string;
    dashboard?: string;

    configuration?: {
        recipient?: {
            capabilities?: {
                stripe_balance?: {
                    stripe_transfers?: {
                        requested?: boolean;
                        status?: string;
                        status_details?: {
                            code?: string;
                        };
                    };
                };
            };
        };
    };

    requirements?: {
        currently_due?: string[];
        eventually_due?: string[];
        past_due?: string[];
        current_deadline?: number | null;
    };
};

type StripeAccountLinkV2 = {
    id: string;
    object?: string;
    url: string;
    expires_at?: number;
};

async function authenticateDeveloper(request: NextRequest) {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
        return {
            error: NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            ),
        };
    }

    const idToken = authorization
        .substring("Bearer ".length)
        .trim();

    if (!idToken) {
        return {
            error: NextResponse.json(
                { error: "Missing Firebase ID token" },
                { status: 401 }
            ),
        };
    }

    const token = await adminAuth.verifyIdToken(idToken);
    const uid = token.uid;

    const userSnap = await adminDatabase
        .ref(`users/${uid}`)
        .get();

    const userData = userSnap.val();

    if (
        !userData ||
        !["developer", "admin"].includes(userData.role)
    ) {
        return {
            error: NextResponse.json(
                { error: "Developer role required" },
                { status: 403 }
            ),
        };
    }

    return {
        uid,
        token,
        userData,
    };
}

function getAccountStatus(account: StripeAccountV2) {
    /**
     * Marketplace model (recipient configuration):
     * developers receive transfers, they do not accept
     * card charges directly. Readiness == stripe_transfers active.
     */
    const transfers =
        account.configuration?.recipient?.capabilities
            ?.stripe_balance?.stripe_transfers;

    const payoutsEnabled =
        transfers?.status === "active";

    return {
        chargesEnabled: payoutsEnabled,

        payoutsEnabled,

        cardPaymentsStatus: null,

        transfersStatus:
            transfers?.status ?? null,
    };
}

/**
 * GET
 *
 * Returns the current Stripe Connect status.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await authenticateDeveloper(request);

        if ("error" in auth) {
            return auth.error;
        }

        const { uid, userData } = auth;

        const accountId =
            userData?.stripeConnect?.accountId;

        if (!accountId) {
            return NextResponse.json({
                success: true,
                connected: false,
                accountId: null,
                chargesEnabled: false,
                payoutsEnabled: false,
            });
        }

        const account =
            await stripeV2<StripeAccountV2>(
                `/v2/core/accounts/${encodeURIComponent(accountId)}`,
                {
                    method: "GET",
                    include: [
                        "configuration.recipient",
                        "requirements",
                    ],
                }
            );

        const status = getAccountStatus(account);

        const requirements = {
            currentlyDue:
                account.requirements?.currently_due ?? [],

            eventuallyDue:
                account.requirements?.eventually_due ?? [],

            pastDue:
                account.requirements?.past_due ?? [],

            currentDeadline:
                account.requirements?.current_deadline ?? null,
        };

        await adminDatabase
            .ref(`users/${uid}/stripeConnect`)
            .update({
                accountId: account.id,
                chargesEnabled: status.chargesEnabled,
                payoutsEnabled: status.payoutsEnabled,
                requirements,
                updatedAt: Date.now(),
            });

        return NextResponse.json({
            success: true,
            connected: true,

            accountId: account.id,

            chargesEnabled:
                status.chargesEnabled,

            payoutsEnabled:
                status.payoutsEnabled,

            cardPaymentsStatus:
                status.cardPaymentsStatus,

            transfersStatus:
                status.transfersStatus,

            requirements,
        });
    } catch (error: unknown) {
        const message = getErrorMessage(error);

        console.error(
            "Stripe Connect status error:",
            error
        );

        return NextResponse.json(
            {
                error:
                    "Failed to retrieve Stripe Connect status",

                details:
                    process.env.NODE_ENV === "development"
                        ? message
                        : undefined,
            },
            { status: 500 }
        );
    }
}

/**
 * POST
 *
 * Creates a Stripe Connect Account V2
 * and generates the onboarding link.
 */
export async function POST(request: NextRequest) {
    try {
        const auth = await authenticateDeveloper(request);

        if ("error" in auth) {
            return auth.error;
        }

        const {
            uid,
            token,
            userData,
        } = auth;

        // Check Admin Verification
        const isApproved = userData?.role === "admin" || userData?.developerApproved === true || userData?.developerStatus === "approved";
        if (!isApproved) {
            return NextResponse.json(
                { error: "Admin verification is required before connecting your Stripe account." },
                { status: 403 }
            );
        }

        // Check Active Developer Subscription
        const devSubSnap = await adminDatabase.ref(`users/${uid}/developerSubscription`).get();
        const devSub = devSubSnap.val();
        const hasActiveSub = userData?.role === "admin" || (devSub?.status === "active" && Boolean(devSub?.plan));
        if (!hasActiveSub) {
            return NextResponse.json(
                { error: "An active developer subscription is required before connecting your Stripe account." },
                { status: 403 }
            );
        }

        const baseUrl = getBaseUrl(request);

        const refreshUrl =
            `${baseUrl}/developer/dashboard?stripe=refresh`;

        const returnUrl =
            `${baseUrl}/developer/dashboard?stripe=return`;

        let accountId =
            userData?.stripeConnect?.accountId || null;

        let account: StripeAccountV2;

        /**
         * ========================================================
         * EXISTING ACCOUNT
         * ========================================================
         */
        if (accountId) {
            account =
                await stripeV2<StripeAccountV2>(
                    `/v2/core/accounts/${encodeURIComponent(accountId)}`,
                    {
                        method: "GET",
                        include: [
                            "configuration.recipient",
                            "requirements",
                        ],
                    }
                );
        } else {
            /**
             * ====================================================
             * CREATE STRIPE ACCOUNT V2
             * ====================================================
             */
account =
                await stripeV2<StripeAccountV2>(
                    "/v2/core/accounts",
                    {
                        method: "POST",

                        body: {
                            contact_email:
                                userData.email ||
                                token.email ||
                                undefined,

                            display_name:
                                userData.displayName ||
                                userData.name ||
                                undefined,

                            metadata: {
                                firebaseUID: uid,
                            },

                            /**
                             * Marketplace model: AlgoVault owns checkout and
                             * collects platform fees via application_fee_amount.
                             * Developers receive transfers via connected accounts.
                             *
                             * configuration.recipient → stripe_transfers
                             * dashboard: "express" → cobranded lightweight dashboard
                             * fees/losses_collector: "application" → required for express dashboard
                             */
                            configuration: {
                                recipient: {
                                    capabilities: {
                                        stripe_balance: {
                                            stripe_transfers: {
                                                requested: true,
                                            },
                                        },
                                    },
                                },
                            },

                            dashboard: "express",

                            defaults: {
                                responsibilities: {
                                    fees_collector:
                                        "application",
                                    losses_collector:
                                        "application",
                                },
                            },
                        },
                    }
                );

            accountId = account.id;

            await adminDatabase
                .ref(
                    `users/${uid}/stripeConnect`
                )
                .set({
                    accountId: account.id,

                    chargesEnabled: false,

                    payoutsEnabled: false,

                    onboardedAt: null,

                    createdAt: Date.now(),

                    updatedAt: Date.now(),
                });
        }

        /**
         * ========================================================
         * CURRENT STATUS
         * ========================================================
         */
        const status =
            getAccountStatus(account);

        /**
         * ========================================================
         * ALREADY FULLY ONBOARDED
         * ========================================================
         */
        if (
            status.chargesEnabled &&
            status.payoutsEnabled
        ) {
            await adminDatabase
                .ref(
                    `users/${uid}/stripeConnect`
                )
                .update({
                    accountId: account.id,

                    chargesEnabled: true,

                    payoutsEnabled: true,

                    onboardedAt:
                        userData?.stripeConnect
                            ?.onboardedAt ??
                        Date.now(),

                    updatedAt: Date.now(),
                });

            return NextResponse.json({
                success: true,

                alreadyOnboarded: true,

                connected: true,

                accountId: account.id,

                chargesEnabled: true,

                payoutsEnabled: true,
            });
        }

        /**
         * ========================================================
         * CREATE ACCOUNT V2 ONBOARDING LINK
         * ========================================================
         */
        const accountLink =
            await stripeV2<StripeAccountLinkV2>(
                "/v2/core/account_links",
                {
                    method: "POST",

                    body: {
                        account: account.id,

                        use_case: {
                            type:
                                "account_onboarding",

                            account_onboarding: {
                                configurations: [
                                    "recipient",
                                ],

                                refresh_url:
                                    refreshUrl,

                                return_url:
                                    returnUrl,

                                collection_options: {
                                    fields:
                                        "eventually_due",
                                },
                            },
                        },
                    },
                }
            );

        await adminDatabase
            .ref(
                `users/${uid}/stripeConnect`
            )
            .update({
                accountId: account.id,

                chargesEnabled:
                    status.chargesEnabled,

                payoutsEnabled:
                    status.payoutsEnabled,

                lastOnboardingLinkCreatedAt:
                    Date.now(),

                updatedAt: Date.now(),
            });

        return NextResponse.json({
            success: true,

            alreadyOnboarded: false,

            connected: true,

            accountId: account.id,

            chargesEnabled:
                status.chargesEnabled,

            payoutsEnabled:
                status.payoutsEnabled,

            url: accountLink.url,

            expiresAt:
                accountLink.expires_at ?? null,
        });
    } catch (error: unknown) {
        const message =
            getErrorMessage(error);

        const errorData =
            error &&
            typeof error === "object"
                ? error as {
                      statusCode?: number;
                      stripeCode?: string;
                      stripeType?: string;
                      requestId?: string;
                      raw?: unknown;
                  }
                : {};

        console.error(
            "Stripe Connect error:",
            {
                message,

                statusCode:
                    errorData.statusCode,

                stripeCode:
                    errorData.stripeCode,

                stripeType:
                    errorData.stripeType,

                requestId:
                    errorData.requestId,

                raw:
                    errorData.raw,
            }
        );

        return NextResponse.json(
            {
                error:
                    "Stripe Connect setup failed",

                details:
                    process.env.NODE_ENV === "development"
                        ? message
                        : undefined,

                stripeCode:
                    process.env.NODE_ENV === "development"
                        ? errorData.stripeCode
                        : undefined,

                requestId:
                    errorData.requestId,
            },
            {
                status:
                    Number(errorData.statusCode) >= 400 &&
                    Number(errorData.statusCode) < 600
                        ? Number(errorData.statusCode)
                        : 500,
            }
        );
    }
}