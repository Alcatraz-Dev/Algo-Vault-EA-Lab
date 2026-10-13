"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, BarChart3, Check, Gauge, GripVertical, ShieldCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import BrandLogo, { type BrandLogoName } from "./BrandLogos";
import Reveal from "./Reveal";

/**
 * Interactive wiring graph ("Wire up a strategy in a minute").
 *
 * Desktop: a draggable node canvas — every card moves by pointer or arrow
 * keys, and the bezier connectors recompute live. Toggling inputs drives
 * the endpoint checklist, progress, and consumer states. Mobile: the same
 * state in a stacked list. All local UI state, labeled as a sample
 * walkthrough — nothing configures or executes anything real.
 */

/** One accent for every live edge: connected flow is active, so it wears Ember. */
const FLOW = "var(--primary)";

type Input = {
    id: string;
    name: string;
    desc: string;
    tag: string;
    href: string;
    linkLabel: string;
    /** Real integration mark (TradingView, Pine Script, MetaTrader). */
    logo?: BrandLogoName;
    /** Product-side nodes use a glyph instead of a third-party mark. */
    icon?: LucideIcon;
};

const INPUTS: Input[] = [
    { id: "data", name: "Market data", desc: "TradingView quotes", tag: "feed", href: "/account/tradingview", linkLabel: "Connect feed", logo: "tradingview" },
    { id: "strategy", name: "Strategy", desc: "Pine Script v6 logic", tag: "logic", href: "/strategy-lab", linkLabel: "Build one", logo: "pine" },
    { id: "risk", name: "Risk limits", desc: "Validator armed guard", tag: "guard", href: "/risk", linkLabel: "Set limits", icon: ShieldCheck },
    { id: "mt5", name: "MT5 terminal", desc: "Custom MQL5 EA bridge", tag: "exec", href: "/account/trading-access", linkLabel: "Connect MT5", logo: "mt5" },
];

type Consumer = {
    name: string;
    desc: string;
    tag: string;
    href?: string;
    logo?: BrandLogoName;
    icon?: LucideIcon;
};

const CONSUMERS: Consumer[] = [
    { name: "Signal preview", desc: "Normalized lifecycle states", tag: "signal", href: "/signals", icon: Activity },
    { name: "Backtest run", desc: "Stored with full metrics", tag: "metrics", href: "/backtests", icon: BarChart3 },
    { name: "Live monitor", desc: "Fills, guards, heartbeats", tag: "telemetry", href: "/live", icon: Gauge },
    { name: "Telegram alert", desc: "Mirrored to your channels", tag: "alert", logo: "telegram" },
];

/** Brand marks the graph can route into — the "all your tools in one place" row. */
const PLUGINS: BrandLogoName[] = ["tradingview", "pine", "mql5", "mt5", "telegram"];

/* Fixed-stage geometry (1200x560). */
const STAGE_W = 1200;
const STAGE_H = 560;
const EP_H = 280;
const IN_X = 40;
const IN_W = 250;
const EP_X = 470;
const EP_W = 260;
const OUT_X = 910;
const OUT_W = 250;
const ROW_H = 110;
const ROW_Y = [25, 155, 285, 415];

type Pos = { x: number; y: number };

const initialPos = (): Record<string, Pos> => {
    const pos: Record<string, Pos> = {
        endpoint: { x: EP_X, y: 140 },
    };
    INPUTS.forEach((input, i) => {
        pos[`in-${input.id}`] = { x: IN_X, y: ROW_Y[i] };
    });
    CONSUMERS.forEach((c, i) => {
        pos[`out-${i}`] = { x: OUT_X, y: ROW_Y[i] };
    });
    return pos;
};

