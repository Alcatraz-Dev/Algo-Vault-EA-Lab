"use client";

import Link from "next/link";
import { ArrowRight, Compass, FlaskConical, LineChart, Rocket } from "lucide-react";
import { TracingBeam } from "@/components/ui/tracing-beam";
import { IconTile } from "@/components/reui/icon-tile";
import Reveal from "./Reveal";

/**
 * Trading workflow as an Aceternity `TracingBeam`: a scroll-progress beam
 * runs down the journey while each stage keeps its own card, icon, copy,
 * and working link. The beam follows scroll velocity — it never drives it.
 */
const STEPS = [
    {
        icon: Compass,
        title: "Discover",
        copy: "Browse the marketplace or scan the market for structural setups worth your time.",
        href: "/marketplace",
        link: "Browse marketplace",
    },
    {
        icon: LineChart,
        title: "Evaluate",
        copy: "Read deterministic engine output and AI interpretation side by side — conflicts shown, not hidden.",
        href: "/market-intelligence",
        link: "Open intelligence",
    },
    {
        icon: FlaskConical,
        title: "Validate",
        copy: "Backtest, walk-forward, and stress the idea on recorded history before committing capital.",
        href: "/backtests",
        link: "Run a backtest",
    },
    {
        icon: Rocket,
        title: "Deploy",
        copy: "Route approved orders through the risk validator to MT5, then monitor fills and drawdown live.",
        href: "/account/trading-access",
        link: "Connect execution",
    },
] as const;

export default function WorkflowBeam() {
    return (
        <section className="border-b border-border bg-muted/30">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            How it works
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            A straight line from idea to audited execution.
                        </h2>
                    </div>
                </Reveal>
                <Reveal delay={100}>
                    <TracingBeam className="mt-10">
                        <ol className="space-y-4 pb-6">
                            {STEPS.map(({ icon: Icon, title, copy, href, link }, i) => (
                                <li
                                    key={title}
                                    className="ml-8 rounded-xl border border-border bg-card p-5 shadow-sm transition-colors duration-200 hover:border-primary/40 md:ml-12"
                                >
                                    <div className="flex items-center gap-3">
                                        <IconTile variant="soft" size="sm" aria-hidden>
                                            <Icon size={16} />
                                        </IconTile>
                                        <div>
                                            <p className="font-numeric text-[11px] font-semibold tracking-widest text-primary">
                                                STEP {i + 1}
                                            </p>
                                            <h3 className="text-base font-semibold tracking-tight text-foreground">
                                                {title}
                                            </h3>
                                        </div>
                                    </div>
                                    <p className="mt-3 text-[13px] leading-5 text-muted-foreground">{copy}</p>
                                    <Link
                                        href={href}
                                        className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
                                    >
                                        {link} <ArrowRight size={13} aria-hidden />
                                    </Link>
                                </li>
                            ))}
                        </ol>
                    </TracingBeam>
                </Reveal>
            </div>
        </section>
    );
}
