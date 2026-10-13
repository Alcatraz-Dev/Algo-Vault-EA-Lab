"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Database, FlaskConical, GripVertical, Plug, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

type Input = {
    id: string;
    name: string;
    desc: string;
    href: string;
    linkLabel: string;
    icon: typeof Database;
    dot: string;
};

const INPUTS: Input[] = [
    { id: "data", name: "Market data", desc: "TradingView quotes", href: "/account/tradingview", linkLabel: "Connect feed", icon: Database, dot: "#fbbf24" },
    { id: "strategy", name: "Strategy", desc: "Lab-built system", href: "/strategy-lab", linkLabel: "Build one", icon: FlaskConical, dot: "#fb923c" },
    { id: "risk", name: "Risk limits", desc: "Validator armed", href: "/risk", linkLabel: "Set limits", icon: ShieldCheck, dot: "#34d399" },
    { id: "mt5", name: "MT5 terminal", desc: "Custom EA bridge", href: "/account/trading-access", linkLabel: "Connect MT5", icon: Plug, dot: "#60a5fa" },
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
                            Connect a feed, a strategy, risk limits, and a terminal. Drag the
                            cards anywhere — toggling updates this panel only; nothing executes.
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

                    {/* Desktop: draggable canvas */}
                    <div ref={ref} className="relative mx-auto mt-6 hidden max-w-6xl lg:block">
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(var(--border-color)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_80%_at_50%_50%,black_30%,transparent_100%)] motion-reduce:hidden"
                        />
                        <div style={{ height: STAGE_H * scale }} className="relative w-full overflow-hidden">
                            <div
                                className="absolute left-0 top-0 origin-top-left select-none"
                                style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
                            >
                                <svg viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} className="pointer-events-none absolute inset-0 size-full" fill="none" aria-hidden="true">
                                    <defs>
                                        <filter id="wire-glow" x="-20%" y="-20%" width="140%" height="140%">
                                            <feGaussianBlur stdDeviation="4" />
                                        </filter>
                                    </defs>
                                    {INPUTS.map((input, i) => {
                                        const p = pos[`in-${input.id}`] ?? { x: IN_X, y: ROW_Y[i] };
                                        const on = connected.has(input.id);
                                        return (
                                            <g key={`in-${input.id}`}>
                                                <path
                                                    d={edge(p.x + IN_W, p.y + ROW_H / 2, ep.x, epMidY)}
                                                    stroke="var(--border-color)"
                                                    strokeWidth="1.5"
                                                />
                                                {on && (
                                                    <path
                                                        d={edge(p.x + IN_W, p.y + ROW_H / 2, ep.x, epMidY)}
                                                        stroke={input.dot}
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        filter="url(#wire-glow)"
                                                        className="wire-flow"
                                                    />
                                                )}
                                                <circle cx={p.x + IN_W} cy={p.y + ROW_H / 2} r="5" fill="var(--card)" stroke={input.dot} strokeWidth="2" opacity={on ? 1 : 0.35} />
                                            </g>
                                        );
                                    })}
                                    {CONSUMERS.map((c, i) => {
                                        const p = pos[`out-${i}`] ?? { x: OUT_X, y: ROW_Y[i] };
                                        return (
                                            <path
                                                key={`out-${i}`}
                                                d={edge(ep.x + EP_W, epMidY, p.x, p.y + ROW_H / 2)}
                                                stroke={ready ? "var(--info)" : "var(--border-color)"}
                                                strokeWidth={ready ? 2 : 1.5}
                                                strokeDasharray={ready ? undefined : "4 5"}
                                                strokeLinecap="round"
                                                opacity={ready ? 0.9 : 0.7}
                                            />
                                        );
                                    })}
                                    <circle cx={ep.x} cy={epMidY} r="5" fill="var(--primary)" />
                                    <circle cx={ep.x + EP_W} cy={epMidY} r="5" fill="var(--card)" stroke="var(--primary)" strokeWidth="2" />
                                </svg>

                                {INPUTS.map((input, i) => {
                                    const p = pos[`in-${input.id}`] ?? { x: IN_X, y: ROW_Y[i] };
                                    const Icon = input.icon;
                                    const on = connected.has(input.id);
                                    return (
                                        <div
                                            key={input.id}
                                            className={cn(
                                                "absolute rounded-xl border bg-card shadow-sm",
                                                on ? "border-positive/50" : "border-border",
                                            )}
                                            style={{ left: p.x, top: p.y, width: IN_W, height: ROW_H }}
                                        >
                                            <div
                                                {...dragHandleProps(`in-${input.id}`, `${input.name} input`)}
                                                className="flex cursor-grab touch-none items-center gap-1.5 px-3 pt-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                                            >
                                                <Icon size={14} className="text-primary" aria-hidden />
                                                <span className="text-[13px] font-semibold text-foreground">{input.name}</span>
                                                <GripVertical size={13} className="ml-auto text-muted-foreground" aria-hidden />
                                            </div>
                                            <p className="mt-0.5 truncate px-3 text-[11px] text-muted-foreground">{input.desc}</p>
                                            <div className="mt-1.5 flex items-center justify-between px-3 pb-2">
                                                <Link href={input.href} className="text-[11px] font-medium text-primary hover:underline">
                                                    {input.linkLabel}
                                                </Link>
                                                <button
                                                    type="button"
                                                    onClick={() => toggle(input.id)}
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
                                    className="absolute rounded-xl border border-border bg-card shadow-md"
                                    style={{ left: ep.x, top: ep.y, width: EP_W, height: EP_H }}
                                >
                                    <div
                                        {...dragHandleProps("endpoint", "Strategy router endpoint")}
                                        className="flex cursor-grab touch-none items-center gap-1.5 px-3 pt-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                                    >
                                        <span className="text-xs font-semibold text-foreground">Endpoint</span>
                                        <span className="font-numeric text-[11px] text-muted-foreground">strategy-router</span>
                                        <GripVertical size={13} className="ml-auto text-muted-foreground" aria-hidden />
                                    </div>
                                    <ul className="mt-2 space-y-1.5 px-3">
                                        {INPUTS.map(({ id, name, dot }) => {
                                            const on = connected.has(id);
                                            return (
                                                <li key={id} className="flex items-center gap-2 text-xs">
                                                    <span
                                                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                        style={{ backgroundColor: on ? dot : "var(--border-color)" }}
                                                        aria-hidden
                                                    />
                                                    <span className={on ? "text-foreground" : "text-muted-foreground"}>{name}</span>
                                                    {on && <Check size={12} className="ml-auto text-positive" aria-hidden />}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <div className="px-3">
                                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={INPUTS.length} aria-label="Setup progress">
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
                                </div>

                                {CONSUMERS.map(({ name, desc, href }, i) => {
                                    const p = pos[`out-${i}`] ?? { x: OUT_X, y: ROW_Y[i] };
                                    return (
                                        <div
                                            key={name}
                                            className={cn(
                                                "absolute rounded-xl border bg-card shadow-sm transition-opacity duration-300",
                                                ready ? "border-border opacity-100" : "border-border opacity-60",
                                            )}
                                            style={{ left: p.x, top: p.y, width: OUT_W, height: ROW_H }}
                                        >
                                            <div
                                                {...dragHandleProps(`out-${i}`, `${name} consumer`)}
                                                className="cursor-grab touch-none px-3 pt-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
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
                                                <p className={cn("mt-1.5 font-numeric text-[11px] font-semibold", ready ? "text-info" : "text-muted-foreground")}>
                                                    {ready ? "● Receiving traffic" : "○ Waiting"}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <p className="mt-2 text-center text-[11px] text-muted-foreground">
                            Drag any card — arrows move the focused card. Sample walkthrough; toggling updates this canvas only.
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
