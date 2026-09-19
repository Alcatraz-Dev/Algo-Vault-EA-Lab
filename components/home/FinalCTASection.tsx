"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export default function FinalCTASection({ siteName }: { siteName: string }) {
    return (
        <section className="py-20 bg-background relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                <div className="relative overflow-hidden rounded-3xl border border-violet-500/30 bg-gradient-to-r from-violet-950/60 via-indigo-950/60 to-slate-950/60 p-10 text-center md:p-16 backdrop-blur-2xl shadow-2xl">
                    
                    {/* Background Glow */}
                    <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/20 blur-3xl opacity-60" />

                    <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1 text-xs font-semibold text-violet-300 backdrop-blur-md mb-6 shadow-sm font-mono">
                        <Sparkles size={14} className="animate-spin text-violet-400" />
                        <span>ENTER {siteName.toUpperCase()} OPERATING SYSTEM</span>
                    </div>

                    <h2 className="text-3xl font-extrabold tracking-tight sm:text-5xl text-foreground">
                        Your entire trading workflow.
                        <br />
                        <span className="bg-gradient-to-r from-violet-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">
                            One intelligent platform.
                        </span>
                    </h2>

                    <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                        Discover structural edges, backtest historical data, optimize parameters with AI assistance, and execute directly via your MT5 terminal.
                    </p>

                    <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Link
                            href="/register"
                            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-8 py-3.5 text-sm font-semibold text-white shadow-xl shadow-violet-600/30 transition hover:opacity-95 active:scale-95"
                        >
                            Get Started Free
                            <ArrowRight size={16} />
                        </Link>
                        <Link
                            href="/strategy-lab"
                            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-8 py-3.5 text-sm font-semibold backdrop-blur-md transition hover:bg-muted active:scale-95"
                        >
                            Open Strategy Lab
                        </Link>
                    </div>

                    <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs font-mono text-muted-foreground pt-8 border-t border-border/30">
                        <span>✓ No Credit Card Required</span>
                        <span>✓ Free Tier Included</span>
                        <span>✓ Instant MT5 Gateway Access</span>
                    </div>
                </div>
            </div>
        </section>
    );
}
