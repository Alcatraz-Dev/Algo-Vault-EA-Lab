"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge as ReUIBadge } from "@/components/reui/badge";
import { PRICING_TIERS, tierPriceLabel } from "@/lib/pricing-tiers";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";

/**
 * Pricing band — the real tiers from `lib/pricing-tiers` (the same source
 * the /pricing page reads), so figures can never drift from the paid page.
 * Full comparison lives on /pricing.
 */
export default function PricingTeaser() {
    return (
        <section className="border-b border-border bg-muted/30">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            Pricing
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            Start free, upgrade when it pays
                        </h2>
                        <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                            Lite tools are free forever. Pro unlocks the full workspace.
                        </p>
                    </div>
                </Reveal>
                <div className="mx-auto mt-10 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {PRICING_TIERS.map((tier, i) => {
                        const Icon = tier.icon;
                        return (
                            <Reveal key={tier.id} delay={i * 80} className="h-full">
                                <div
                                    className={cn(
                                        "flex h-full flex-col rounded-2xl border bg-muted/40 p-1.5",
                                        tier.highlighted ? "border-primary/50" : "border-border",
                                    )}
                                >
                                    <div className="rounded-xl bg-card p-5 shadow-sm">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="flex items-center gap-2 text-base font-semibold text-foreground">
                                                <Icon size={16} className="text-primary" aria-hidden />
                                                {tier.name}
                                            </p>
                                            {tier.highlighted && (
                                                <ReUIBadge variant="default" size="sm" className="font-semibold">
                                                    Popular
                                                </ReUIBadge>
                                            )}
                                        </div>
                                        <p className="mt-1.5 min-h-10 text-sm leading-5 text-pretty text-muted-foreground">
                                            {tier.description}
                                        </p>
                                        <p className="mt-5 font-numeric text-4xl font-semibold tracking-tight text-foreground">
                                            {tierPriceLabel(tier)}
                                        </p>
                                        <p className="mt-1.5 min-h-5 text-sm text-muted-foreground">
                                            {tier.price === 0 ? "No credit card needed" : "Per month, billed monthly"}
                                        </p>
                                    </div>
                                    <div className="flex flex-1 flex-col px-4 pb-4 pt-5">
                                        <ul className="flex-1 space-y-2.5">
                                            {tier.features.map((f) => (
                                                <li key={f} className="flex items-start gap-2.5 text-[13px] leading-5 text-foreground">
                                                    <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-positive/12 text-positive">
                                                        <Check size={11} strokeWidth={3} aria-hidden />
                                                    </span>
                                                    {f}
                                                </li>
                                            ))}
                                        </ul>
                                        <Button
                                            render={<Link href={tier.ctaHref} />}
                                            variant={tier.highlighted ? "default" : "outline"}
                                            className="mt-5 w-full"
                                        >
                                            {tier.cta} <ArrowRight data-icon="inline-end" />
                                        </Button>
                                    </div>
                                </div>
                            </Reveal>
                        );
                    })}
                </div>
                <p className="mt-6 text-center text-xs text-muted-foreground">
                    Full feature comparison and checkout live on the pricing page.{" "}
                    <Link href="/pricing" className="font-semibold text-primary hover:underline">
                        See all plans
                    </Link>
                </p>
            </div>
        </section>
    );
}
