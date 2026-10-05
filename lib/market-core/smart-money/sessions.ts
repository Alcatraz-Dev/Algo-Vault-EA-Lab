/**
 * Sessions — deterministic UTC windows shared by chart, context and alerts.
 *
 * Windows (UTC, documented in docs/market-intelligence-core.md):
 *   Asia     00:00 – 08:00
 *   London   07:00 – 16:00
 *   New York 12:00 – 21:00
 * Overlaps are intentional (London/NY overlap 12:00–16:00). These match the
 * chart's session layer and `lib/analytics/sessions.ts` labels so a level
 * drawn on the chart and a fact sent to AI never disagree.
 */

import type { CoreCandle, SmartMoneyObject } from "../types";
import { baseObject, makeId, type DetectorContext } from "./shared";

export interface SessionWindow {
    key: "asia" | "london" | "new_york";
    label: string;
    startHour: number;
    endHour: number;
    color: string;
}

export const SESSION_WINDOWS: SessionWindow[] = [
    { key: "asia", label: "Asia", startHour: 0, endHour: 8, color: "#a78bfa" },
    { key: "london", label: "London", startHour: 7, endHour: 16, color: "#22d3ee" },
    { key: "new_york", label: "New York", startHour: 12, endHour: 21, color: "#f59e0b" },
];

/** Session active at a UTC timestamp (multiple can be active in overlap). */
export function sessionsAt(timestampMs: number): SessionWindow[] {
    const hour = new Date(timestampMs).getUTCHours();
    return SESSION_WINDOWS.filter((w) => hour >= w.startHour && hour < w.endHour);
}

/** Primary session label at a timestamp (overlap wins: New York > London > Asia). */
export function primarySession(timestampMs: number): string {
    const active = sessionsAt(timestampMs);
    if (active.length === 0) return "closed";
    if (active.some((s) => s.key === "new_york") && active.some((s) => s.key === "london")) return "overlap";
    return active[active.length - 1].label;
}

function utcDay(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
}

export interface SessionLevel {
    session: SessionWindow;
    high: number;
    low: number;
    label: string;
    color: string;
    day: string;
}

/**
 * High/low of each session window within the LAST UTC day present in the
 * candles (the levels the chart's session layer draws).
 */
export function sessionLevels(candles: readonly CoreCandle[]): SessionLevel[] {
    if (candles.length === 0) return [];
    const lastDay = utcDay(candles[candles.length - 1].timestamp);
    const out: SessionLevel[] = [];
    for (const w of SESSION_WINDOWS) {
        const inWindow = candles.filter((c) => {
            if (utcDay(c.timestamp) !== lastDay) return false;
            const d = new Date(c.timestamp);
            return d.getUTCHours() >= w.startHour && d.getUTCHours() < w.endHour;
        });
        if (inWindow.length < 3) continue;
        out.push({
            session: w,
            high: Math.max(...inWindow.map((c) => c.high)),
            low: Math.min(...inWindow.map((c) => c.low)),
            label: w.label,
            color: w.color,
            day: lastDay,
        });
    }
    return out;
}

/** Session high/low as Smart Money liquidity objects for the current day. */
export function detectSessionLiquidity(ctx: DetectorContext): SmartMoneyObject[] {
    const levels = sessionLevels(ctx.candles);
    const out: SmartMoneyObject[] = [];
    const lastTs = ctx.candles[ctx.candles.length - 1]?.timestamp;
    if (lastTs === undefined) return out;
    for (const level of levels) {
        for (const side of ["high", "low"] as const) {
            const price = side === "high" ? level.high : level.low;
            const obj = baseObject(
                ctx,
                "liquidity_pool",
                makeId(["session", side, level.session.key, level.day, ctx.symbol, ctx.timeframe]),
                lastTs,
                lastTs,
                side === "high" ? "bullish" : "bearish",
            );
            obj.status = "active";
            obj.price = price;
            obj.sourceCandles = ctx.candles.filter((c) => utcDay(c.timestamp) === level.day).map((c) => c.timestamp);
            obj.metadata = {
                side: side === "high" ? "buy_side" : "sell_side",
                source: "session",
                session: level.session.key,
                day: level.day,
            };
            out.push(obj);
        }
    }
    return out;
}
