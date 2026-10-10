"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export default function FinalCTASection({ siteName }: { siteName: string }) {
    return (
        <section className="py-20 bg-background relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                <div className="relative overflow-hidden rounded-lg border border-border bg-card p-10 text-center md:p-16">

                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-xs font-semibold text-primary mb-6">
                        <Sparkles size={14} className="animate-spin text-primary" />
                        <span>ENTER {siteName.toUpperCase()} OPERATING SYSTEM</span>
                    </div>

                    <h2 className="text-3xl font-extrabold tracking-tight sm:text-5xl text-foreground">
                        Your entire trading workflow.
                        <br />
                        <span className="text-primary">
                            One intelligent platform.
                        </span>
                    </h2>

                    <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                        Discover structural edges, backtest historical data, optimize parameters with AI assistance, and execute directly via your MT5 terminal.
                    </p>

                    <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Link
                            href="/register"
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:translate-y-px"
                        >
                            Get Started Free
                            <ArrowRight size={16} />
                        </Link>
                        <Link
                            href="/strategy-lab"
                            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-8 py-3.5 text-sm font-semibold transition-colors hover:bg-muted active:translate-y-px"
                        >
                            Open Strategy Lab
                        </Link>
                    </div>

                    <div className="mt-10 flex flex-wrap items-center justify-center gap-6 pt-8 text-xs text-muted-foreground border-t border-border/30">
                        <span>✓ No Credit Card Required</span>
                        <span>✓ Free Tier Included</span>
                        <span>✓ Instant MT5 Gateway Access</span>
                    </div>
                </div>
            </div>
        </section>
    );
}
