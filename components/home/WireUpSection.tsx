"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Database, FlaskConical, Plug, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";

/**
 * Interactive wiring graph ("Wire up a strategy in a minute").
 *
 * Mobile: stacked input list → status panel → consumers.
 * Desktop: a fixed-geometry canvas (scaled to fit, like the reference)
 * with positioned cards joined by bezier connectors — one glowing active
 * path, the rest faint dashes. Toggling inputs updates cards, endpoint
 * rows, progress, and consumers in both layouts; everything is local UI
 * state labeled as a sample walkthrough.
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

/* Fixed-stage geometry (1200x560). */
const STAGE_W = 1200;
const STAGE_H = 560;
const ROW_Y = [25, 155, 285, 415];
const CARD_H = 110;
const IN_X = 40;
const IN_W = 250;
const EP_X = 470;
const EP_W = 260;
const EP_Y = 140;
const EP_H = 280;
const OUT_X = 910;
const OUT_W = 250;

function useStageScale() {
    const ref = useRef<HTMLDivElement | null>(null);
    const [scale, setScale] = useState(1);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => setScale(el.clientWidth / STAGE_W);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return { ref, scale };
}

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
    const ready = done === INPUTS.length;
    const { ref, scale } = useStageScale();

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
                    <div className="mx-auto mt-6 flex max-w-5xl items-center justify-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConnected(new Set())}
                            className="h-8 px-3 text-xs"
                        >
                            Reset
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setConnected(new Set(INPUTS.map((i) => i.id)))}
                            className="h-8 px-3 text-xs"
                        >
                            Connect all
                        </Button>
                    </div>

                    {/* Mobile / tablet: stacked */}
                    <div className="mx-auto mt-6 grid max-w-5xl gap-4 lg:hidden">
                        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Inputs</p>
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
                        <StatusPanel done={done} ready={ready} />
                    </div>

                    {/* Desktop: fixed canvas */}
                    <div ref={ref} className="relative mx-auto mt-6 hidden max-w-6xl lg:block">
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(var(--border-color)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_80%_at_50%_50%,black_30%,transparent_100%)] motion-reduce:hidden"
                        />
                        <div style={{ height: STAGE_H * scale }} className="relative w-full overflow-hidden">
                            <div
                                className="absolute left-0 top-0 origin-top-left"
                                style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
                            >
                                <svg viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} className="pointer-events-none absolute inset-0 size-full" fill="none" aria-hidden="true">
                                    <defs>
                                        <filter id="wire-glow" x="-20%" y="-20%" width="140%" height="140%">
                                            <feGaussianBlur stdDeviation="4" />
                                        </filter>
                                    </defs>
                                    {ROW_Y.map((y, i) => (
                                        <g key={`in-${y}`}>
                                            <path
                                                d={`M ${IN_X + IN_W} ${y + CARD_H / 2} C 380 ${y + CARD_H / 2}, 380 280, ${EP_X} 280`}
                                                stroke="var(--border-color)"
                                                strokeWidth="1.5"
                                            />
                                            {i === 0 && (
                                                <path
                                                    d={`M ${IN_X + IN_W} ${y + CARD_H / 2} C 380 ${y + CARD_H / 2}, 380 280, ${EP_X} 280`}
                                                    stroke="var(--primary)"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    filter="url(#wire-glow)"
                                                    className="wire-flow"
                                                />
                                            )}
                                            <circle cx={IN_X + IN_W} cy={y + CARD_H / 2} r="4" fill="var(--card)" stroke={connected.has(INPUTS[i].id) ? "var(--primary)" : "var(--border-color)"} strokeWidth="1.5" />
                                        </g>
                                    ))}
                                    {ROW_Y.map((y) => (
                                        <path
                                            key={`out-${y}`}
                                            d={`M ${EP_X + EP_W} 280 C 820 280, 820 ${y + CARD_H / 2}, ${OUT_X} ${y + CARD_H / 2}`}
                                            stroke="var(--border-color)"
                                            strokeWidth="1.5"
                                            strokeDasharray="4 5"
                                        />
                                    ))}
                                    <circle cx={EP_X} cy={280} r="4" fill="var(--primary)" />
                                    <circle cx={EP_X + EP_W} cy={280} r="4" fill="var(--card)" stroke="var(--primary)" strokeWidth="1.5" />
                                </svg>

                                {INPUTS.map(({ id, name, desc, href, linkLabel, icon: Icon }, i) => {
                                    const on = connected.has(id);
                                    return (
                                        <div
                                            key={id}
                                            className={cn(
                                                "absolute rounded-xl border bg-card p-3 shadow-sm",
                                                on ? "border-positive/50" : "border-border",
                                            )}
                                            style={{ left: IN_X, top: ROW_Y[i], width: IN_W, height: CARD_H }}
                                        >
                                            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                                                <Icon size={14} className="text-primary" aria-hidden />
                                                {name}
                                            </p>
                                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{desc}</p>
                                            <div className="mt-2 flex items-center justify-between">
                                                <Link href={href} className="text-[11px] font-medium text-primary hover:underline">
                                                    {linkLabel}
                                                </Link>
                                                <button
                                                    type="button"
                                                    onClick={() => toggle(id)}
                                                    aria-pressed={on}
                                                    className={cn(
                                                        "rounded-full px-2.5 py-1 font-numeric text-[11px] font-semibold transition-colors",
                                                        on ? "bg-positive/15 text-positive" : "bg-muted text-muted-foreground hover:text-foreground",
                                                    )}
                                                >
                                                    {on ? "● Connected" : "○ Connect"}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                <div
                                    className="absolute rounded-xl border border-border bg-card p-3 shadow-md"
                                    style={{ left: EP_X, top: EP_Y, width: EP_W, height: EP_H }}
                                >
                                    <p className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-foreground">Endpoint</span>
                                        <span className="font-numeric text-muted-foreground">strategy-router</span>
                                    </p>
                                    <ul className="mt-2 space-y-1.5">
                                        {INPUTS.map(({ id, name }) => {
                                            const on = connected.has(id);
                                            return (
                                                <li key={id} className="flex items-center gap-2 text-xs">
                                                    <span
                                                        className={cn(
                                                            "h-1.5 w-1.5 shrink-0 rounded-full",
                                                            on ? "bg-positive" : "bg-muted-foreground/40",
                                                        )}
                                                        aria-hidden
                                                    />
                                                    <span className={on ? "text-foreground" : "text-muted-foreground"}>{name}</span>
                                                    {on && <Check size={12} className="ml-auto text-positive" aria-hidden />}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={INPUTS.length} aria-label="Setup progress">
                                        <div
                                            className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                                            style={{ width: `${(done / INPUTS.length) * 100}%` }}
                                        />
                                    </div>
                                    <p className="mt-1.5 text-[11px] text-muted-foreground" aria-live="polite">
                                        {ready ? "All inputs connected" : `Awaiting inputs · ${done}/${INPUTS.length}`}
                                    </p>
                                </div>

                                {CONSUMERS.map(({ name, desc, href }, i) => (
                                    <div
                                        key={name}
                                        className={cn(
                                            "absolute rounded-xl border bg-card p-3 shadow-sm transition-opacity duration-300",
                                            ready ? "border-border opacity-100" : "border-border opacity-60",
                                        )}
                                        style={{ left: OUT_X, top: ROW_Y[i], width: OUT_W, height: CARD_H }}
                                    >
                                        <p className="truncate text-[13px] font-semibold text-foreground">
                                            {href ? (
                                                <Link href={href} className="hover:text-primary hover:underline">
                                                    {name}
                                                </Link>
                                            ) : (
                                                name
                                            )}
                                        </p>
                                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{desc}</p>
                                        <p className={cn("mt-2 font-numeric text-[11px] font-semibold", ready ? "text-positive" : "text-muted-foreground")}>
                                            {ready ? "● Ready" : "○ Waiting"}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <p className="mt-2 text-center text-[11px] text-muted-foreground">
                            Sample walkthrough — toggling updates this canvas only.
                        </p>
                    </div>
                </Reveal>

                <p aria-live="polite" className="sr-only">
                    {done} of {INPUTS.length} inputs connected.
                </p>

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

function StatusPanel({ done, ready }: { done: number; ready: boolean }) {
    return (
        <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
                <p className="font-numeric text-xs font-semibold text-foreground">strategy-router</p>
                <p className="text-[11px] text-muted-foreground" aria-live="polite">
                    {ready ? "All inputs connected" : `Awaiting inputs · ${done}/${INPUTS.length}`}
                </p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={INPUTS.length} aria-label="Setup progress">
                <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: `${(done / INPUTS.length) * 100}%` }}
                />
            </div>
            <div className="mt-3 border-t border-border pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Downstream</p>
                <ul className="mt-2 space-y-1.5">
                    {CONSUMERS.map(({ name, desc, href }) => (
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
                    ))}
                </ul>
                <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
                    Sample walkthrough — toggles update this panel only.
                </p>
            </div>
        </div>
    );
}
