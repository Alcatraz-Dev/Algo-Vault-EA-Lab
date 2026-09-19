"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    CheckCircle2,
    Clock3,
    Download,
    ExternalLink,
    FileCode2,
    KeyRound,
    Loader2,
    Package,
    ShieldCheck,
    AlertCircle,
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

type Order = {
    id: string;
    productId?: string;
    productName?: string;
    productSlug?: string;
    status?: string;
    paymentStatus?: string;
    amount?: number;
    currency?: string;
    createdAt?: number;
    paidAt?: number;
    licenseId?: string;
};

type License = {
    id: string;
    licenseKey?: string;
    productId?: string;
    productName?: string;
    status?: string;
    startedAt?: number;
    expiresAt?: number;
    durationDays?: number;
    maxAccounts?: number;
    mt5Account?: string | null;
};

type Product = {
    id: string;
    name?: string;
    slug?: string;
    version?: string;
    file?: {
        version?: string;
        fileName?: string;
    };
    platform?: string;
    productType?: string;
};

type Purchase = {
    order: Order;
    license?: License;
    product?: Product;
};

function formatDate(timestamp?: number) {
    if (!timestamp) {
        return "—";
    }

    return new Date(timestamp).toLocaleDateString(
        "en-GB",
        {
            year: "numeric",
            month: "short",
            day: "numeric",
        }
    );
}

function formatMoney(
    amount?: number,
    currency?: string
) {
    if (
        typeof amount !== "number" ||
        Number.isNaN(amount)
    ) {
        return "—";
    }

    return `${amount.toFixed(2)} ${(
        currency || "USD"
    ).toUpperCase()}`;
}

function getLicenseStatus(
    license?: License
) {
    if (!license) {
        return {
            label: "No License",
            className:
                "border-border bg-muted/50 text-muted-foreground",
        };
    }

    const expiresAt =
        Number(license.expiresAt || 0);

    if (
        license.status === "active" &&
        expiresAt > Date.now()
    ) {
        return {
            label: "Active",
            className:
                "border-emerald-400/20 bg-emerald-400/10 text-emerald-600",
        };
    }

    return {
        label:
            license.status === "revoked"
                ? "Revoked"
                : "Expired",
        className:
            "border-red-400/20 bg-red-400/10 text-red-600",
    };
}

export default function PurchasesPage() {
    return (
        <Suspense fallback={null}>
            <PurchasesContent />
        </Suspense>
    );
}

