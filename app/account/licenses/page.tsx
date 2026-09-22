"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    ArrowDownToLine,
    ArrowRight,
    Bot,
    CheckCircle2,
    Clock3,
    Copy,
    KeyRound,
    Loader2,
    RefreshCw,
    ShieldCheck,
    XCircle,
} from "lucide-react";
import {
    onAuthStateChanged,
    User,
} from "firebase/auth";
import {
    onValue,
    ref,
} from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";

type License = {
    id: string;

    productId?: string;
    productName?: string;

    licenseKey?: string;

    status?: string;

    startedAt?: number;
    expiresAt?: number;

    maxAccounts?: number;
    mt5Account?: number | string;

    createdAt?: number;
    updatedAt?: number;

    orderId?: string;
};

type Product = {
    id: string;

    name?: string;
    slug?: string;

    version?: string;

    productType?: string;
    platform?: string;

    symbol?: string;
    timeframe?: string;

    status?: string;

    pricing?: {
        type?: string;
        price?: number;
        currency?: string;
    };

    branding?: {
        icon?: {
            fileName?: string;
            path?: string;
            updatedAt?: number;
        };
    };
};

type LicenseWithProduct =
    License & {
        product?: Product;
    };

type LicenseState =
    | "active"
    | "expired"
    | "revoked"
    | "inactive";

