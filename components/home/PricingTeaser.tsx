"use client";

import Link from "next/link";
import { ArrowRight, Check } from "@phosphor-icons/react";
import Reveal from "./Reveal";
import TacticalCard from "./TacticalCard";
import HomeSectionHeader from "./HomeSectionHeader";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
    PRICING_TIERS,
    tierPeriodLabel,
    tierPriceLabel,
} from "@/lib/pricing-tiers";

/**
 * Pricing — the three real plans, quoted on the landing page.
 *
 * The tiers come from `lib/pricing-tiers`, the single source the `/pricing`
 * page also reads, so the numbers here cannot drift from the paid page. Nothing
 * is invented: the Pro tier is the only highlighted one because it is the plan
 * the pricing page highlights (DESIGN.md §17 — no fabricated social proof, and
 * no invented "most popular" claim).
 *
 * Cards, not glass: this is a bounded marketing section (ReUI compose.md puts
 * marketing on Card-led surfaces), so it uses the same solid `Card` + hairline
 * as the rest of the page.
 */
export default function PricingTeaser() {
    return (
        <section id="pricing" className="home-section border-b border-border bg-card/30 py-20 md:py-28">
            <div className="page-container">
                <Reveal>
                    <HomeSectionHeader
                        align="left"
                        eyebrow="04 · Pricing"
                        title="Start free, upgrade when Pro pays for itself"
                        description="Lite tools stay free forever. Pro unlocks the full workspace, live execution and the marketplace."
                        action={
                            <Link
                                href="/pricing"
                                className="group inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-primary hover:underline"
                            >
                                Compare every feature
                                <ArrowRight
                                    size={15}
                                    className="transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5"
                                    aria-hidden
                                />
                            </Link>
                        }
                    />
                </Reveal>

                <div className="mt-12 grid gap-4 md:grid-cols-3">
                    {PRICING_TIERS.map((tier, i) => {
                        const Icon = tier.icon;
                        const dir: -1 | 1 | 0 = i === 0 ? -1 : i === 2 ? 1 : 0;
                        return (
                            <TacticalCard
                                key={tier.id}
                                dir={dir}
                                delay={Math.min(i, 5) * 60}
                                spotlight={true}
                                className="h-full"
                            >
                                <Card
                                    className={`h-full p-6 transition-colors duration-200 hover:border-primary/40 ${
                                        tier.highlighted ? "border-primary/45 shadow-lg shadow-primary/5" : ""
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                            <Icon size={17} aria-hidden />
                                        </span>
                                        {tier.highlighted ? (
                                            <Badge variant="primary-light" radius="full">
                                                Most popular
                                            </Badge>
                                        ) : null}
                                    </div>

                                    <h3 className="home-card-title mt-4">{tier.name}</h3>
                                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                        {tier.description}
                                    </p>

                                    <p className="mt-5 flex items-baseline gap-1.5">
                                        <span className="font-numeric text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                                            {tierPriceLabel(tier)}
                                        </span>
                                        <span className="font-numeric text-xs tabular-nums text-muted-foreground">
                                            {tierPeriodLabel(tier)}
                                        </span>
                                    </p>

                                    <ul className="mt-5 grid gap-2.5 border-t border-border pt-5">
                                        {tier.features.map((feature) => (
                                            <li key={feature} className="flex items-start gap-2.5">
                                                <Check
                                                    size={15}
                                                    weight="bold"
                                                    className="mt-0.5 shrink-0 text-positive"
                                                    aria-hidden
                                                />
                                                <span className="text-sm leading-6 text-muted-foreground">
                                                    {feature}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>

                                    <div className="mt-6">
                                        <Button
                                            render={<Link href={tier.ctaHref} />}
                                            variant={tier.highlighted ? "default" : "outline"}
                                            className="w-full"
                                        >
                                            {tier.cta}
                                            <ArrowRight data-icon="inline-end" />
                                        </Button>
                                    </div>
                                </Card>
                            </TacticalCard>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