function edge(x1: number, y1: number, x2: number, y2: number): string {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

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
    const [pos, setPos] = useState<Record<string, Pos>>(initialPos);
    const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
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

    const ep = pos.endpoint;
    const epMidY = ep.y + EP_H / 2;

    const onCardKey = (id: string) => (e: React.KeyboardEvent) => {
        const step = e.shiftKey ? 20 : 10;
        const delta: Pos | undefined = (
            {
                ArrowUp: { x: 0, y: -step },
                ArrowDown: { x: 0, y: step },
                ArrowLeft: { x: -step, y: 0 },
                ArrowRight: { x: step, y: 0 },
            } as Record<string, Pos>
        )[e.key];
        if (!delta) return;
        e.preventDefault();
        setPos((prev) => {
            const cur = prev[id] ?? { x: 0, y: 0 };
            return {
                ...prev,
                [id]: {
                    x: Math.max(0, Math.min(STAGE_W - 100, cur.x + delta.x)),
                    y: Math.max(0, Math.min(STAGE_H - 60, cur.y + delta.y)),
                },
            };
        });
    };

    const beginDrag = (id: string) => (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);
        const cur = pos[id] ?? { x: 0, y: 0 };
        setDrag({
            id,
            dx: e.clientX / scale - cur.x,
            dy: e.clientY / scale - cur.y,
        });
    };
    const moveDrag = (e: React.PointerEvent) => {
        if (!drag) return;
        const nx = Math.max(0, Math.min(STAGE_W - 100, e.clientX / scale - drag.dx));
        const ny = Math.max(0, Math.min(STAGE_H - 60, e.clientY / scale - drag.dy));
        const id = drag.id;
        setPos((prev) => ({ ...prev, [id]: { x: nx, y: ny } }));
    };
    const endDrag = () => {
        setDrag(null);
    };

    const dragHandleProps = (id: string, label: string) => ({
        tabIndex: 0,
        role: "application" as const,
        "aria-label": `${label} card. Use arrow keys to move it.`,
        onKeyDown: onCardKey(id),
        onPointerDown: beginDrag(id),
        onPointerMove: moveDrag,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
    });

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
                            Connect TradingView quotes, a Pine Script strategy, risk limits, and your
                            MetaTrader terminal in one graph. Drag from any card&apos;s dot — toggling
                            updates this panel only; nothing executes.
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
                                {INPUTS.map(({ id, name, desc, tag, href, linkLabel, logo, icon }) => {
                                    const on = connected.has(id);
                                    return (
                                        <li
                                            key={id}
                                            className={cn(
                                                "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                                                on ? "border-primary/40 bg-primary/5" : "border-border bg-background",
                                            )}
                                        >
                                            <NodeGlyph logo={logo} icon={icon} size={36} />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                                                    {name}
                                                    <span className="rounded bg-muted px-1.5 py-0.5 font-numeric text-[10px] font-medium text-muted-foreground">
                                                        {tag}
                                                    </span>
                                                </span>
                                                <span className="block truncate text-[11px] text-muted-foreground">
                                                    {desc} ·{" "}
                                                    <Link href={href} className="font-medium text-primary hover:underline">
                                                        {linkLabel}
                                                    </Link>
                                                </span>
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => toggle(id)}
                                                aria-pressed={on}
                                                className={cn(
                                                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-numeric text-[11px] font-semibold transition-colors",
                                                    on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground hover:text-foreground",
                                                )}
                                            >
                                                {on && <Check size={11} strokeWidth={3.5} aria-hidden />}
                                                {on ? "Connected" : "Connect"}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                        <StatusPanel done={done} ready={ready} />
                    </div>

                    {/* Desktop: draggable canvas */}
                    <div
                        className="relative mx-auto mt-6 hidden max-w-6xl rounded-2xl border border-border bg-card p-1.5 shadow-md lg:block"
                    >
                        <div ref={ref} className="relative overflow-hidden rounded-xl bg-muted/40">
                            <div
                                aria-hidden
                                className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(var(--border-color)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_75%_85%_at_50%_50%,black_30%,transparent_100%)] motion-reduce:hidden"
                            />
                            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex h-6 items-end justify-between px-4">
                                {Array.from({ length: 25 }, (_, i) => (
                                    <span key={i} className={cn("w-px bg-border", i % 5 === 0 ? "h-2.5" : "h-1.5")} />
                                ))}
                            </div>
                            <div style={{ height: STAGE_H * scale }} className="relative w-full overflow-hidden pt-3">
                                <div
                                    className="absolute left-0 top-3 origin-top-left select-none"
                                    style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
                                >
                                    <svg viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} className="pointer-events-none absolute inset-0 size-full" fill="none" aria-hidden="true">
                                        <defs>
                                            <filter id="wire-glow" x="-20%" y="-20%" width="140%" height="140%">
                                                <feGaussianBlur stdDeviation="3.5" />
                                            </filter>
                                            <linearGradient id="wire-fade" x1="0" y1="0" x2="1" y2="0">
                                                <stop offset="0" stopColor={FLOW} stopOpacity="0.15" />
                                                <stop offset="0.5" stopColor={FLOW} stopOpacity="1" />
                                                <stop offset="1" stopColor={FLOW} stopOpacity="0.15" />
                                            </linearGradient>
                                        </defs>
                                        {INPUTS.map((input, i) => {
                                            const p = pos[`in-${input.id}`] ?? { x: IN_X, y: ROW_Y[i] };
                                            const on = connected.has(input.id);
                                            const d = edge(p.x + IN_W, p.y + ROW_H / 2, ep.x, epMidY);
                                            return (
                                                <g key={`in-${input.id}`}>
                                                    {/* Awaiting track: dashed, fades out once live. */}
                                                    <path
                                                        d={d}
                                                        stroke="var(--border-color)"
                                                        strokeWidth={1.5}
                                                        strokeDasharray="4 5"
                                                        strokeLinecap="round"
                                                        opacity={on ? 0 : 0.9}
                                                    />
                                                    {on && (
                                                        <>
                                                            {/* Bloom under the line. */}
                                                            <path
                                                                d={d}
                                                                stroke={FLOW}
                                                                strokeWidth={4}
                                                                strokeLinecap="round"
                                                                opacity={0.35}
                                                                filter="url(#wire-glow)"
                                                            />
                                                            <path
                                                                d={d}
                                                                stroke="url(#wire-fade)"
                                                                strokeWidth={1.5}
                                                                strokeLinecap="round"
                                                            />
                                                            {/* Travelling highlight. */}
                                                            <path d={d} stroke={FLOW} strokeWidth={1.75} strokeLinecap="round" className="wire-comet" />
                                                        </>
                                                    )}
                                                </g>
                                            );
                                        })}
                                        {CONSUMERS.map((c, i) => {
                                            const p = pos[`out-${i}`] ?? { x: OUT_X, y: ROW_Y[i] };
                                            const d = edge(ep.x + EP_W, epMidY, p.x, p.y + ROW_H / 2);
                                            return (
                                                <g key={`out-${i}`}>
                                                    <path
                                                        d={d}
                                                        stroke={ready ? "var(--info)" : "var(--border-color)"}
                                                        strokeWidth={1.5}
                                                        strokeDasharray={ready ? undefined : "4 5"}
                                                        strokeLinecap="round"
                                                        opacity={ready ? 0.6 : 0.7}
                                                    />
                                                    {ready && <path d={d} stroke="var(--info)" strokeWidth={1.75} strokeLinecap="round" className="wire-comet" />}
                                                </g>
                                            );
                                        })}
                                    </svg>

                                    {INPUTS.map((input, i) => {
                                        const p = pos[`in-${input.id}`] ?? { x: IN_X, y: ROW_Y[i] };
                                        const on = connected.has(input.id);
                                        return (
                                            <div
                                                key={input.id}
                                                className={cn(
                                                    "absolute rounded-xl border bg-card shadow-sm transition-colors",
                                                    on ? "border-primary/50" : "border-border",
                                                )}
                                                style={{ left: p.x, top: p.y, width: IN_W, height: ROW_H }}
                                            >
                                                <div
                                                    {...dragHandleProps(`in-${input.id}`, `${input.name} input`)}
                                                    className="flex h-11 cursor-grab touch-none items-center gap-2.5 rounded-t-xl px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                                                >
                                                    <NodeGlyph logo={input.logo} icon={input.icon} size={30} />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-[13px] font-semibold text-foreground">{input.name}</span>
                                                        <span className="block truncate text-[10.5px] text-muted-foreground">{input.desc}</span>
                                                    </span>
                                                    <GripVertical size={13} className="shrink-0 text-muted-foreground" aria-hidden />
                                                </div>
                                                <div className="px-3">
                                                    <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 font-numeric text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                                                        {input.tag}
                                                    </span>
                                                </div>
                                                <div className="absolute inset-x-0 bottom-0 flex h-8 items-center justify-between border-t border-border/70 px-3">
                                                    <Link href={input.href} className="text-[11px] font-medium text-primary hover:underline">
                                                        {input.linkLabel}
                                                    </Link>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggle(input.id)}
                                                        aria-pressed={on}
                                                        className={cn(
                                                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-numeric text-[11px] font-semibold transition-colors",
                                                            on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground hover:text-foreground",
                                                        )}
                                                    >
                                                        <span
                                                            aria-hidden
                                                            className={cn("size-1.5 rounded-full", on ? "bg-primary" : "bg-muted-foreground/50")}
                                                        />
                                                        {on ? "Connected" : "Connect"}
                                                    </button>
                                                </div>
                                                <span
                                                    aria-hidden
                                                    className={cn(
                                                        "absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full ring-[3px] ring-card transition-colors",
                                                        on ? "border-2" : "border border-border bg-card",
                                                    )}
                                                    style={on ? { backgroundColor: FLOW, borderColor: FLOW, boxShadow: `0 0 10px ${FLOW}` } : undefined}
                                                />
                                            </div>
                                        );
                                    })}

                                    <div
                                        className="absolute rounded-xl border border-border bg-card shadow-md"
                                        style={{ left: ep.x, top: ep.y, width: EP_W, height: EP_H }}
                                    >
                                        <div
                                            {...dragHandleProps("endpoint", "Strategy router endpoint")}
                                            className="flex h-11 cursor-grab touch-none items-center gap-2.5 rounded-t-xl px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                                        >
                                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted ring-1 ring-border" aria-hidden>
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src="/logos/logo.png" alt="" width={18} height={18} loading="lazy" decoding="async" className="size-4.5 rounded object-contain" />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[13px] font-semibold text-foreground">Endpoint</span>
                                                <span className="block truncate font-numeric text-[10.5px] text-muted-foreground">strategy-router</span>
                                            </span>
                                            <GripVertical size={13} className="shrink-0 text-muted-foreground" aria-hidden />
                                        </div>
                                        <ul className="mt-1 space-y-1 px-3">
                                            {INPUTS.map(({ id, name }) => {
                                                const on = connected.has(id);
                                                return (
                                                    <li key={id} className="flex items-center gap-2 text-xs">
                                                        <span
                                                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                            style={{ backgroundColor: on ? FLOW : "var(--border-color)" }}
                                                            aria-hidden
                                                        />
                                                        <span className={on ? "text-foreground" : "text-muted-foreground"}>{name}</span>
                                                        {on && <Check size={12} className="ml-auto text-primary" aria-hidden />}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                        <div className="px-3">
                                            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={INPUTS.length} aria-label="Setup progress">
                                                <div
                                                    className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                                                    style={{ width: `${(done / INPUTS.length) * 100}%` }}
                                                />
                                            </div>
                                            <div className="mt-2 flex items-center justify-between">
                                                <p className="text-[11px] text-muted-foreground" aria-live="polite">
                                                    {ready ? "Ready to deploy" : `Awaiting inputs · ${done}/${INPUTS.length}`}
                                                </p>
                                                <Link
                                                    href="/account/trading-access"
                                                    className="rounded-full bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground ring-1 ring-border transition-colors hover:border-primary/50 hover:text-primary"
                                                >
                                                    Deploy
                                                </Link>
                                            </div>
                                        </div>
                                        <span
                                            aria-hidden
                                            className={cn(
                                                "absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full ring-[3px] ring-card transition-colors",
                                                ready ? "border-2" : "border border-border bg-card",
                                            )}
                                            style={ready ? { backgroundColor: "var(--info)", borderColor: "var(--info)", boxShadow: "0 0 10px var(--info)" } : undefined}
                                        />
                                        <span
                                            aria-hidden
                                            className={cn(
                                                "absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full ring-[3px] ring-card transition-colors",
                                                done > 0 ? "border-2" : "border border-border bg-card",
                                            )}
                                            style={done > 0 ? { backgroundColor: FLOW, borderColor: FLOW, boxShadow: `0 0 10px ${FLOW}` } : undefined}
                                        />
                                    </div>

                                    {CONSUMERS.map((consumer, i) => {
                                        const p = pos[`out-${i}`] ?? { x: OUT_X, y: ROW_Y[i] };
                                        const { name, desc, tag, href, logo, icon } = consumer;
                                        return (
                                            <div
                                                key={name}
                                                className={cn(
                                                    "absolute rounded-xl border border-border bg-card shadow-sm transition-opacity duration-300",
                                                    ready ? "opacity-100" : "opacity-60",
                                                )}
                                                style={{ left: p.x, top: p.y, width: OUT_W, height: ROW_H }}
                                            >
                                                <div
                                                    {...dragHandleProps(`out-${i}`, `${name} consumer`)}
                                                    className="flex cursor-grab touch-none items-center gap-2.5 px-3 pt-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                                                >
                                                    <NodeGlyph logo={logo} icon={icon} size={28} />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-[13px] font-semibold text-foreground">
                                                            {href ? (
                                                                <Link href={href} className="hover:text-primary hover:underline">
                                                                    {name}
                                                                </Link>
                                                            ) : (
                                                                name
                                                            )}
                                                        </span>
                                                        <span className="block truncate text-[10.5px] text-muted-foreground">{desc}</span>
                                                    </span>
                                                </div>
                                                <div className="mt-2 flex items-center justify-between gap-2 px-3">
                                                    <p className={cn("font-numeric text-[11px] font-semibold", ready ? "text-info" : "text-muted-foreground")}>
                                                        {ready ? "● Receiving traffic" : "○ Waiting for endpoint"}
                                                    </p>
                                                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-numeric text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                                                        {tag}
                                                    </span>
                                                </div>
                                                <span
                                                    aria-hidden
                                                    className={cn(
                                                        "absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full ring-[3px] ring-card transition-colors",
                                                        ready ? "border-2 border-info bg-info" : "border border-border bg-card",
                                                    )}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2 px-4 pb-2.5 pt-3 text-[11px] text-muted-foreground">
                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                <span className="flex flex-wrap items-center gap-2">
                                    <span>Plugs into</span>
                                    {PLUGINS.map((name) => (
                                        <BrandLogo key={name} name={name} size={18} />
                                    ))}
                                </span>
                                <span className="flex flex-wrap items-center gap-3">
                                    <span className="flex items-center gap-1.5">
                                        <span className="h-1.5 w-3 rounded-full bg-primary" aria-hidden />
                                        connected
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <span className="h-px w-3 border-t border-dashed border-muted-foreground" aria-hidden />
                                        awaiting
                                    </span>
                                    <span className="font-numeric">{done}/{INPUTS.length}</span>
                                </span>
                            </div>
                            <p>Drag from a dot to move a card — arrows move the focused card.</p>
                        </div>
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

function NodeGlyph({ logo, icon: Icon, size = 30 }: { logo?: BrandLogoName; icon?: LucideIcon; size?: number }) {
    if (logo) return <BrandLogo name={logo} size={size} className="shrink-0" />;
    return (
        <span
            aria-hidden
            className="grid shrink-0 place-items-center rounded-lg bg-muted text-primary ring-1 ring-border"
            style={{ width: size, height: size }}
        >
            {Icon ? <Icon size={Math.round(size * 0.5)} /> : null}
        </span>
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