function PurchasesContent() {
    const searchParams = useSearchParams();

    const paymentStatus =
        searchParams.get("payment");

    const successOrderId =
        searchParams.get("order");

    const [user, setUser] =
        useState<User | null>(null);

    const [loading, setLoading] =
        useState(true);

    const [verifyingPayment, setVerifyingPayment] =
        useState(false);

    const [purchases, setPurchases] =
        useState<Purchase[]>([]);

    const [error, setError] =
        useState("");

    const [downloading, setDownloading] =
        useState<string | null>(null);

    /*
     * ---------------------------------------------------------
     * AUTH
     * ---------------------------------------------------------
     */

    useEffect(() => {
        const unsubscribeAuth =
            onAuthStateChanged(
                auth,
                (currentUser) => {
                    setUser(currentUser);

                    if (!currentUser) {
                        setLoading(false);
                    }
                }
            );

        return () => {
            unsubscribeAuth();
        };
    }, []);

    /*
     * ---------------------------------------------------------
     * VERIFY STRIPE PAYMENT AFTER SUCCESS REDIRECT
     * ---------------------------------------------------------
     */

    useEffect(() => {
        if (
            !user ||
            paymentStatus !== "success" ||
            !successOrderId
        ) {
            return;
        }

        let cancelled = false;

        async function verifyPayment() {
            try {
                setVerifyingPayment(true);
                setLoading(true);
                setError("");

                const token =
                    await user!.getIdToken();

                const response =
                    await fetch(
                        "/api/checkout/verify",
                        {
                            method: "POST",

                            headers: {
                                Authorization:
                                    `Bearer ${token}`,

                                "Content-Type":
                                    "application/json",
                            },

                            body:
                                JSON.stringify({
                                    orderId:
                                        successOrderId,
                                }),
                        }
                    );

                const data =
                    await response.json();

                if (!response.ok) {
                    throw new Error(
                        data?.error ||
                        "Unable to verify payment."
                    );
                }

                /*
                 * Give Firebase a moment to receive
                 * the updated order/license.
                 */
                await new Promise((resolve) =>
                    setTimeout(resolve, 500)
                );
            } catch (err: any) {
                console.error(
                    "PAYMENT VERIFY ERROR:",
                    err
                );

                if (!cancelled) {
                    setError(
                        err?.message ||
                        "Unable to verify your payment."
                    );
                }
            } finally {
                if (!cancelled) {
                    setVerifyingPayment(false);
                }
            }
        }

        verifyPayment();

        return () => {
            cancelled = true;
        };
    }, [
        user,
        paymentStatus,
        successOrderId,
    ]);

    /*
     * ---------------------------------------------------------
     * LOAD PURCHASES
     * ---------------------------------------------------------
     */

    useEffect(() => {
        if (!user) {
            return;
        }

        /*
         * If we are returning from Stripe,
         * keep the loading state while verification
         * is happening.
         */
        if (
            paymentStatus === "success" &&
            successOrderId &&
            verifyingPayment
        ) {
            return;
        }

        setLoading(true);
        setError("");

        const ordersRef =
            ref(
                database,
                `orders/${user.uid}`
            );

        const licensesRef =
            ref(
                database,
                `licenses/${user.uid}`
            );

        let ordersData: Record<
            string,
            Order
        > = {};

        let licensesData: Record<
            string,
            License
        > = {};

        let ordersLoaded = false;
        let licensesLoaded = false;

        const buildPurchases = async () => {
            if (
                !ordersLoaded ||
                !licensesLoaded
            ) {
                return;
            }

            try {
                const orderEntries =
                    Object.entries(
                        ordersData
                    );

                const licenseEntries =
                    Object.entries(
                        licensesData
                    );

                const result: Purchase[] =
                    [];

                for (const [
                    orderId,
                    orderValue,
                ] of orderEntries) {
                    const order: Order = {
                        ...orderValue,
                        id: orderId,
                    };

                    /*
                     * IMPORTANT:
                     *
                     * Support both fields because
                     * older orders may only have status,
                     * while the new verify endpoint also
                     * writes paymentStatus.
                     */
                    const isPaid =
                        order.status === "paid" ||
                        order.paymentStatus === "paid";

                    if (!isPaid) {
                        continue;
                    }

                    const licenseEntry =
                        licenseEntries.find(
                            ([licenseId, license]) =>
                                license.productId ===
                                order.productId ||
                                licenseId ===
                                order.licenseId ||
                                license.id ===
                                order.licenseId
                        );

                    const license =
                        licenseEntry
                            ? {
                                ...licenseEntry[1],
                                id: licenseEntry[0],
                            }
                            : undefined;

                    let product:
                        | Product
                        | undefined;

                    if (
                        order.productId
                    ) {
                        const productRef =
                            ref(
                                database,
                                `bots/${order.productId}`
                            );

                        await new Promise<void>(
                            (resolve) => {
                                onValue(
                                    productRef,
                                    (
                                        snapshot
                                    ) => {
                                        if (
                                            snapshot.exists()
                                        ) {
                                            product =
                                            {
                                                id:
                                                    order.productId!,
                                                ...snapshot.val(),
                                            };
                                        }

                                        resolve();
                                    },
                                    {
                                        onlyOnce:
                                            true,
                                    }
                                );
                            }
                        );
                    }

                    result.push({
                        order,
                        license,
                        product,
                    });
                }

                result.sort(
                    (a, b) =>
                        Number(
                            b.order.paidAt ||
                            b.order.createdAt ||
                            0
                        ) -
                        Number(
                            a.order.paidAt ||
                            a.order.createdAt ||
                            0
                        )
                );

                setPurchases(result);
                setLoading(false);
            } catch (err) {
                console.error(
                    "PURCHASES ERROR:",
                    err
                );

                setError(
                    "Unable to load your purchases."
                );

                setLoading(false);
            }
        };

        const unsubscribeOrders =
            onValue(
                ordersRef,
                (snapshot) => {
                    ordersData =
                        snapshot.exists()
                            ? snapshot.val()
                            : {};

                    ordersLoaded = true;

                    buildPurchases();
                },
                () => {
                    setError(
                        "Unable to load your orders."
                    );

                    setLoading(false);
                }
            );

        const unsubscribeLicenses =
            onValue(
                licensesRef,
                (snapshot) => {
                    licensesData =
                        snapshot.exists()
                            ? snapshot.val()
                            : {};

                    licensesLoaded = true;

                    buildPurchases();
                },
                () => {
                    setError(
                        "Unable to load your licenses."
                    );

                    setLoading(false);
                }
            );

        return () => {
            unsubscribeOrders();
            unsubscribeLicenses();
        };
    }, [
        user,
        paymentStatus,
        successOrderId,
        verifyingPayment,
    ]);

    /*
     * ---------------------------------------------------------
     * DOWNLOAD EX5
     * ---------------------------------------------------------
     */

    async function downloadProduct(
        productId: string,
        productName: string
    ) {
        if (!user) {
            return;
        }

        try {
            setDownloading(productId);
            setError("");

            const token =
                await user.getIdToken();

            const response =
                await fetch(
                    `/api/products/download?productId=${encodeURIComponent(
                        productId
                    )}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                        },
                    }
                );

            if (!response.ok) {
                let message =
                    "Download failed.";

                try {
                    const data =
                        await response.json();

                    if (data?.error) {
                        message =
                            data.error;
                    }
                } catch {
                    // Ignore JSON parsing errors.
                }

                throw new Error(message);
            }

            const blob =
                await response.blob();

            const contentDisposition =
                response.headers.get(
                    "Content-Disposition"
                );

            let fileName =
                `${productName.replace(
                    /[^a-zA-Z0-9_-]/g,
                    "_"
                )}.ex5`;

            const match =
                contentDisposition?.match(
                    /filename="([^"]+)"/i
                );

            if (match?.[1]) {
                fileName = match[1];
            }

            const url =
                window.URL.createObjectURL(
                    blob
                );

            const anchor =
                document.createElement(
                    "a"
                );

            anchor.href = url;
            anchor.download =
                fileName;

            document.body.appendChild(
                anchor
            );

            anchor.click();

            anchor.remove();

            window.URL.revokeObjectURL(
                url
            );
        } catch (err: any) {
            console.error(
                "DOWNLOAD ERROR:",
                err
            );

            setError(
                err?.message ||
                "Unable to download the EX5 file."
            );
        } finally {
            setDownloading(null);
        }
    }

    /*
     * ---------------------------------------------------------
     * NOT AUTHENTICATED
     * ---------------------------------------------------------
     */

    if (!user && !loading) {
        return (
            <AccountShell title="My Purchases" subtitle="Access your purchased trading products, licenses and EX5 files">
                <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center">
                    <div className="w-full rounded-2xl border border-border bg-muted/40 p-8 text-center">
                        <Package
                            className="mx-auto mb-5 text-muted-foreground"
                            size={42}
                        />

                        <h1 className="text-2xl font-semibold">
                            Sign in to view your purchases
                        </h1>

                        <p className="mt-2 text-sm text-muted-foreground">
                            Your purchased products and licenses will appear here.
                        </p>

                        <Link
                            href="/login?redirect=/account/purchases"
                            className="mt-6 inline-flex items-center rounded-xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:bg-muted"
                        >
                            Sign In
                        </Link>
                    </div>
                </div>
            </AccountShell>
        );
    }

    /*
     * ---------------------------------------------------------
     * PAGE
     * ---------------------------------------------------------
     */

    return (
        <AccountShell title="My Purchases" subtitle="Access your purchased trading products, licenses and EX5 files">
            <div className="mx-auto max-w-5xl">

                {/* Toolbar */}

                <div className="mb-6 flex justify-end" data-guide="page-header">
                    <Link
                        href="/marketplace"
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm text-foreground transition hover:bg-muted/60 hover:text-foreground"
                    >
                        Browse Marketplace
                        <ExternalLink
                            size={15}
                        />
                    </Link>
                </div>

                {/* Payment Verification Banner */}

                {paymentStatus === "success" &&
                    successOrderId &&
                    verifyingPayment && (
                        <div className="mb-6 flex items-center gap-3 rounded-xl border border-blue-400/20 bg-blue-400/5 p-4 text-sm text-blue-600">
                            <Loader2
                                size={18}
                                className="animate-spin"
                            />

                            <span>
                                Payment received. Confirming your order and license...
                            </span>
                        </div>
                    )}

                {paymentStatus === "success" &&
                    successOrderId &&
                    !verifyingPayment &&
                    purchases.some(
                        (purchase) =>
                            purchase.order.id ===
                            successOrderId
                    ) && (
                        <div className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-600">
                            <CheckCircle2
                                size={18}
                            />

                            <span>
                                Payment confirmed. Your product and license are ready.
                            </span>
                        </div>
                    )}

                {/* Error */}

                {error && (
                    <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-600">
                        <AlertCircle
                            size={18}
                            className="mt-0.5 shrink-0"
                        />

                        <span>
                            {error}
                        </span>
                    </div>
                )}

                {/* Loading */}

                {loading && (
                    <div className="flex min-h-[300px] items-center justify-center">
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            <Loader2
                                size={20}
                                className="animate-spin"
                            />

                            {verifyingPayment
                                ? "Confirming your payment..."
                                : "Loading your purchases..."}
                        </div>
                    </div>
                )}

                {/* Empty */}

                {!loading &&
                    purchases.length === 0 && (
                        <div className="rounded-2xl border border-border bg-muted/30 p-12 text-center">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/50">
                                <Package
                                    size={24}
                                    className="text-muted-foreground"
                                />
                            </div>

                            <h2 className="mt-5 text-xl font-semibold">
                                No purchases yet
                            </h2>

                            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                                Products you purchase from the marketplace will appear here.
                            </p>

                            <Link
                                href="/marketplace"
                                className="mt-6 inline-flex items-center rounded-xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:bg-muted"
                            >
                                Explore Marketplace
                            </Link>
                        </div>
                    )}

                {/* Purchases */}

                {!loading &&
                    purchases.length > 0 && (
                        <div className="space-y-6" data-guide="purchases-list">
                            {purchases.map(
                                ({
                                    order,
                                    license,
                                    product,
                                }) => {
                                    const status =
                                        getLicenseStatus(
                                            license
                                        );

                                    const productVersion =
                                        product?.version ||
                                        product?.file
                                            ?.version ||
                                        "—";

                                    const productName =
                                        product?.name ||
                                        order.productName ||
                                        "Trading Product";

                                    const isActive =
                                        license?.status ===
                                        "active" &&
                                        Number(
                                            license?.expiresAt ||
                                            0
                                        ) >
                                        Date.now();

                                    return (
                                        <div
                                            key={
                                                order.id
                                            }
                                            className="overflow-hidden rounded-2xl border border-border bg-muted/30"
                                        >
                                            {/* Product Header */}

                                            <div className="border-b border-border p-6 md:p-7">
                                                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                                                    <div className="flex items-start gap-4">
                                                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/50">
                                                            <FileCode2
                                                                size={24}
                                                                className="text-foreground"
                                                            />
                                                        </div>

                                                        <div>
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <h2 className="text-xl font-semibold">
                                                                    {
                                                                        productName
                                                                    }
                                                                </h2>

                                                                <span
                                                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.className}`}
                                                                >
                                                                    {
                                                                        status.label
                                                                    }
                                                                </span>
                                                            </div>

                                                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                                                <span>
                                                                    {
                                                                        product?.productType ||
                                                                        "Expert Advisor"
                                                                    }
                                                                </span>

                                                                <span>
                                                                    •
                                                                </span>

                                                                <span>
                                                                    {
                                                                        product?.platform ||
                                                                        "MT5"
                                                                    }
                                                                </span>

                                                                <span>
                                                                    •
                                                                </span>

                                                                <span>
                                                                    Version{" "}
                                                                    {
                                                                        productVersion
                                                                    }
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {product?.slug && (
                                                        <Link
                                                            href={`/marketplace/${product.slug}`}
                                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-foreground transition hover:bg-muted/70 hover:text-foreground"
                                                        >
                                                            View Product
                                                            <ExternalLink
                                                                size={15}
                                                            />
                                                        </Link>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Information Grid */}

                                            <div className="grid gap-px bg-muted md:grid-cols-2 lg:grid-cols-4" data-guide="stats">

                                                {/* Payment */}

                                                <div className="bg-muted/40 p-5">
                                                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                                                        <CheckCircle2
                                                            size={15}
                                                        />
                                                        Payment
                                                    </div>

                                                    <p className="text-sm font-medium text-emerald-600">
                                                        Paid
                                                    </p>

                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {formatDate(
                                                            order.paidAt ||
                                                            order.createdAt
                                                        )}
                                                    </p>

                                                    {typeof order.amount ===
                                                        "number" && (
                                                            <p className="mt-2 text-xs text-muted-foreground">
                                                                {formatMoney(
                                                                    order.amount,
                                                                    order.currency
                                                                )}
                                                            </p>
                                                        )}
                                                </div>

                                                {/* License */}

                                                <div className="bg-muted/40 p-5">
                                                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                                                        <KeyRound
                                                            size={15}
                                                        />
                                                        License
                                                    </div>

                                                    <p className="truncate font-mono text-xs text-foreground">
                                                        {license?.licenseKey ||
                                                            "—"}
                                                    </p>

                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        Max accounts:{" "}
                                                        {
                                                            license?.maxAccounts
                                                        }
                                                    </p>
                                                </div>

                                                {/* Expiry */}

                                                <div className="bg-muted/40 p-5">
                                                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Clock3
                                                            size={15}
                                                        />
                                                        Expiry
                                                    </div>

                                                    <p className="text-sm font-medium text-foreground">
                                                        {formatDate(
                                                            license?.expiresAt
                                                        )}
                                                    </p>

                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {license?.durationDays
                                                            ? `${license.durationDays} days`
                                                            : "—"}
                                                    </p>
                                                </div>

                                                {/* MT5 */}

                                                <div className="bg-muted/40 p-5">
                                                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                                                        <ShieldCheck
                                                            size={15}
                                                        />
                                                        MT5 Account
                                                    </div>

                                                    <p className="font-mono text-sm text-foreground">
                                                        {license?.mt5Account ||
                                                            "Not bound yet"}
                                                    </p>

                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        Account binding
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Footer */}

                                            <div className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-7">
                                                <div>
                                                    <p className="text-sm font-medium text-foreground">
                                                        {productVersion !==
                                                            "—"
                                                            ? `EX5 Version ${productVersion}`
                                                            : "EX5 Download"}
                                                    </p>

                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        Download the current licensed version of this product.
                                                    </p>
                                                </div>

                                                <button
                                                    type="button"
                                                    disabled={
                                                        !isActive ||
                                                        downloading ===
                                                        order.productId
                                                    }
                                                    onClick={() => {
                                                        if (
                                                            order.productId
                                                        ) {
                                                            downloadProduct(
                                                                order.productId,
                                                                productName
                                                            );
                                                        }
                                                    }}
                                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    {downloading ===
                                                        order.productId ? (
                                                        <Loader2
                                                            size={
                                                                17
                                                            }
                                                            className="animate-spin"
                                                        />
                                                    ) : (
                                                        <Download
                                                            size={
                                                                17
                                                            }
                                                        />
                                                    )}

                                                    {downloading ===
                                                        order.productId
                                                        ? "Preparing..."
                                                        : "Download EX5"}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }
                            )}
                        </div>
                    )}

                {/* Security Notice */}

                <div className="mt-8 rounded-2xl border border-border bg-muted/30 p-5" data-guide="security">
                    <div className="flex items-start gap-3">
                        <ShieldCheck
                            size={19}
                            className="mt-0.5 shrink-0 text-muted-foreground"
                        />

                        <div>
                            <p className="text-sm font-medium text-foreground">
                                Secure software delivery
                            </p>

                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                Your EX5 files are delivered through an authenticated secure endpoint. Access requires a valid purchase and active license.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </AccountShell>
    );
}