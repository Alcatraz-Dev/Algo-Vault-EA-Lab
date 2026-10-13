"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Database, FlaskConical, Plug, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";

/**
 * Interactive wiring graph ("Wire up a strategy in a minute").
 *
 * Four setup inputs with working Connect toggles drive a status panel:
 * matched inputs check off, a progress counter advances, and downstream
 * consumers flip from Waiting to Ready. Everything is local UI state,
 * labeled as a sample walkthrough — toggling here configures nothing and
 * executes nothing. Each row links to the real setup route behind it.
 */

type Input = {
    id: string;
    name: string;
    desc: string;
    href: string;
    linkLabel: string;
    icon: typeof Database;
};

const INPUTS: Input[] = [
    { id: "data", name: "Market data", desc: "TradingView quotes", href: "/account/tradingview", linkLabel: "Connect feed", icon: Database },
    { id: "strategy", name: "Strategy", desc: "Lab-built system", href: "/strategy-lab", linkLabel: "Build one", icon: FlaskConical },
    { id: "risk", name: "Risk limits", desc: "Validator armed", href: "/risk", linkLabel: "Set limits", icon: ShieldCheck },
    { id: "mt5", name: "MT5 terminal", desc: "Custom EA bridge", href: "/account/trading-access", linkLabel: "Connect MT5", icon: Plug },
];

type Consumer = { name: string; desc: string; href?: string };

const CONSUMERS: Consumer[] = [
    { name: "Signal preview", desc: "Normalized lifecycle states", href: "/signals" },
    { name: "Backtest run", desc: "Stored with full metrics", href: "/backtests" },
    { name: "Live monitor", desc: "Fills, guards, heartbeats", href: "/live" },
    { name: "Telegram alert", desc: "Mirrored to your channels" },
];

export default function WireUpSection() {
    const [connected, setConnected] = useState<Set<string>>(() => new Set(["data"]));
    const toggle = (id: string) =>
        setConnected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const done = INPUTS.filter((i) => connected.has(i.id)).length;

    return (
        <section className="relative overflow-hidden border-b border-border bg-muted/30">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-color)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.16] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_40%,black_30%,transparent_100%)] motion-reduce:hidden"
            />
            <div className="page-container relative py-14 md:py-20">
                <Reveal>
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            Setup graph
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            Wire up a strategy in a minute
                        </h2>
                        <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                            Connect a feed, a strategy, risk limits, and a terminal. Try it —
                            toggling updates this panel only; nothing executes.
                        </p>
                    </div>
                </Reveal>

                <Reveal delay={100}>
                    <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-[1fr_1fr]">
                        {/* Inputs */}
                        <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                    Inputs
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setConnected(new Set())}
                                        className="h-7 px-2 text-xs"
                                    >
                                        Reset
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setConnected(new Set(INPUTS.map((i) => i.id)))}
                                        className="h-7 px-2 text-xs text-primary"
                                    >
                                        Connect all
                                    </Button>
                                </div>
                            </div>
                            <ul className="mt-3 space-y-2">
                                {INPUTS.map(({ id, name, desc, href, linkLabel, icon: Icon }) => {
                                    const on = connected.has(id);
                                    return (
                                        <li
                                            key={id}
                                            className={cn(
                                                "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                                                on ? "border-positive/40 bg-positive/5" : "border-border bg-background",
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border",
                                                    on ? "border-positive bg-positive text-background" : "border-border text-transparent",
                                                )}
                                                aria-hidden
                                            >
                                                <Check size={11} strokeWidth={3.5} />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                                                    <Icon size={13} className="shrink-0 text-primary" aria-hidden />
                                                    {name}
                                                </span>
                                                <span className="block truncate text-[11px] text-muted-foreground">
                                                    {desc} ·{" "}
                                                    <Link href={href} className="font-medium text-primary hover:underline">
                                                        {linkLabel}
                                                    </Link>
                                                </span>
                                            </span>
                                            <Button
                                                type="button"
                                                variant={on ? "secondary" : "outline"}
                                                size="sm"
                                                onClick={() => toggle(id)}
                                                aria-pressed={on}
                                                className="h-7 shrink-0 px-3 text-xs"
                                            >
                                                {on ? "On" : "Connect"}
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>

                        {/* Status */}
                        <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
                            <div className="flex items-center justify-between">
                                <p className="font-numeric text-xs font-semibold text-foreground">strategy-router</p>
                                <p className="text-[11px] text-muted-foreground" aria-live="polite">
                                    {done === INPUTS.length ? "All inputs connected" : `Awaiting inputs · ${done}/${INPUTS.length}`}
                                </p>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={INPUTS.length} aria-label="Setup progress">
                                <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                                    style={{ width: `${(done / INPUTS.length) * 100}%` }}
                                />
                            </div>
                            <ul className="mt-2 grid flex-1 content-start gap-1.5">
                                {INPUTS.map(({ id, name }) => {
                                    const on = connected.has(id);
                                    return (
                                        <li key={id} className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground">{name}</span>
                                            <span className={cn("font-numeric font-semibold", on ? "text-positive" : "text-muted-foreground")}>
                                                {on ? "Connected" : "—"}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                            <div className="mt-3 border-t border-border pt-3">
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                    Downstream
                                </p>
                                <ul className="mt-2 space-y-1.5">
                                    {CONSUMERS.map(({ name, desc, href }) => {
                                        const ready = done === INPUTS.length;
                                        return (
                                            <li key={name} className="flex items-center justify-between gap-2 text-xs">
                                                <span className="min-w-0">
                                                    <span className="block truncate font-medium text-foreground">
                                                        {href ? (
                                                            <Link href={href} className="hover:text-primary hover:underline">
                                                                {name}
                                                            </Link>
                                                        ) : (
                                                            name
                                                        )}
                                                    </span>
                                                    <span className="block truncate text-[11px] text-muted-foreground">{desc}</span>
                                                </span>
                                                <span
                                                    className={cn(
                                                        "shrink-0 rounded-full px-2 py-0.5 font-numeric text-[11px] font-semibold",
                                                        ready ? "bg-positive/12 text-positive" : "bg-muted text-muted-foreground",
                                                    )}
                                                >
                                                    {ready ? "Ready" : "Waiting"}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                                <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
                                    Sample walkthrough — toggles update this panel only.
                                </p>
                            </div>
                        </div>
                    </div>
                </Reveal>

                <Reveal delay={160}>
                    <div className="mt-6 text-center">
                        <Button render={<Link href="/strategy-lab" />} size="lg" className="h-11 px-6">
                            Start wiring <ArrowRight data-icon="inline-end" />
                        </Button>
                    </div>
                </Reveal>
            </div>
        </section>
    );
}
