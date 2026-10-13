"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, BarChart3, Check, Copy, Gauge, GripVertical, Play, ShieldCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import SiteLogo from "@/components/ui/site-logo";
import BrandLogo, { type BrandLogoName } from "./BrandLogos";
import Reveal from "./Reveal";

/**
 * Interactive wiring graph ("Wire up a strategy in a minute").
 *
 * Desktop: a draggable node canvas — every card moves by pointer, or by
 * focusing its move button and using the arrow keys, and the bezier
 * connectors recompute live. Toggling inputs drives the endpoint checklist,
 * progress, and consumer states. Mobile/tablet: the same state in a stacked
 * list. All local UI state, labeled as a sample walkthrough — nothing
 * configures or executes anything real.
 *
 * Chroming mirrors the Aceternity "workflows" reference: quiet rounded-2xl
 * panels with a hairline white ring + soft drop shadow, small header mark +
 * dimmed move button, two-line body, right-aligned footer, and edges as a
 * blur bloom + core line + a travelling dotted highlight (dashoffset) on live
 * connections.
 */

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
    /** Per-node accent: info / positive / warning / primary */
    tone: "info" | "positive" | "warning" | "primary";
};

const INPUTS: Input[] = [
    { id: "data", name: "Market data", desc: "TradingView quotes", tag: "feed", href: "/account/tradingview", linkLabel: "Connect feed", logo: "tradingview", tone: "info" },
    { id: "strategy", name: "Strategy", desc: "Pine Script v6 logic", tag: "logic", href: "/strategy-lab", linkLabel: "Build one", logo: "pine", tone: "positive" },
    { id: "risk", name: "Risk limits", desc: "Validator armed guard", tag: "guard", href: "/risk", linkLabel: "Set limits", icon: ShieldCheck, tone: "warning" },
    { id: "mt5", name: "MT5 terminal", desc: "Custom MQL5 EA bridge", tag: "exec", href: "/account/trading-access", linkLabel: "Connect MT5", logo: "mt5", tone: "primary" },
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

/* Fixed-stage geometry, laid out exactly like the Aceternity reference. */
const STAGE_W = 1400;
const STAGE_H = 580;
const NODE_W = 200;
const NODE_H = 110;
const EP_W = 240;
const EP_H = 200;
const EP_X = 580;
const EP_Y = 150;

const INPUT_POS: Record<string, { x: number; y: number }> = {
    data: { x: 60, y: 0 },
    strategy: { x: 60, y: 130 },
    risk: { x: 60, y: 260 },
    mt5: { x: 60, y: 390 },
};

const OUT_POS: { x: number; y: number }[] = [
    { x: 1100, y: 0 },
    { x: 1100, y: 130 },
    { x: 1100, y: 260 },
    { x: 1100, y: 390 },
];

type Pos = { x: number; y: number };

const initialPos = (): Record<string, Pos> => {
    const pos: Record<string, Pos> = {
        endpoint: { x: EP_X, y: EP_Y },
    };
    INPUTS.forEach((input) => {
        pos[`in-${input.id}`] = { ...INPUT_POS[input.id] };
    });
    CONSUMERS.forEach((_, i) => {
        pos[`out-${i}`] = { ...OUT_POS[i] };
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

const RING = "border border-border shadow-md dark:shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_12px_32px_-12px_rgba(0,0,0,0.7)]";

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

    const cardPointerProps = (id: string) => ({
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
            <div className="page-container relative py-32 md:py-40">
                <Reveal>
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            Setup graph
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            Wire up an endpoint in a minute
                        </h2>
                        <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                            Speak Pine and MQL5. Keep the tools you have. Connect TradingView quotes,
                            a Pine Script strategy, risk limits, and your MetaTrader terminal in one
                            graph. Drag from any card&apos;s dot — toggling updates this panel only;
                            nothing executes.
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
                        <div className="rounded-2xl border border-border bg-card p-4 shadow-md dark:shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_12px_32px_-12px_rgba(0,0,0,0.7)]">
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
                    <div className="mx-auto mt-6 hidden max-w-[100rem] lg:block">
                        <div ref={ref} className="relative w-full overflow-hidden">
                            <div aria-hidden className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_30%,rgba(96,165,250,0.1),transparent_70%)]" />
                            <div style={{ height: STAGE_H * scale }} className="relative w-full">
                                <div
                                    className="absolute left-0 top-0 origin-top-left select-none"
                                    style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
                                >
                                    <svg
                                        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
                                        className="pointer-events-none absolute inset-0 size-full overflow-visible"
                                        fill="none"
                                        aria-hidden="true"
                                    >
                                        <defs>
                                            <filter id="wire-glow" x="-20%" y="-20%" width="140%" height="140%">
                                                <feGaussianBlur stdDeviation="4" />
                                            </filter>
                                        </defs>
                                        {INPUTS.map((input) => {
                                            const p = pos[`in-${input.id}`] ?? INPUT_POS[input.id];
                                            const on = connected.has(input.id);
                                            const d = edge(p.x + NODE_W, p.y + NODE_H / 2, ep.x, epMidY);
                                            return (
                                                <g key={`in-${input.id}`}>
                                                    {/* Awaiting track: dim dashed line, fades out once live. */}
                                                    <path
                                                        d={d}
                                                        stroke="var(--border-color)"
                                                        strokeWidth={1.5}
                                                        strokeDasharray="3 6"
                                                        strokeLinecap="round"
                                                        opacity={on ? 0 : 1}
                                                    />
                                                    {on && (
                                                        <>
                                                            <path d={d} stroke={input.tone === "info" ? "#60a5fa" : input.tone === "positive" ? "#34d399" : input.tone === "warning" ? "#fbbf24" : "#f97316"} strokeWidth={7} opacity={0.45} filter="url(#wire-glow)" />
                                                            <path d={d} stroke={input.tone === "info" ? "#60a5fa" : input.tone === "positive" ? "#34d399" : input.tone === "warning" ? "#fbbf24" : "#f97316"} strokeWidth={2.5} strokeLinecap="round" />
                                                            <path
                                                                d={d}
                                                                stroke="white"
                                                                strokeOpacity={0.75}
                                                                strokeWidth={2}
                                                                strokeLinecap="round"
                                                                strokeDasharray="1 14"
                                                                className="wire-dash"
                                                            />
                                                        </>
                                                    )}
                                                </g>
                                            );
                                        })}
                                        {CONSUMERS.map((consumer, i) => {
                                            const p = pos[`out-${i}`] ?? OUT_POS[i];
                                            const d = edge(ep.x + EP_W, epMidY, p.x, p.y + NODE_H / 2);
                                            return (
                                                <g key={`out-${i}`}>
                                                    <path
                                                        d={d}
                                                        stroke="var(--border-color)"
                                                        strokeWidth={1.5}
                                                        strokeDasharray="3 6"
                                                        strokeLinecap="round"
                                                        opacity={ready ? 0 : 1}
                                                    />
                                                    {ready && (
                                                        <>
                                                            <path d={d} stroke="#60a5fa" strokeWidth={7} opacity={0.45} filter="url(#wire-glow)" />
                                                            <path d={d} stroke="#60a5fa" strokeWidth={2.5} strokeLinecap="round" />
                                                            <path
                                                                d={d}
                                                                stroke="white"
                                                                strokeOpacity={0.75}
                                                                strokeWidth={2}
                                                                strokeLinecap="round"
                                                                strokeDasharray="1 14"
                                                                className="wire-dash"
                                                            />
                                                        </>
                                                    )}
                                                </g>
                                            );
                                        })}
                                    </svg>

                                    {INPUTS.map((input) => {
                                        const p = pos[`in-${input.id}`] ?? INPUT_POS[input.id];
                                        const on = connected.has(input.id);
                                        return (
                                            <Fragment key={input.id}>
                                            <div
                                                key={input.id}
                                                className={cn("absolute rounded-2xl bg-card transition-colors shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_12px_32px_-12px_rgba(0,0,0,0.7)]", RING)}
                                                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                                            >
                                                <div
                                                    {...cardPointerProps(`in-${input.id}`)}
                                                    className="flex h-11 cursor-grab touch-none items-center gap-2 rounded-t-2xl px-3.5 active:cursor-grabbing"
                                                >
                                                    <NodeGlyph logo={input.logo} icon={input.icon} size={16} />
                                                    <p className="min-w-0 truncate text-xs font-medium text-foreground">{input.name}</p>
                                                    <MoveButton
                                                        ariaLabel={`Move the ${input.name} card with the arrow keys`}
                                                        onKeyDown={onCardKey(`in-${input.id}`)}
                                                    />
                                                </div>
                                                <div className="px-3.5" style={{ height: 52 }}>
                                                    <p className="truncate text-[10px] font-medium text-foreground/85">{input.desc}</p>
                                                    <p className="mt-1 truncate text-[9px] text-muted-foreground">{input.tag}</p>
                                                </div>
                                                <div className="flex h-9 items-center justify-end gap-3 pr-3.5 text-xs">
                                                    <Link
                                                        href={input.href}
                                                        className="font-medium text-muted-foreground transition-colors hover:text-foreground"
                                                    >
                                                        {input.linkLabel}
                                                    </Link>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggle(input.id)}
                                                        aria-pressed={on}
                                                        className={cn("inline-flex items-center gap-1.5 font-semibold transition-colors", on ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground")}
                                                        style={on ? { color: input.tone === "primary" ? "#f97316" : input.tone === "positive" ? "#34d399" : input.tone === "warning" ? "#fbbf24" : "#60a5fa" } : undefined}
                                                    >
                                                        <span
                                                            aria-hidden
                                                            className="size-1.5 rounded-full transition-colors"
                                                            style={on ? { backgroundColor: input.tone === "primary" ? "#f97316" : input.tone === "positive" ? "#34d399" : input.tone === "warning" ? "#fbbf24" : "#60a5fa" } : undefined}
                                                        />
                                                        {on ? "Connected" : "Connect"}
                                                    </button>
                                                </div>
                                                <div className="h-3" />
                                                <Port className="right-0 translate-x-1/2" on={on} label={on ? input.tag : undefined} onClick={() => toggle(input.id)} />
                                            </div>
                                        </Fragment>
                                    );
                                    })}

                                    <div
                                        className={cn("absolute rounded-2xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.5),0_4px_12px_-2px_rgba(0,0,0,0.45),0_16px_32px_-12px_rgba(0,0,0,0.7)]")}
                                        style={{ left: ep.x, top: ep.y, width: EP_W, height: EP_H, boxShadow: "0 0 0 1px rgba(96,165,250,0.3), 0 0 40px -10px rgba(96,165,250,0.35)" }}
                                    >
                                        <div className="relative h-full rounded-2xl bg-card p-1.5">
                                            <div
                                                {...cardPointerProps("endpoint")}
                                                className="flex h-[38px] cursor-grab touch-none items-center gap-2 rounded-xl px-2.5 active:cursor-grabbing"
                                            >
                                                <SiteLogo size={18} />
                                                <p className="truncate text-sm font-medium text-foreground">Endpoint</p>
                                                <span className="ml-1 truncate font-numeric text-xs text-muted-foreground/70">strategy-router</span>
                                                <MoveButton
                                                    ariaLabel="Move the Endpoint card with the arrow keys"
                                                    onKeyDown={onCardKey("endpoint")}
                                                />
                                            </div>
                                            <div className="relative mt-1.5 isolate overflow-hidden rounded-xl bg-background shadow-[0_1px_2px_rgba(0,0,0,0.5),0_4px_12px_-2px_rgba(0,0,0,0.45),0_16px_32px_-12px_rgba(0,0,0,0.7)]">
                                                <ul className="py-3">
                                                    {INPUTS.map(({ id, name }) => {
                                                        const on = connected.has(id);
                                                        return (
                                                            <li key={id} className="flex items-center gap-2 px-4 text-sm" style={{ height: 52 }}>
                                                                <span
                                                                    className={cn(
                                                                        "min-w-0 truncate transition-colors",
                                                                        on ? "font-medium text-foreground" : "text-muted-foreground/70",
                                                                    )}
                                                                >
                                                                    {name}
                                                                </span>
                                                                <span
                                                                    aria-hidden
                                                                    className={cn(
                                                                        "ml-auto transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                                                                        on ? "scale-100 opacity-100" : "scale-50 opacity-0",
                                                                    )}
                                                                >
                                                                    <Check size={15} strokeWidth={2.5} style={{ color: on ? (INPUTS.find(i=>i.id===id)?.tone === "info" ? "#60a5fa" : INPUTS.find(i=>i.id===id)?.tone === "positive" ? "#34d399" : INPUTS.find(i=>i.id===id)?.tone === "warning" ? "#fbbf24" : "#f97316") : undefined }} />
                                                                </span>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </div>
                                            <div className="flex h-12 items-center gap-2 px-2.5 text-xs">
                                                <span
                                                    aria-hidden
                                                    className={cn("size-1.5 shrink-0 rounded-full transition-colors", ready ? "bg-primary" : "bg-muted-foreground/30")}
                                                />
                                                <p className="truncate text-muted-foreground/80" aria-live="polite">
                                                    {ready ? "Ready to deploy" : `Awaiting inputs · ${done}/${INPUTS.length}`}
                                                </p>
                                                <Link
                                                    href="/account/trading-access"
                                                    className="ml-auto text-[11px] font-semibold text-primary hover:underline"
                                                >
                                                    Deploy
                                                </Link>
                                            </div>
                                            <Port className="left-0 -translate-x-1/2" on={done > 0} />
                                            <Port className="right-0 translate-x-1/2" on={ready} />
                                        </div>
                                    </div>

                                    {CONSUMERS.map((consumer, i) => {
                                        const p = pos[`out-${i}`] ?? OUT_POS[i];
                                        const { name, desc, tag, href, logo, icon } = consumer;
                                        return (
                                            <div
                                                key={name}
                                                className={cn(
                                                    "absolute rounded-2xl bg-card transition-opacity duration-300",
                                                    RING,
                                                    ready ? "opacity-100" : "opacity-55",
                                                )}
                                                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                                            >
                                                <div
                                                    {...cardPointerProps(`out-${i}`)}
                                                    className="flex h-11 cursor-grab touch-none items-center gap-2 rounded-t-2xl px-3.5 active:cursor-grabbing"
                                                >
                                                    <NodeGlyph logo={logo} icon={icon} size={20} />
                                                    <p className="min-w-0 truncate text-sm font-medium text-foreground">
                                                        {href ? (
                                                            <Link href={href} className="transition-colors hover:text-primary">
                                                                {name}
                                                            </Link>
                                                        ) : (
                                                            name
                                                        )}
                                                    </p>
                                                    <MoveButton
                                                        ariaLabel={`Move the ${name} card with the arrow keys`}
                                                        onKeyDown={onCardKey(`out-${i}`)}
                                                    />
                                                </div>
                                                <div className="px-3.5" style={{ height: 52 }}>
                                                    <p className="truncate text-xs font-medium text-foreground/85">{desc}</p>
                                                    <p className="mt-1 truncate text-xs text-muted-foreground">{tag}</p>
                                                </div>
                                                <div className="flex h-9 items-center gap-2 pl-3.5 text-xs">
                                                    <span
                                                        aria-hidden
                                                        className={cn("size-1.5 shrink-0 rounded-full transition-colors", ready ? "bg-primary" : "bg-muted-foreground/30")}
                                                    />
                                                    <p className={cn("truncate", ready ? "text-foreground/80" : "text-muted-foreground")}>
                                                        {ready ? "Receiving traffic" : "Waiting for endpoint"}
                                                    </p>
                                                </div>
                                                <div className="h-3" />
                                                <Port className="left-0 -translate-x-1/2" on={ready} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 pb-1 pt-3 text-[11px] text-muted-foreground">
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

function MoveButton({ ariaLabel, onKeyDown }: { ariaLabel: string; onKeyDown: (e: React.KeyboardEvent) => void }) {
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => e.stopPropagation()}
            className="-mr-1.5 ml-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/50 transition-colors hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-ring"
        >
            <GripVertical size={14} aria-hidden />
        </button>
    );
}

function NodeGlyph({ logo, icon: Icon, size = 20 }: { logo?: BrandLogoName; icon?: LucideIcon; size?: number }) {
    if (logo && Icon) {
        return (
            <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
                <BrandLogo name={logo} size={size} className="shrink-0" />
                <Icon size={Math.round(size * 0.65)} className="text-muted-foreground" />
            </span>
        );
    }
    if (logo) return <BrandLogo name={logo} size={size} className="shrink-0" />;
    return (
        <span aria-hidden className="grid shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border" style={{ width: size, height: size }}>
            {Icon ? <Icon size={Math.round(size * 0.75)} /> : null}
        </span>
    );
}

function Port({ className, on, label, onClick }: { className: string; on: boolean; label?: string; onClick?: () => void }) {
    return (
        <button
            aria-label={label || (on ? "Disconnect" : "Connect")}
            onClick={onClick}
            className={cn("pointer-events-auto absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center cursor-pointer", className)}
        >
            <span className={cn("block size-3 rounded-full ring-[4px] ring-background shadow-[0_0_12px_var(--border-color)] transition-colors", on ? "bg-[var(--primary)]" : "bg-muted-foreground/30")} />
            {label && on && (
                <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1 whitespace-nowrap rounded bg-[var(--primary)] px-1.5 py-0.5 text-[9px] font-bold text-white shadow-lg z-10">{label}</span>
            )}
        </button>
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