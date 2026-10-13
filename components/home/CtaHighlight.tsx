"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroHighlight, Highlight } from "@/components/ui/hero-highlight";
import { Button as MovingButton } from "@/components/ui/moving-border";
import { Button } from "@/components/ui/button";
import { Badge as ReUIBadge } from "@/components/reui/badge";
import Reveal from "./Reveal";

/**
 * Final CTA on Aceternity `HeroHighlight`: a mouse-follow dot reveal over
 * the panel, with `Highlight` sweeping the key promise. The primary action
 * reuses the moving-border button; the travelling dot hides under
 * reduced motion while the button stays fully usable.
 */
export default function CtaHighlight() {
    return (
        <section className="bg-background">
            <div className="page-container py-16 md:py-24">
                <Reveal>
                    <HeroHighlight containerClassName="overflow-hidden rounded-2xl border border-border shadow-lg px-6 py-14 md:py-20">
                        <div className="mx-auto max-w-2xl text-center">
                            <ReUIBadge variant="primary-light" size="lg" className="font-semibold shadow-sm">
                                Free workspace · No credit card · No signup required
                            </ReUIBadge>
                            <h2 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] text-balance text-foreground md:text-6xl">
                                Make your next <Highlight>decision legible.</Highlight>
                            </h2>
                            <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-pretty text-muted-foreground sm:text-lg">
                                Create a workspace, scan your first symbol, and run a
                                deterministic backtest in minutes — with every number accounted for.
                            </p>
                            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                                <MovingButton
                                    as={Link}
                                    href="/register"
                                    borderRadius="0.625rem"
                                    duration={3200}
                                    containerClassName="h-11 w-full sm:w-auto"
                                    borderClassName="motion-reduce:hidden"
                                    className="gap-1.5 px-6 text-sm font-semibold"
                                >
                                    Create workspace
                                    <ArrowRight size={15} aria-hidden />
                                </MovingButton>
                                <Button
                                    render={<Link href="/pricing" />}
                                    variant="outline"
                                    size="lg"
                                    className="h-11 w-full bg-card px-6 sm:w-auto"
                                >
                                    Compare plans
                                </Button>
                            </div>
                            <p className="mx-auto mt-6 max-w-lg text-xs leading-5 text-muted-foreground">
                                Trading involves risk. AlgoVault provides research tooling — not
                                financial advice, and never a promise of profit.
                            </p>
                        </div>
                    </HeroHighlight>
                </Reveal>
            </div>
        </section>
    );
}
