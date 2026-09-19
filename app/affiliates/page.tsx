"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import {
    ArrowLeft,
    ArrowUpRight,
    ExternalLink,
    Loader2,
    RefreshCw,
    Search,
    ShieldCheck,
    Star,
} from "lucide-react";

import { onValue, ref } from "firebase/database";
import { database } from "@/lib/firebase";

type BrandingItem = {
    fileName?: string;
    path?: string;
    extension?: string;
    size?: number;
    uploadedAt?: number;
};

type AffiliateOffer = {
    id: string;
    name: string;
    provider?: string;
    description?: string;
    category?: string;
    status: "active" | "inactive";
    commissionType?: "percentage" | "fixed";
    commissionValue?: number;
    currency?: string;
    featured?: boolean;
    branding?: {
        logo?: BrandingItem;
    };
};

function formatCommission(offer: AffiliateOffer) {
    if (!offer.commissionValue) {
        return null;
    }

    if (offer.commissionType === "percentage") {
        return `${offer.commissionValue}% commission`;
    }

    return `${offer.currency || "USD"} ${offer.commissionValue} commission`;
}

export default function AffiliatesPage() {
    const [offers, setOffers] = useState<AffiliateOffer[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        return onValue(ref(database, "settings/siteName"), (snap) => {
            if (snap.exists()) setSiteName(snap.val());
        });
    }, []);

    useEffect(() => {
        const offersRef = ref(database, "affiliate_offers");

        const unsubscribe = onValue(
            offersRef,
            (snapshot) => {
                const data = snapshot.val() || {};

                const loaded: AffiliateOffer[] =
                    Object.entries(data)
                        .map(([id, value]) => ({
                            id,
                            ...(value as Omit<
                                AffiliateOffer,
                                "id"
                            >),
                        }))
                        .filter(
                            (offer) =>
                                offer.status === "active"
                        );

                loaded.sort((a, b) => {
                    if (
                        Boolean(a.featured) !==
                        Boolean(b.featured)
                    ) {
                        return a.featured ? -1 : 1;
                    }

                    return a.name.localeCompare(b.name);
                });

                setOffers(loaded);
                setLoading(false);
            },
            (error) => {
                console.error(
                    "AFFILIATE OFFERS ERROR:",
                    error
                );

                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    const filteredOffers = useMemo(() => {
        const query = search.trim().toLowerCase();

        if (!query) {
            return offers;
        }

        return offers.filter((offer) => {
            return (
                offer.name?.toLowerCase().includes(query) ||
                offer.provider?.toLowerCase().includes(query) ||
                offer.category?.toLowerCase().includes(query) ||
                offer.description?.toLowerCase().includes(query)
            );
        });
    }, [offers, search]);

    const featuredOffers = filteredOffers.filter(
        (offer) => offer.featured
    );

    const regularOffers = filteredOffers.filter(
        (offer) => !offer.featured
    );

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Header */}
            <header className="border-b border-border/30">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-8">
                    <Link
                        href="/"
                        className="flex items-center gap-3"
                    >
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-background text-foreground">
                            <ArrowUpRight className="h-5 w-5" />
                        </div>

                        <div>
                            <div className="font-semibold">
                                {siteName}
                            </div>

                            <div className="text-xs text-foreground/50">
                                Trading Marketplace
                            </div>
                        </div>
                    </Link>

                    <nav className="hidden items-center gap-6 text-sm text-foreground/50 md:flex">
                        <Link
                            href="/marketplace"
                            className="transition hover:text-foreground"
                        >
                            Marketplace
                        </Link>

                        <Link
                            href="/backtests"
                            className="transition hover:text-foreground"
                        >
                            Backtests
                        </Link>

                        <Link
                            href="/rankings"
                            className="transition hover:text-foreground"
                        >
                            Rankings
                        </Link>

                        <Link
                            href="/affiliates"
                            className="text-foreground"
                        >
                            Recommended
                        </Link>

                        <Link
                            href="/account"
                            className="transition hover:text-foreground"
                        >
                            Account
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-5 py-12 md:px-8">
                {/* Hero */}
                <div className="max-w-3xl" data-guide="page-header">
                    <Link
                        href="/account"
                        className="mb-6 inline-flex items-center gap-2 text-sm text-foreground/50 transition hover:text-foreground"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Account
                    </Link>

                    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/30 bg-muted/5 px-3 py-1.5 text-xs text-foreground/50">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Recommended Partners
                    </div>

                    <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                        Recommended Trading
                        Partners
                    </h1>

                    <p className="mt-5 max-w-2xl text-base leading-7 text-foreground/45">
                        Explore selected brokers, trading
                        tools and services that may complement
                        your automated trading setup.
                    </p>
                </div>

                {/* Search */}
                <div className="mt-10 max-w-xl">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50" />

                        <input
                            value={search}
                            onChange={(event) =>
                                setSearch(event.target.value)
                            }
                            placeholder="Search partners..."
                            className="h-12 w-full rounded-xl border border-border/30 bg-muted pl-11 pr-4 text-sm outline-none placeholder:text-foreground/25 focus:border-border/50"
                        />
                    </div>
                </div>

                {/* Loading */}
                {loading && (
                    <div className="flex min-h-[300px] items-center justify-center">
                        <div className="text-center">
                            <Loader2 className="mx-auto h-7 w-7 animate-spin text-foreground/50" />

                            <p className="mt-3 text-sm text-foreground/50">
                                Loading recommended
                                partners...
                            </p>
                        </div>
                    </div>
                )}

                {/* Empty */}
                {!loading &&
                    filteredOffers.length === 0 && (
                        <div className="mt-10 rounded-2xl border border-border/30 bg-muted/50 px-6 py-16 text-center">
                            <RefreshCw className="mx-auto h-8 w-8 text-foreground/40" />

                            <h2 className="mt-4 text-lg font-medium">
                                No partners found
                            </h2>

                            <p className="mt-2 text-sm text-foreground/35">
                                Try another search term.
                            </p>
                        </div>
                    )}

                {/* Featured */}
                {!loading &&
                    featuredOffers.length > 0 && (
                        <section className="mt-12">
                            <div className="mb-5 flex items-center gap-2">
                                <Star className="h-4 w-4 fill-current text-yellow-400" />

                                <h2 className="text-lg font-semibold">
                                    Featured Partners
                                </h2>
                            </div>

                            <div className="grid gap-5 md:grid-cols-2">
                                {featuredOffers.map(
                                    (offer) => (
                                        <AffiliateCard
                                            key={offer.id}
                                            offer={offer}
                                            featured
                                        />
                                    )
                                )}
                            </div>
                        </section>
                    )}

                {/* Regular */}
                {!loading &&
                    regularOffers.length > 0 && (
                        <section className="mt-12">
                            <h2 className="mb-5 text-lg font-semibold">
                                All Partners
                            </h2>

                            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                                {regularOffers.map(
                                    (offer) => (
                                        <AffiliateCard
                                            key={offer.id}
                                            offer={offer}
                                        />
                                    )
                                )}
                            </div>
                        </section>
                    )}

                {/* Disclosure */}
                <div className="mt-16 rounded-2xl border border-border/30 bg-muted/50 p-5">
                    <div className="flex gap-3">
                        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-foreground/50" />

                        <div>
                            <h3 className="text-sm font-medium text-foreground/70">
                                Affiliate Disclosure
                            </h3>

                            <p className="mt-2 text-xs leading-6 text-foreground/35">
                                Some links on this page are
                                affiliate links. {siteName} may
                                receive compensation if you use
                                certain partner services. This
                                does not increase the price you
                                pay. Recommendations do not
                                constitute financial advice.
                            </p>

                            <Link
                                href="/legal/affiliate-disclosure"
                                className="mt-3 inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground"
                            >
                                Read full disclosure
                                <ArrowUpRight className="h-3 w-3" />
                            </Link>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

function AffiliateCard({
    offer,
    featured = false,
}: {
    offer: AffiliateOffer;
    featured?: boolean;
}) {
    const commission = formatCommission(offer);

    // Always try to load the broker logo.
    // The API will return 404 if no logo exists.
    const logoUrl = `/api/affiliate/branding?offerId=${encodeURIComponent(
        offer.id
    )}&type=logo`;

    const [logoError, setLogoError] = useState(false);

    return (
        <article
            className={`group relative overflow-hidden rounded-2xl border bg-foreground/6 transition ${featured
                ? "border-yellow-400/20"
                : "border-border/30"
                } hover:bg-foreground/10`}
        >
            {featured && (
                <div className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-yellow-400/20 bg-yellow-400/10 px-2.5 py-1 text-[10px] font-medium text-yellow-300">
                    <Star className="h-3 w-3 fill-current" />
                    Featured
                </div>
            )}

            <div className="p-6">
                <div className="flex items-start gap-4">
                    {/* Broker Logo */}
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/30 bg-muted/5 p-2.5">
                        {!logoError ? (
                            <img
                                key={logoUrl}
                                src={logoUrl}
                                alt={`${offer.name} logo`}
                                className="block h-full w-full object-contain"
                                onError={() => {
                                    console.error(
                                        `BROKER LOGO NOT FOUND: ${offer.name}`,
                                        logoUrl
                                    );

                                    setLogoError(true);
                                }}
                            />
                        ) : (
                            <ExternalLink className="h-5 w-5 text-foreground/50" />
                        )}
                    </div>

                    <div className="min-w-0 pr-16">
                        <h3 className="truncate text-lg font-semibold">
                            {offer.name}
                        </h3>

                        <p className="mt-1 text-xs text-foreground/35">
                            {offer.provider ||
                                "Recommended Partner"}
                        </p>
                    </div>
                </div>

                {offer.category && (
                    <div className="mt-5">
                        <span className="rounded-md border border-border/30 bg-muted/5 px-2.5 py-1 text-xs text-foreground/50">
                            {offer.category}
                        </span>
                    </div>
                )}

                <p className="mt-5 min-h-[48px] text-sm leading-6 text-foreground/45">
                    {offer.description ||
                        "Explore this recommended trading service."}
                </p>

                {commission && (
                    <div className="mt-5 rounded-lg border border-border/30 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        Partnership:{" "}
                        <span className="text-foreground/70">
                            {commission}
                        </span>
                    </div>
                )}

                <a
                    href={`/api/affiliate/click?offerId=${encodeURIComponent(
                        offer.id
                    )}`}
                    className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-background/90"
                >
                    Visit Offer
                    <ArrowUpRight className="h-4 w-4" />
                </a>
            </div>
        </article>
    );
}