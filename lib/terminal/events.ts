/**
 * Unified market event feed — Phase 5 §31 / §32.
 *
 * The feed is a *projection*: it turns payloads the engines already produce
 * into one ordered stream with one shape. It computes nothing new — no new
 * BOS detection, no new FVG detection — and it never invents a timestamp or a
 * price. If a source has no events, the feed is empty.
 *
 * `eventChartTarget` is the navigation contract used by the shell: an event
 * knows which symbol/timeframe/price it belongs to, and the shell drives the
 * shared chart to it (select symbol → select timeframe → centre time → mark).
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { TerminalEvent, TerminalEventType } from "./types";

export type AnalysisLike = import("@/lib/ai/analysis/intelligence").AdvancedAnalysisResult;
export type SignalLike = import("@/lib/ai/scalping/radar").TerminalSignal;

/** Hard cap so a busy session cannot grow the feed without bound. */
export const EVENT_FEED_LIMIT = 200;

function id(prefix: string, ...parts: Array<string | number>): string {
    return `${prefix}:${parts.join(":")}`;
}

/* ── source projections ───────────────────────────────────────────────────── */

/** Structure breaks (BOS / CHOCH) from the deterministic structure engine. */
export function structureEvents(analysis: AnalysisLike | null | undefined, fallbackTf: Timeframe): TerminalEvent[] {
    if (!analysis) return [];
    const symbol = analysis.symbol;
    const out: TerminalEvent[] = [];

    const pushes: typeof analysis.structure.bosEvents = [
        ...(analysis.structure.bosEvents ?? []),
        ...(analysis.structure.chochEvents ?? []),
    ];
    for (const e of pushes) {
        if (!e || typeof e.timestamp !== "number" || !Number.isFinite(e.timestamp)) continue;
        const type: TerminalEventType = e.type === "CHOCH" ? "CHOCH" : "BOS";
        out.push({
            id: id("struct", type, symbol, e.timestamp, e.price),
            timestamp: e.timestamp,
            symbol,
            timeframe: e.timeframe ?? fallbackTf,
            type,
            source: "smart-money",
            title: `${type} ${e.direction}`,
            detail:
                typeof e.brokenLevel === "number" && Number.isFinite(e.brokenLevel)
                    ? `broke ${e.brokenLevel}`
                    : undefined,
            price: e.price,
            severity: "notice",
        });
    }
    return out;
}

/** Liquidity sweeps (buy-side / sell-side) from the liquidity engine. */
export function sweepEvents(analysis: AnalysisLike | null | undefined, fallbackTf: Timeframe): TerminalEvent[] {
    if (!analysis) return [];
    const symbol = analysis.symbol;
    const sweeps = analysis.structure.liquiditySweeps.value ?? [];
    return sweeps.map((s) => ({
        id: id("sweep", symbol, s.timestamp, s.side, s.level),
        timestamp: s.timestamp,
        symbol,
        timeframe: fallbackTf,
        type: "SWEEP" as const,
        source: "smart-money" as const,
        title: `${s.side === "buy_side" ? "Buy-side" : "Sell-side"} liquidity swept`,
        detail: `level ${s.level}${s.confirmed ? " · confirmed" : " · unconfirmed"}`,
        price: s.sweepPrice,
        severity: (s.confirmed ? "notice" : "info") as TerminalEvent["severity"],
    }));
}

/** Fair-value gaps and order blocks — created and mitigated. */
export function zoneEvents(analysis: AnalysisLike | null | undefined, fallbackTf: Timeframe): TerminalEvent[] {
    if (!analysis) return [];
    const symbol = analysis.symbol;
    const out: TerminalEvent[] = [];

    const fvgs = analysis.structure.fairValueGaps.value ?? [];
    for (const z of fvgs) {
        out.push({
            id: id("fvg", z.id),
            timestamp: z.createdAt,
            symbol,
            timeframe: z.timeframe ?? fallbackTf,
            type: z.status === "active" ? "FVG_CREATED" : "FVG_MITIGATED",
            source: "smart-money",
            title: `${z.direction === "bullish" ? "Bullish" : z.direction === "bearish" ? "Bearish" : ""} FVG ${z.status}`.trim(),
            detail: `${z.low.toFixed(5)} – ${z.high.toFixed(5)}`,
            price: (z.high + z.low) / 2,
            severity: z.status === "active" ? "notice" : "info",
        });
    }

    const obs = analysis.structure.orderBlocks.value ?? [];
    for (const z of obs) {
        out.push({
            id: id("ob", z.id),
            timestamp: z.createdAt,
            symbol,
            timeframe: z.timeframe ?? fallbackTf,
            type: z.status === "active" ? "OB_CREATED" : "OB_MITIGATED",
            source: "smart-money",
            title: `${z.direction === "bullish" ? "Bullish" : z.direction === "bearish" ? "Bearish" : ""} order block ${z.status}`.trim(),
            detail: `${z.low.toFixed(5)} – ${z.high.toFixed(5)}`,
            price: (z.high + z.low) / 2,
            severity: z.status === "active" ? "notice" : "info",
        });
    }
    return out;
}