export default function LicensesPage() {
    const [user, setUser] =
        useState<User | null>(null);

    const [licenses, setLicenses] =
        useState<LicenseWithProduct[]>([]);

    const [products, setProducts] =
        useState<Record<string, Product>>({});

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState("");

    const [copiedKey, setCopiedKey] =
        useState("");

    const [refreshing, setRefreshing] =
        useState(false);

    const [refreshToken, setRefreshToken] =
        useState(0);

    /*
     * ---------------------------------------------------------
     * AUTH
     * ---------------------------------------------------------
     */

    useEffect(() => {
        const unsubscribe =
            onAuthStateChanged(
                auth,
                (currentUser) => {
                    setUser(currentUser);

                    if (!currentUser) {
                        setLoading(false);
                    }
                }
            );

        return () => unsubscribe();
    }, []);

    /*
     * ---------------------------------------------------------
     * LOAD PRODUCTS
     * ---------------------------------------------------------
     *
     * Products are public metadata.
     * We use them only to enrich the license display.
     */

    useEffect(() => {
        const productsRef =
            ref(database, "bots");

        const unsubscribe = onValue(
            productsRef,
            (snapshot) => {
                const data =
                    snapshot.val();

                if (!data) {
                    setProducts({});
                    return;
                }

                const mapped: Record<
                    string,
                    Product
                > = {};

                Object.entries(data).forEach(
                    ([id, value]) => {
                        mapped[id] = {
                            id,
                            ...(value as Omit<
                                Product,
                                "id"
                            >),
                        };
                    }
                );

                setProducts(mapped);
            },
            (firebaseError) => {
                console.error(
                    "LICENSE PRODUCTS ERROR:",
                    firebaseError
                );
            }
        );

        return () => unsubscribe();
    }, []);

    /*
     * ---------------------------------------------------------
     * LOAD USER LICENSES
     * ---------------------------------------------------------
     */

    useEffect(() => {
        if (!user) {
            void Promise.resolve().then(() => setLicenses([]));
            return;
        }

        void Promise.resolve().then(() => {
            setLoading(true);
            setError("");
        });

        const licensesRef = ref(
            database,
            `licenses/${user.uid}`
        );

        const unsubscribe = onValue(
            licensesRef,
            (snapshot) => {
                const data =
                    snapshot.val();

                if (!data) {
                    setLicenses([]);
                    setLoading(false);
                    return;
                }

                const list: LicenseWithProduct[] =
                    Object.entries(data)
                        .map(
                            ([id, value]) => {
                                const license =
                                    value as License;

                                return {
                                    ...license,
                                    id,
                                    product:
                                        license.productId
                                            ? products[
                                            license
                                                .productId
                                            ]
                                            : undefined,
                                };
                            }
                        )
                        .sort(
                            (a, b) =>
                                (b.createdAt ||
                                    b.startedAt ||
                                    0) -
                                (a.createdAt ||
                                    a.startedAt ||
                                    0)
                        );

                setLicenses(list);
                setLoading(false);
            },
            (firebaseError) => {
                console.error(
                    "LICENSE FIREBASE ERROR:",
                    firebaseError
                );

                setError(
                    "Unable to load your licenses."
                );

                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user, products, refreshToken]);

    /*
     * ---------------------------------------------------------
     * REFRESH
     * ---------------------------------------------------------
     */

    const handleRefresh = async () => {
        setRefreshing(true);

        try {
            await new Promise(
                (resolve) =>
                    setTimeout(resolve, 300)
            );

            setRefreshToken(
                (token) => token + 1
            );
        } finally {
            setRefreshing(false);
        }
    };

    /*
     * ---------------------------------------------------------
     * COPY LICENSE
     * ---------------------------------------------------------
     */

    const copyLicenseKey = async (
        licenseKey: string
    ) => {
        try {
            await navigator.clipboard.writeText(
                licenseKey
            );

            setCopiedKey(licenseKey);

            setTimeout(() => {
                setCopiedKey("");
            }, 1800);
        } catch (copyError) {
            console.error(
                "COPY LICENSE ERROR:",
                copyError
            );
        }
    };

    /*
     * ---------------------------------------------------------
     * SUMMARY
     * ---------------------------------------------------------
     */

    const summary = useMemo(() => {
        let active = 0;
        let expired = 0;
        let revoked = 0;

        licenses.forEach((license) => {
            const state =
                getLicenseState(
                    license
                );

            if (state === "active") {
                active++;
            }

            if (state === "expired") {
                expired++;
            }

            if (state === "revoked") {
                revoked++;
            }
        });

        return {
            total: licenses.length,
            active,
            expired,
            revoked,
        };
    }, [licenses]);

    /*
     * ---------------------------------------------------------
     * NOT AUTHENTICATED
     * ---------------------------------------------------------
     */

    if (!loading && !user) {
        return (
            <AccountShell title="My Licenses" subtitle="Manage your AlgoVault product licenses, account bindings and downloads">

                <div className="mx-auto flex min-h-screen max-w-2xl items-center justify-center">

                    <div className="w-full rounded-2xl border border-border bg-muted/30 p-8 text-center">

                        <ShieldCheck
                            size={42}
                            className="mx-auto text-muted-foreground"
                        />

                        <h1 className="mt-5 text-xl font-semibold">
                            Sign in to view your licenses
                        </h1>

                        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                            Your purchased products and
                            active licenses are available
                            after signing in.
                        </p>

                        <Link
                            href="/login"
                            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:bg-muted"
                        >
                            Sign In

                            <ArrowRight
                                size={15}
                            />
                        </Link>

                    </div>

                </div>

            </AccountShell>
        );
    }

    return (
        <AccountShell title="My Licenses" subtitle="Manage your AlgoVault product licenses, account bindings and downloads">

            {/* Toolbar */}
            <div className="mb-5 flex justify-end">
                <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground transition hover:bg-muted/60 disabled:opacity-50"
                >
                    {refreshing ? (
                        <Loader2 size={14} className="animate-spin" />
                    ) : (
                        <RefreshCw size={14} />
                    )}
                    Refresh
                </button>
            </div>

            {/* Content */}
            <section className="mx-auto max-w-5xl" data-guide="page-header">

                {/* Summary */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-guide="stats">

                    <SummaryCard
                        icon={
                            <KeyRound
                                size={17}
                            />
                        }
                        label="Total Licenses"
                        value={
                            summary.total
                        }
                    />

                    <SummaryCard
                        icon={
                            <CheckCircle2
                                size={17}
                            />
                        }
                        label="Active"
                        value={
                            summary.active
                        }
                    />

                    <SummaryCard
                        icon={
                            <Clock3
                                size={17}
                            />
                        }
                        label="Expired"
                        value={
                            summary.expired
                        }
                    />

                    <SummaryCard
                        icon={
                            <XCircle
                                size={17}
                            />
                        }
                        label="Revoked"
                        value={
                            summary.revoked
                        }
                    />

                </div>

                {/* Error */}
                {error && (
                    <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600">
                        {error}
                    </div>
                )}

                {/* Loading */}
                {loading && (
                    <div className="mt-8 grid gap-5 lg:grid-cols-2">

                        {[1, 2].map(
                            (item) => (
                                <div
                                    key={item}
                                    className="h-72 animate-pulse rounded-2xl border border-border bg-muted/30"
                                />
                            )
                        )}

                    </div>
                )}

                {/* Empty */}
                {!loading &&
                    !error &&
                    licenses.length ===
                    0 && (
                        <div className="mt-8 rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-20 text-center">

                            <KeyRound
                                size={42}
                                className="mx-auto text-muted-foreground"
                            />

                            <h2 className="mt-5 text-lg font-medium">
                                No licenses yet
                            </h2>

                            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                                When you purchase a
                                licensed product, your
                                license will appear here
                                automatically.
                            </p>

                            <Link
                                href="/marketplace"
                                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-xs font-medium text-background transition hover:bg-muted"
                            >
                                Browse Marketplace

                                <ArrowRight
                                    size={14}
                                />
                            </Link>

                        </div>
                    )}

                {/* Licenses */}
                {!loading &&
                    licenses.length >
                    0 && (
                        <div className="mt-8 grid gap-5 lg:grid-cols-2">

                            {licenses.map(
                                (
                                    license
                                ) => (
                                    <LicenseCard
                                        key={
                                            license.id
                                        }
                                        license={
                                            license
                                        }
                                        copiedKey={
                                            copiedKey
                                        }
                                        onCopy={
                                            copyLicenseKey
                                        }
                                    />
                                )
                            )}

                        </div>
                    )}

                {/* Security note */}
                {!loading &&
                    licenses.length >
                    0 && (
                        <div className="mt-8 rounded-2xl border border-border bg-muted/30 p-5">

                            <div className="flex gap-3">

                                <ShieldCheck
                                    size={18}
                                    className="mt-0.5 shrink-0 text-muted-foreground"
                                />

                                <div>

                                    <p className="text-sm font-medium text-foreground">
                                        License protection
                                    </p>

                                    <p className="mt-1 text-xs leading-6 text-muted-foreground">
                                        Your license is validated
                                        by AlgoVault before
                                        protected products are
                                        authorized to trade.
                                        Never share your license
                                        key with another person.
                                    </p>

                                </div>

                            </div>

                        </div>
                    )}

            </section>

        </AccountShell>
    );
}

/*
 * ============================================================
 * LICENSE CARD
 * ============================================================
 */

function LicenseCard({
    license,
    copiedKey,
    onCopy,
}: {
    license: LicenseWithProduct;
    copiedKey: string;
    onCopy: (
        licenseKey: string
    ) => void;
}) {
    const product =
        license.product;

    const state =
        getLicenseState(
            license
        );

    const stateConfig =
        getStateConfig(state);

    const daysRemaining =
        getDaysRemaining(
            license.expiresAt
        );

    const productName =
        product?.name ||
        license.productName ||
        "AlgoVault Product";

    const productSlug =
        product?.slug;

    const hasAccount =
        license.mt5Account !==
        undefined &&
        license.mt5Account !==
        null &&
        String(
            license.mt5Account
        ).trim() !== "";

    return (
        <article className="overflow-hidden rounded-2xl border border-border bg-muted/30 transition hover:border-border">

            {/* Top */}
            <div className="border-b border-border p-5">

                <div className="flex items-start justify-between gap-4">

                    <div className="flex min-w-0 items-center gap-3">

                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card">

                            {product?.branding
                                ?.icon
                                ?.fileName ? (
                                <img
                                    src={`/api/products/branding?productId=${encodeURIComponent(
                                        product.id
                                    )}&type=icon`}
                                    alt={`${productName} icon`}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <Bot
                                    size={23}
                                    className="text-muted-foreground"
                                />
                            )}

                        </div>

                        <div className="min-w-0">

                            <div className="flex flex-wrap items-center gap-2">

                                <h2 className="truncate text-base font-semibold">
                                    {
                                        productName
                                    }
                                </h2>

                                <span
                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-medium ${stateConfig.className}`}
                                >
                                    {
                                        stateConfig.icon
                                    }

                                    {
                                        stateConfig.label
                                    }
                                </span>

                            </div>

                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">

                                {product?.platform && (
                                    <span>
                                        {
                                            product.platform
                                        }
                                    </span>
                                )}

                                {product?.symbol && (
                                    <>
                                        <span>
                                            •
                                        </span>

                                        <span>
                                            {
                                                product.symbol
                                            }
                                        </span>
                                    </>
                                )}

                                {product?.version && (
                                    <>
                                        <span>
                                            •
                                        </span>

                                        <span>
                                            v
                                            {
                                                product.version
                                            }
                                        </span>
                                    </>
                                )}

                            </div>

                        </div>

                    </div>

                </div>

            </div>

            {/* License Key */}
            <div className="p-5">

                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    License Key
                </p>

                <div className="mt-2 flex items-center gap-2">

                    <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-muted/40 px-3 py-3">

                        <code className="block truncate text-xs text-foreground">
                            {license.licenseKey ||
                                "—"}
                        </code>

                    </div>

                    {license.licenseKey && (
                        <button
                            type="button"
                            onClick={() =>
                                onCopy(
                                    license.licenseKey!
                                )
                            }
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground transition hover:bg-foreground/[0.07] hover:text-foreground"
                            title="Copy license key"
                        >
                            {copiedKey ===
                                license.licenseKey ? (
                                <CheckCircle2
                                    size={16}
                                />
                            ) : (
                                <Copy
                                    size={16}
                                />
                            )}
                        </button>
                    )}

                </div>

                {copiedKey ===
                    license.licenseKey && (
                        <p className="mt-2 text-[10px] text-muted-foreground">
                            License key copied.
                        </p>
                    )}

                {/* Details */}
                <div className="mt-5 grid grid-cols-2 gap-3">

                    <Detail
                        label="Started"
                        value={
                            formatDate(
                                license.startedAt
                            )
                        }
                    />

                    <Detail
                        label="Expires"
                        value={
                            formatDate(
                                license.expiresAt
                            )
                        }
                    />

                    <Detail
                        label="MT5 Account"
                        value={
                            hasAccount
                                ? String(
                                    license.mt5Account
                                )
                                : "Not bound"
                        }
                    />

                    <Detail
                        label="Max Accounts"
                        value={
                            license.maxAccounts !=
                                null
                                ? String(
                                    license.maxAccounts
                                )
                                : "—"
                        }
                    />

                </div>

                {/* Days */}
                <div className="mt-4 rounded-xl border border-border bg-muted p-4">

                    <div className="flex items-center justify-between gap-4">

                        <div>

                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                License Status
                            </p>

                            <p className="mt-1 text-sm font-medium text-foreground">
                                {state ===
                                    "active"
                                    ? daysRemaining >
                                        0
                                        ? `${daysRemaining} days remaining`
                                        : "Expires today"
                                    : stateConfig.label}
                            </p>

                        </div>

                        {state ===
                            "active" && (
                                <div className="text-right">

                                    <p className="text-[10px] text-muted-foreground">
                                        Valid until
                                    </p>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {
                                            formatDate(
                                                license.expiresAt
                                            )
                                        }
                                    </p>

                                </div>
                            )}

                    </div>

                </div>

                {/* Actions */}
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">

                    {productSlug && (
                        <Link
                            href={`/marketplace/${productSlug}`}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs font-medium text-foreground transition hover:bg-foreground/[0.07]"
                        >
                            View Product

                            <ArrowRight
                                size={14}
                            />
                        </Link>
                    )}

                    {state ===
                        "active" &&
                        product?.productType ===
                        "expert_advisor" && (
                            <Link
                                href={`/api/products/download?productId=${encodeURIComponent(
                                    license.productId ||
                                    ""
                                )}`}
                                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-3 text-xs font-medium text-background transition hover:bg-muted"
                                onClick={(event) => {
                                    /*
                                     * The actual protected download
                                     * requires a Firebase Bearer token.
                                     *
                                     * Therefore the direct link is
                                     * intentionally not used for the
                                     * authenticated download flow.
                                     *
                                     * We prevent the navigation here.
                                     */
                                    event.preventDefault();

                                    window.dispatchEvent(
                                        new CustomEvent(
                                            "algovault-download-product",
                                            {
                                                detail: {
                                                    productId:
                                                        license.productId,
                                                },
                                            }
                                        )
                                    );
                                }}
                            >
                                <ArrowDownToLine
                                    size={14}
                                />

                                Download EX5
                            </Link>
                        )}

                </div>

                {/* Protection note */}
                {state ===
                    "active" && (
                        <p className="mt-4 text-[10px] leading-5 text-muted-foreground">
                            This license is linked to your
                            account and may be bound to an MT5
                            trading account according to the
                            product license policy.
                        </p>
                    )}

            </div>

        </article>
    );
}

/*
 * ============================================================
 * SUMMARY CARD
 * ============================================================
 */

function SummaryCard({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
}) {
    return (
        <div className="rounded-2xl border border-border bg-muted/30 p-5">

            <div className="flex items-center gap-2 text-muted-foreground">

                {icon}

                <span className="text-xs">
                    {label}
                </span>

            </div>

            <p className="mt-3 text-2xl font-semibold">
                {value}
            </p>

        </div>
    );
}

/*
 * ============================================================
 * DETAIL
 * ============================================================
 */

function Detail({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-xl border border-border bg-muted p-3">

            <p className="text-[10px] text-muted-foreground">
                {label}
            </p>

            <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
                {value}
            </p>

        </div>
    );
}

/*
 * ============================================================
 * LICENSE STATE
 * ============================================================
 */

function getLicenseState(
    license: License
): LicenseState {
    const status =
        license.status
            ?.toLowerCase()
            .trim();

    if (
        status === "revoked"
    ) {
        return "revoked";
    }

    if (
        license.expiresAt &&
        license.expiresAt <=
        Date.now()
    ) {
        return "expired";
    }

    if (
        status === "active"
    ) {
        return "active";
    }

    return "inactive";
}

/*
 * ============================================================
 * STATE CONFIG
 * ============================================================
 */

function getStateConfig(
    state: LicenseState
) {
    switch (state) {
        case "active":
            return {
                label: "Active",
                className:
                    "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
                icon: (
                    <CheckCircle2
                        size={11}
                    />
                ),
            };

        case "expired":
            return {
                label: "Expired",
                className:
                    "border-amber-500/20 bg-amber-500/10 text-amber-400",
                icon: (
                    <Clock3
                        size={11}
                    />
                ),
            };

        case "revoked":
            return {
                label: "Revoked",
                className:
                    "border-red-500/20 bg-red-500/10 text-red-500",
                icon: (
                    <XCircle
                        size={11}
                    />
                ),
            };

        default:
            return {
                label: "Inactive",
                className:
                    "border-border bg-muted/50 text-muted-foreground",
                icon: (
                    <ShieldCheck
                        size={11}
                    />
                ),
            };
    }
}

/*
 * ============================================================
 * DATE
 * ============================================================
 */

function formatDate(
    timestamp?: number
) {
    if (!timestamp) {
        return "—";
    }

    try {
        return new Intl.DateTimeFormat(
            "en-US",
            {
                year: "numeric",
                month: "short",
                day: "numeric",
            }
        ).format(
            new Date(timestamp)
        );
    } catch {
        return "—";
    }
}

/*
 * ============================================================
 * DAYS REMAINING
 * ============================================================
 */

function getDaysRemaining(
    expiresAt?: number
) {
    if (!expiresAt) {
        return 0;
    }

    const diff =
        expiresAt - Date.now();

    return Math.max(
        0,
        Math.ceil(
            diff /
            (1000 *
                60 *
                60 *
                24)
        )
    );
}