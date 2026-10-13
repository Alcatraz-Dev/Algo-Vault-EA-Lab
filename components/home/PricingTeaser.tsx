"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Reveal from "./Reveal";

/**
 * Pricing teaser: Free vs Pro from the documented tier model (PRODUCT.md) —
 * no prices quoted here; the full plans live on /pricing.
 */
const TIERS = [
    {
        name: "Starter",
        tagline: "For trying out the workspace.",
        price: "Free",
        cta: "Start for free",
        href: "/register",
        features: ["Strategy Lab access", "Market scanner", "Recorded backtests", "Community support"],
    },
    {
        name: "Pro",
        tagline: "For traders who ship live systems.",
        price: "Pro",
        cta: "Compare plans",
        href: "/pricing",
        features: ["M1 signals", "Higher daily limits", "Advanced analytics", "Priority support"],
    },
] as const;

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
                    </div>
                </Reveal>
                <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
                    {TIERS.map((tier, i) => (
                        <Reveal key={tier.name} delay={i * 80}>
                            <Card className="flex h-full flex-col p-6 shadow-sm">
                                <h3 className="text-base font-semibold text-foreground">{tier.name}</h3>
                                <p className="mt-1 text-xs text-muted-foreground">{tier.tagline}</p>
                                <p className="mt-4 font-numeric text-3xl font-semibold tracking-tight text-foreground">
                                    {tier.price}
                                </p>
                                <ul className="mt-5 flex-1 space-y-2.5">
                                    {tier.features.map((f) => (
                                        <li key={f} className="flex items-center gap-2.5 text-[13px] text-foreground">
                                            <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-positive/12 text-positive">
                                                <Check size={11} strokeWidth={3} aria-hidden />
                                            </span>
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    render={<Link href={tier.href} />}
                                    variant={i === 0 ? "outline" : "default"}
                                    className="mt-6 w-full"
                                >
                                    {tier.cta} <ArrowRight data-icon="inline-end" />
                                </Button>
                            </Card>
                        </Reveal>
                    ))}
                </div>
                <p className="mt-6 text-center text-xs text-muted-foreground">
                    Full plan details, billing periods, and checkout live on the pricing page.{" "}
                    <Link href="/pricing" className="font-semibold text-primary hover:underline">
                        See all plans
                    </Link>
                </p>
            </div>
        </section>
    );
}
