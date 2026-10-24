import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { stripeClient, formatStripeError } from "@/lib/stripe";
import {
    INCLUDE_ACCOUNT_SECTIONS,
    cacheStripeConnectStatus,
    getV2AccountStatus,
    StripeAccountV2,
} from "@/lib/stripe-connect-utils";

function getBaseUrl(request: NextRequest): string {
    return (
        request.headers.get("origin") ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000"
    );
}

const COUNTRY_ISO_MAP: Record<string, string> = {
    "United States": "us",
    "United Kingdom": "gb",
    "Germany": "de",
    "France": "fr",
    "United Arab Emirates": "ae",
    "Singapore": "sg",
    "Australia": "au",
    "Canada": "ca",
    "Japan": "jp",
};

const COUNTRY_CURRENCY_MAP: Record<string, string> = {
    "United States": "usd",
    "United Kingdom": "gbp",
    "Germany": "eur",
    "France": "eur",
    "United Arab Emirates": "aed",
    "Singapore": "sgd",
    "Australia": "aud",
    "Canada": "cad",
    "Japan": "jpy",
};

function resolveCountry(country: string | undefined): {
    iso: string;
    currency: string;
} {
    const iso =
        country && COUNTRY_ISO_MAP[country]
            ? COUNTRY_ISO_MAP[country]
            : "us";

    const currency =
        country && COUNTRY_CURRENCY_MAP[country]
            ? COUNTRY_CURRENCY_MAP[country]
            : "usd";

    return { iso, currency };
}

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

