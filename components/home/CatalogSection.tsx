"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import type { HomeProduct } from "@/lib/home-data";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";

/**
 * Catalog section ("Every strategy, ready to inspect"): the real featured
 * marketplace listings beside the marketplace checklist. Prices and names
 * come from public records — no fabricated listings or reviews.
 */
const CHECKLIST = [
    "Licensed activation included",
    "Evidence beside every listing",
    "Copy-trading ready strategies",
    "Set files ship with systems",
    "Free workspace to start",
] as const;

function FilterChip({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                active
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}
        >
            {children}
        </button>
    );
}

function formatPrice(value?: number, currency = "USD"): string {
    if (value === undefined || !Number.isFinite(value)) return "Unavailable";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
    }).format(value);
}

export default function CatalogSection({ featured }: { featured: HomeProduct[] }) {
    // Provider rail derived from the real records — rendered only when at
    // least two platforms are present, so it can never filter to nothing.
    const platforms = useMemo(
        () => Array.from(new Set(featured.map((p) => p.platform).filter((v): v is string => Boolean(v)))),
        [featured],
    );
    const [platform, setPlatform] = useState<string | null>(null);
    const visible = platform ? featured.filter((p) => p.platform === platform).slice(0, 5) : featured.slice(0, 5);
    return (
        <section className="border-b border-border bg-background">
            <div className="page-container grid items-center gap-10 py-14 md:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
                <Reveal>
                    <div>
                        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            Model catalog
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            Every strategy, ready to inspect
                        </h2>
                        <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                            Verified experts, indicators, and set files — each with its
                            evidence beside it, each opening into full detail.
                        </p>
                        <ul className="mt-6 space-y-2.5">
                            {CHECKLIST.map((c) => (
                                <li key={c} className="flex items-center gap-2.5 text-[13px] font-medium text-foreground">
                                    <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-positive/12 text-positive">
                                        <Check size={11} strokeWidth={3} aria-hidden />
                                    </span>
                                    {c}
                                </li>
                            ))}
                        </ul>
                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                            <Button render={<Link href="/marketplace" />}>
                                Browse all strategies <ArrowRight data-icon="inline-end" />
                            </Button>
                            <Button render={<Link href="/copy-trading" />} variant="outline">
                                How copy trading works
                            </Button>
                        </div>
                    </div>
                </Reveal>

                <Reveal delay={120}>
                    <Card className="gap-0 overflow-hidden py-0 shadow-md">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                                Featured listings
                            </p>
                            <Link href="/marketplace" className="shrink-0 text-xs font-semibold text-primary hover:underline">
                                View all
                            </Link>
                        </div>
                        {platforms.length >= 2 && (
                            <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3" role="group" aria-label="Filter by platform">
                                <FilterChip active={platform === null} onClick={() => setPlatform(null)}>
                                    All
                                </FilterChip>
                                {platforms.map((name) => (
                                    <FilterChip key={name} active={platform === name} onClick={() => setPlatform(platform === name ? null : name)}>
                                        {name}
                                    </FilterChip>
                                ))}
                            </div>
                        )}
                        <div>
                            {visible.length > 0 ? (
                                visible.map((product) => (
                                    <Link
                                        key={product.id}
                                        href={`/marketplace/${product.slug || product.id}`}
                                        className="group flex items-center justify-between gap-4 border-t border-border px-4 py-3.5 transition-colors first:border-t-0 hover:bg-muted/60 sm:px-5"
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-semibold text-foreground">
                                                {product.name || "Unnamed strategy"}
                                            </span>
                                            <span className="mt-1 block truncate text-xs text-muted-foreground">
                                                {[product.symbol, product.timeframe, product.platform]
                                                    .filter(Boolean)
                                                    .join(" · ") || "Marketplace listing"}
                                            </span>
                                        </span>
                                        <span className="flex shrink-0 items-center gap-3">
                                            <span className="font-numeric text-sm font-semibold text-primary">
                                                {formatPrice(product.pricing?.price, product.pricing?.currency)}
                                            </span>
                                            <ChevronRight size={15} className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
                                        </span>
                                    </Link>
                                ))
                            ) : (
                                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                                    No marketplace listings available.
                                </p>
                            )}
                        </div>
                    </Card>
                </Reveal>
            </div>
        </section>
    );
}