/** Deterministic scanner signals. */
export function signalEvents(signals: readonly SignalLike[] | null | undefined): TerminalEvent[] {
    if (!signals?.length) return [];
    return signals.map((s) => ({
        id: id("signal", s.id),
        timestamp: s.createdAt,
        symbol: s.symbol,
        timeframe: s.timeframe,
        type: "STRATEGY_SIGNAL" as const,
        source: "signal" as const,
        title: `${s.direction.toUpperCase()} signal · ${s.confidenceLabel}`,
        detail: `entry ${s.entry} · stop ${s.stop} · target ${s.target} · R:R ${s.riskReward}`,
        price: s.entry,
        severity: "notice" as const,
    }));
}

/** Risk-engine verdicts that restrict trading. */
export function riskEvents(
    input: { symbol: string; timeframe: Timeframe; timestamp: number; reasons: readonly string[]; halted: boolean } | null
): TerminalEvent[] {
    if (!input || input.reasons.length === 0) return [];
    return [
        {
            id: id("risk", input.symbol, input.timestamp),
            timestamp: input.timestamp,
            symbol: input.symbol,
            timeframe: input.timeframe,
            type: "RISK_WARNING",
            source: "risk",
            title: input.halted ? "Trading halted" : "Risk guard tripped",
            detail: input.reasons.join(" · "),
            severity: input.halted ? "critical" : "warning",
        },
    ];
}

/** Account/execution events (position opened/closed) from real fills. */
export function accountEvents(
    rows: ReadonlyArray<{
        id: string;
        timestamp: number;
        symbol: string;
        timeframe?: Timeframe;
        kind: "POSITION_OPENED" | "POSITION_CLOSED";
        side: string;
        size: number;
        price: number;
    }> | null
): TerminalEvent[] {
    if (!rows?.length) return [];
    return rows.map((r) => ({
        id: id("acct", r.id),
        timestamp: r.timestamp,
        symbol: r.symbol,
        timeframe: r.timeframe ?? "M5",
        type: r.kind,
        source: "account" as const,
        title: r.kind === "POSITION_OPENED" ? `Position opened ${r.side}` : `Position closed ${r.side}`,
        detail: `${r.size} @ ${r.price}`,
        price: r.price,
        severity: "info" as const,
    }));
}

/* ── feed assembly ────────────────────────────────────────────────────────── */

/** Newest first, de-duplicated by id, capped. */
export function buildEventFeed(groups: ReadonlyArray<readonly TerminalEvent[]>): TerminalEvent[] {
    const seen = new Set<string>();
    const all: TerminalEvent[] = [];
    for (const group of groups) {
        for (const e of group) {
            if (!e || typeof e.timestamp !== "number" || !Number.isFinite(e.timestamp)) continue;
            if (seen.has(e.id)) continue;
            seen.add(e.id);
            all.push(e);
        }
    }
    all.sort((a, b) => b.timestamp - a.timestamp);
    return all.slice(0, EVENT_FEED_LIMIT);
}

/** Events for one symbol (used by the per-symbol monitor). */
export function eventsForSymbol(events: readonly TerminalEvent[], symbol: string): TerminalEvent[] {
    return events.filter((e) => e.symbol === symbol);
}

/* ── navigation (Phase 5 §32) ─────────────────────────────────────────────── */

export interface ChartTarget {
    symbol: string;
    timeframe: Timeframe;
    /** Epoch ms of the bar to centre on. */
    time: number;
    price?: number;
    label: string;
}

/**
 * Where the chart should go for an event. Returns `null` when the event
 * cannot be located on a chart (no timestamp) so callers fail closed instead
 * of jumping somewhere arbitrary.
 */
export function eventChartTarget(event: TerminalEvent | null | undefined): ChartTarget | null {
    if (!event) return null;
    if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp) || event.timestamp <= 0) return null;
    return {
        symbol: event.symbol,
        timeframe: event.timeframe,
        time: event.timestamp,
        ...(typeof event.price === "number" && Number.isFinite(event.price) ? { price: event.price } : {}),
        label: `${event.type} · ${event.symbol} ${event.timeframe}`,
    };
}

/** Human clock label — HH:MM (UTC) — for compact feed rows. */
export function eventTimeLabel(timestamp: number): string {
    const d = new Date(timestamp);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}