/**
 * GET
  *
 * Returns the current Stripe Connect status (from Stripe, the source of
 * truth) and refreshes the local cache using the shared helpers in
 * `lib/stripe-connect-utils.ts`.
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
                statusLabel: "Onboarding Required",
                paymentsActive: false,
                chargesEnabled: false,
                payoutsEnabled: false,
                cardPaymentsStatus: null,
                requirements: {
                    currentlyDue: [],
                    eventuallyDue: [],
                    pastDue: [],
                    currentDeadline: null,
                },
            });
        }

        let account: StripeAccountV2;
        try {
            account =
                await stripeClient.v2.core.accounts.retrieve(
                    accountId,
                    {
                        include: INCLUDE_ACCOUNT_SECTIONS,
                    }
                );
            if (account.closed) {
                throw { code: "resource_missing", statusCode: 404 };
            }
        } catch (retrieveErr: unknown) {
            const errCode = (retrieveErr as { code?: string; statusCode?: number })?.code;
            const errStatus = (retrieveErr as { code?: string; statusCode?: number })?.statusCode;
            if (errCode === "resource_missing" || errStatus === 404) {
                return NextResponse.json({
                    success: true,
                    connected: false,
                    accountId: null,
                    statusLabel: "Onboarding Required",
                    paymentsActive: false,
                    chargesEnabled: false,
                    payoutsEnabled: false,
                    cardPaymentsStatus: null,
                    requirements: {
                        currentlyDue: [],
                        eventuallyDue: [],
                        pastDue: [],
                        currentDeadline: null,
                    },
                });
            }
            throw retrieveErr;
        }

        const status = getV2AccountStatus(account);

        await cacheStripeConnectStatus(uid, account.id, status);

         return NextResponse.json({
             success: true,
             connected: true,
             accountId: account.id,
             statusLabel: status.statusLabel,
             paymentsActive: status.paymentsActive,
             chargesEnabled: status.chargesEnabled,
             payoutsEnabled: status.payoutsEnabled,
             cardPaymentsStatus: status.cardPaymentsStatus,
             transfersStatus: status.transfersStatus,
             requirements: status.requirements,
         });
    } catch (error: unknown) {
        const message = formatStripeError(error);

        console.error(
            "Stripe Connect status error:",
            error
        );

        return NextResponse.json(
            {
                error: "Failed to retrieve Stripe Connect status",
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
 * Creates (or reuses) the developer's V2 Stripe Connect account and generates
 * the onboarding link. Idempotent: an existing `stripeConnect.accountId` is
 * always reused, never duplicated.
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

        const { iso, currency } = resolveCountry(
            userData.country
        );

        let accountId =
            userData?.stripeConnect?.accountId || null;

        let account: StripeAccountV2 | null = null;

        /**
         * ========================================================
         * EXISTING ACCOUNT (idempotent reuse)
         * ========================================================
         */
        if (accountId) {
            try {
                const retrieved =
                    await stripeClient.v2.core.accounts.retrieve(
                        accountId,
                        { include: INCLUDE_ACCOUNT_SECTIONS }
                    );

                if (!retrieved.closed) {
                    account = retrieved;
                } else {
                    accountId = null;
                }
            } catch (retrieveErr: unknown) {
                const errCode = (retrieveErr as { code?: string; statusCode?: number })?.code;
                const errStatus = (retrieveErr as { code?: string; statusCode?: number })?.statusCode;
                if (errCode === "resource_missing" || errStatus === 404) {
                    accountId = null;
                } else {
                    throw retrieveErr;
                }
            }

            if (account && accountId) {
                /**
                 * Accounts created before the card_payments requirement was in
                 * place may only have the old recipient/stripe_transfers config.
                 * Ensure the merchant card_payments AND recipient stripe_transfers
                 * capabilities are requested so both direct charges and transfers
                 * become available.
                 *
                 * Note: When updating an account with merchant or recipient
                 * capabilities, Stripe V2 requires defaults.responsibilities
                 * (fees_collector and losses_collector). If `dashboard` has not
                 * been set on the account yet, Stripe also requires setting it;
                 * once set, Stripe forbids changing it via API.
                 */
                if (
                    !account.configuration?.merchant ||
                    account.configuration?.merchant?.applied !== true ||
                    !account.configuration?.recipient ||
                    account.configuration?.recipient?.applied !== true
                ) {
                    try {
                        account =
                            await stripeClient.v2.core.accounts.update(
                                accountId,
                                {
                                    ...(account.identity?.country
                                        ? {}
                                        : {
                                              identity: {
                                                  country: iso,
                                                  entity_type: "individual",
                                              },
                                          }),
                                    configuration: {
                                        customer: {},
                                        merchant: {
                                            capabilities: {
                                                card_payments: {
                                                    requested: true,
                                                },
                                            },
                                        },
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
                                    ...(account.dashboard
                                        ? {}
                                        : { dashboard: "full" }),
                                    defaults: {
                                        responsibilities: {
                                            fees_collector: "stripe",
                                            losses_collector: "stripe",
                                        },
                                    },
                                    include: INCLUDE_ACCOUNT_SECTIONS,
                                }
                            );
                    } catch (updateErr: unknown) {
                        console.error(
                            "Failed to update existing Stripe account:",
                            updateErr
                        );
                        throw updateErr;
                    }
                }
            }
        }

        if (!accountId || !account) {
            /**
             * ====================================================
             * CREATE STRIPE CONNECT ACCOUNT V2
             * ====================================================
             * V2 only: no top-level `type: "express"/"standard"/"custom"`.
             *
             * Both capabilities must be requested together:
             * - configuration.merchant.capabilities.card_payments
             *   (prerequisite for stripe_transfers)
             * - configuration.recipient.capabilities.stripe_balance.stripe_transfers
             *   (enables developer payouts)
             *
             * customer: {} enables subscription/billing flows.
             * dashboard: "full" → cobranded Stripe Dashboard.
             */
            const created =
                await stripeClient.v2.core.accounts.create({
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

                    identity: {
                        country: iso,
                        entity_type: "individual",
                    },

                    configuration: {
                        customer: {},
                        merchant: {
                            capabilities: {
                                card_payments: {
                                    requested: true,
                                },
                            },
                        },
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

                    dashboard: "full",

                    defaults: {
                        currency,
                        responsibilities: {
                            fees_collector: "stripe",
                            losses_collector: "stripe",
                        },
                    },

                    include: INCLUDE_ACCOUNT_SECTIONS,
                });

            account = created;
            accountId = account.id;

            const status = getV2AccountStatus(account);

            await adminDatabase
                .ref(`users/${uid}/stripeConnect`)
                .set({
                    accountId: account.id,
                    chargesEnabled: status.chargesEnabled,
                    payoutsEnabled: status.payoutsEnabled,
                    requirements: status.requirements,
                    statusLabel: status.statusLabel,
                    paymentsActive: status.paymentsActive,
                    cardPaymentsStatus: status.cardPaymentsStatus,
                    onboardedAt: null,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });

            await adminDatabase
                .ref(`stripeAccounts/${account.id}`)
                .set({
                    uid,
                    accountId: account.id,
                    updatedAt: Date.now(),
                });
        }

        /**
         * ========================================================
         * CURRENT STATUS
         * ========================================================
         */
        const status = getV2AccountStatus(account);

        /**
         * ========================================================
         * ALREADY FULLY ONBOARDED
         * ========================================================
         */
        if (status.chargesEnabled && status.payoutsEnabled) {
            await cacheStripeConnectStatus(uid, account.id, status, {
                onboardedAt:
                    userData?.stripeConnect?.onboardedAt ?? Date.now(),
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
         * Re-fetch the account to get the latest configuration
         * before creating the link. Configurations may have changed
         * since account creation or last update (e.g. card_payments
         * capability transitions), and the account link request must
         * match the account's current state.
         */
        const currentAccount =
            await stripeClient.v2.core.accounts.retrieve(account.id, {
                include: INCLUDE_ACCOUNT_SECTIONS,
            });

        /**
         * Derive onboarding configurations from the account's actual
         * configuration rather than hardcoding. The account link's
         * configurations must exactly match what's applied on the
         * account or Stripe rejects with a configuration mismatch.
         */
         const onboardingConfigurations: string[] =
             currentAccount.applied_configurations &&
             currentAccount.applied_configurations.length > 0
                 ? [...currentAccount.applied_configurations]
                 : [];

         if (onboardingConfigurations.length === 0) {
             if (currentAccount.configuration?.merchant) {
                 onboardingConfigurations.push("merchant");
             }
             if (currentAccount.configuration?.customer) {
                 onboardingConfigurations.push("customer");
             }
             if (currentAccount.configuration?.recipient) {
                 onboardingConfigurations.push("recipient");
             }
         }

         // Defensive fallback: Stripe rejects empty configurations with
         // "use_case: Must populate details for the use case you choose."
         if (onboardingConfigurations.length === 0) {
             onboardingConfigurations.push("merchant", "recipient");
         }

        /**
         * ========================================================
         * CREATE ACCOUNT V2 ONBOARDING LINK
         * ========================================================
         */
        const accountLink =
            await stripeClient.v2.core.accountLinks.create({
                account: currentAccount.id,
                use_case: {
                    type: "account_onboarding",
                    account_onboarding: {
                        configurations: onboardingConfigurations,
                        refresh_url: refreshUrl,
                        return_url: returnUrl,
                    },
                },
            });

        await cacheStripeConnectStatus(uid, account.id, status);

        await adminDatabase
            .ref(`users/${uid}/stripeConnect`)
            .update({
                lastOnboardingLinkCreatedAt: Date.now(),
                updatedAt: Date.now(),
            });

        return NextResponse.json({
            success: true,
            alreadyOnboarded: false,
            connected: true,
            accountId: account.id,
            chargesEnabled: status.chargesEnabled,
            payoutsEnabled: status.payoutsEnabled,
            url: accountLink.url,
            expiresAt: accountLink.expires_at ?? null,
        });
    } catch (error: unknown) {
        const message = formatStripeError(error);

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
                statusCode: errorData.statusCode,
                stripeCode: errorData.stripeCode,
                stripeType: errorData.stripeType,
                requestId: errorData.requestId,
            }
        );

        return NextResponse.json(
            {
                error: "Stripe Connect setup failed",
                details:
                    process.env.NODE_ENV === "development"
                        ? message
                        : undefined,
                stripeCode: errorData.stripeCode,
                statusCode: errorData.statusCode,
                requestId: errorData.requestId,
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