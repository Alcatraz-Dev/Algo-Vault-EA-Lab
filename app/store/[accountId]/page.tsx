import { notFound } from "next/navigation";
import Link from "next/link";
import { adminDatabase } from "@/lib/firebase-admin";
import { stripeClient } from "@/lib/stripe";
import type Stripe from "stripe";
import StorefrontCheckoutButton from "@/components/storefront/StorefrontCheckoutButton";
import { ArrowLeft, ShieldCheck, Store } from "lucide-react";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public storefront for a developer's connected account.
 *
 * Route is `[accountId]` with the connected account (acct_…) as the publicly
 * visible slug. TODO(security): if storefronts should be non-guessable, swap
 * this for a per-developer public handle (e.g. `/store/<developerSlug>`) and
 * resolve it to the account server-side before rendering.
 */
export default async function StorePage({
    params,
}: {
    params: Promise<{ accountId: string }>;
}) {
    const { accountId } = await params;

    if (!accountId.startsWith("acct_")) {
        notFound();
    }

    // Resolve accountId → developer UID via the reverse index maintained by
    // /api/developer/stripe. Fall back to Stripe metadata when the index is
    // missing so existing accounts still render.
    let uid: string | null = null;
    const indexSnap = await adminDatabase.ref(`stripeAccounts/${accountId}`).get();
    const index = indexSnap.val();
    if (index?.uid) {
        uid = String(index.uid);
    }

    let account: Stripe.V2.Core.Account;
    try {
        account = await stripeClient.v2.core.accounts.retrieve(accountId, {
            include: ["configuration.merchant"],
        });
    } catch {
        notFound();
    }

    if (!uid) {
        const metaUid = account.metadata?.firebaseUID;
        if (typeof metaUid === "string" && metaUid) {
            const ownedSnap = await adminDatabase
                .ref(`users/${metaUid}/stripeConnect/accountId`)
                .get();
            if (ownedSnap.val() === accountId) uid = metaUid;
        }
    }
    if (!uid) {
        notFound();
    }

    const developerSnap = await adminDatabase.ref(`users/${uid}`).get();
    const developer = developerSnap.val() || {};

    const displayName =
        account.display_name ||
        developer.displayName ||
        developer.name ||
        developer.email ||
        "Developer";

    const cardPayments =
        account.configuration?.merchant?.capabilities?.card_payments;
    const paymentsActive = cardPayments?.status === "active";

    // Connected-account products (default price expanded). Only listed when
    // the merchant can actually take payments.
    const products: Stripe.Product[] =
        paymentsActive
            ? (
                  await stripeClient.products.list(
                      { limit: 20, active: true, expand: ["data.default_price"] },
                      { stripeAccount: accountId }
                  )
              ).data
            : [];

    const formatPrice = (amount: number | null | undefined, currency: string | undefined) => {
        const value = Number(amount ?? 0) / 100;
        const symbol = (currency || "usd").toLowerCase() === "usd" ? "$" : `${currency?.toUpperCase()} `;
        return `${symbol}${value.toFixed(2)}`;
    };

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-violet-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
            </div>

            <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to AlgoVault
                </Link>

                <div className="mb-8 flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10">
                        <Store size={22} className="text-violet-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold sm:text-3xl">{displayName}</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Official storefront on AlgoVault
                        </p>
                    </div>
                </div>

                {!paymentsActive ? (
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-8 text-center">
                        <ShieldCheck size={28} className="mx-auto text-amber-400" />
                        <p className="mt-3 text-sm font-medium text-foreground">
                            This seller is not accepting payments yet.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Products will appear once their Stripe account is ready.
                        </p>
                    </div>
                ) : products.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <Store size={28} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No products available yet.</p>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {products.map((product) => {
                            const price = product.default_price as Stripe.Price | undefined;
                            const isSubscription = Boolean(price?.recurring);
                            return (
                                <div
                                    key={product.id}
                                    className="flex flex-col rounded-2xl border border-border/30 bg-muted/50 p-5 transition-all hover:bg-muted"
                                >
                                    <h3 className="text-sm font-semibold text-foreground">
                                        {product.name}
                                    </h3>
                                    <p className="mt-1.5 flex-1 text-xs leading-5 text-muted-foreground line-clamp-3">
                                        {product.description || "Trading software by this developer."}
                                    </p>
                                    <div className="mt-4 flex items-center justify-between">
                                        <span className="font-mono text-lg font-bold text-emerald-400">
                                            {price
                                                ? formatPrice(price.unit_amount, price.currency)
                                                : "—"}
                                        </span>
                                        <span className="rounded-md bg-muted px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                                            {isSubscription ? "Monthly" : "One-time"}
                                        </span>
                                    </div>
                                    <div className="mt-3">
                                        {price ? (
                                            <StorefrontCheckoutButton
                                                accountId={accountId}
                                                stripeProductId={product.id}
                                                stripePriceId={price.id}
                                                mode={isSubscription ? "subscription" : "payment"}
                                            />
                                        ) : (
                                            <p className="text-[11px] text-muted-foreground">Price unavailable.</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </main>
    );
}