/**
 * Strategy chart markers (Phase 4).
 *
 * Every marker is expressed in MARKET coordinates (time + price) — never
 * screen pixels — so they render identically on the native chart, replay and
 * backtest views. One marker source, no duplicates, no stale markers when the
 * active strategy changes (call `buildStrategyMarkers` with the current
 * strategy + trades each render, keyed by strategy id/version).
 */

import type { BacktestTrade, Strategy } from "@/lib/strategy-lab/types";
import type { Position, StrategyMarker, StrategyMarkerToggles } from "./types";

export const DEFAULT_MARKER_TOGGLES: StrategyMarkerToggles = {
    entries: true,
    exits: true,
    stopLoss: true,
    takeProfit: true,
    signals: false,
    conditions: false,
};

const COLORS = {
    entryLong: "#22c55e",
    entryShort: "#ef4444",
    exit: "#94a3b8",
    stop: "#f97316",
    target: "#38bdf8",
    signal: "#a855f7",
    position: "#eab308",
} as const;

export interface BuildMarkersInput {
    strategy: Pick<Strategy, "id" | "name" | "version">;
    /** Closed trades (backtest results or paper/replay history). */
    trades?: Array<
        Pick<
            BacktestTrade,
            "id" | "openedAt" | "closedAt" | "entry" | "exit" | "sl" | "tp1" | "direction" | "exitReason" | "volume"
        >
    >;
    /** Currently open positions (live overlay). */
    positions?: Position[];
    toggles?: Partial<StrategyMarkerToggles>;
    /** Skip entries older than this timestamp (windowing for performance). */
    since?: number;
    /** Hard cap to avoid rendering every historical marker at once. */
    limit?: number;
}

/**
 * Build the full marker set for the strategy layer.
 * Deterministic ids: `${strategyId}:${tradeId}:${kind}` — re-rendering never
 * duplicates markers.
 */
export function buildStrategyMarkers(input: BuildMarkersInput): StrategyMarker[] {
    const toggles: StrategyMarkerToggles = { ...DEFAULT_MARKER_TOGGLES, ...input.toggles ?? {} };
    const markers: StrategyMarker[] = [];
    const version = input.strategy.version;

    for (const t of input.trades ?? []) {
        if (input.since !== undefined && t.closedAt !== undefined && t.closedAt < input.since) continue;
        const isLong = t.direction === "BUY";

        if (toggles.entries) {
            markers.push({
                id: `${input.strategy.id}:${t.id}:entry`,
                time: t.openedAt,
                price: t.entry,
                kind: "entry",
                side: isLong ? "BUY" : "SELL",
                label: `${isLong ? "Long" : "Short"} entry ${t.volume}`,
                color: isLong ? COLORS.entryLong : COLORS.entryShort,
                strategyId: input.strategy.id,
                strategyVersion: version,
                tradeId: t.id,
                status: "closed",
            });
        }

        if (toggles.exits && t.closedAt !== undefined) {
            markers.push({
                id: `${input.strategy.id}:${t.id}:exit`,
                time: t.closedAt,
                price: t.exit,
                kind: "exit",
                side: isLong ? "SELL" : "BUY",
                label: `Exit (${t.exitReason})`,
                color: COLORS.exit,
                strategyId: input.strategy.id,
                strategyVersion: version,
                tradeId: t.id,
                status: "closed",
            });
        }

        if (toggles.stopLoss && t.sl > 0) {
            markers.push({
                id: `${input.strategy.id}:${t.id}:sl`,
                time: t.openedAt,
                price: t.sl,
                kind: "stop_loss",
                side: isLong ? "SELL" : "BUY",
                label: "SL",
                color: COLORS.stop,
                strategyId: input.strategy.id,
                strategyVersion: version,
                tradeId: t.id,
            });
        }

        if (toggles.takeProfit && t.tp1 > 0) {
            markers.push({
                id: `${input.strategy.id}:${t.id}:tp`,
                time: t.openedAt,
                price: t.tp1,
                kind: "take_profit",
                side: isLong ? "SELL" : "BUY",
                label: "TP",
                color: COLORS.target,
                strategyId: input.strategy.id,
                strategyVersion: version,
                tradeId: t.id,
            });
        }
    }

    for (const pos of input.positions ?? []) {
        if (pos.status !== "open") continue;
        if (toggles.entries) {
            markers.push({
                id: `${input.strategy.id}:${pos.id}:position`,
                time: pos.openedAt,
                price: pos.entryPrice,
                kind: "position",
                side: pos.side === "LONG" ? "BUY" : "SELL",
                label: `Open ${pos.side} ${pos.remainingQuantity}`,
                color: COLORS.position,
                strategyId: input.strategy.id,
                strategyVersion: pos.strategyVersion ?? version,
                tradeId: pos.id,
                status: "open",
            });
        }
        if (toggles.stopLoss && Number.isFinite(pos.stopLoss)) {
            markers.push({
                id: `${input.strategy.id}:${pos.id}:sl`,
                time: pos.openedAt,
                price: pos.stopLoss,
                kind: "stop_loss",
                side: pos.side === "LONG" ? "SELL" : "BUY",
                label: "SL",
                color: COLORS.stop,
                strategyId: input.strategy.id,
                strategyVersion: pos.strategyVersion ?? version,
                tradeId: pos.id,
                status: "open",
            });
        }
        const target = pos.targets.find((t) => !t.hit && t.price > 0);
        if (toggles.takeProfit && target) {
            markers.push({
                id: `${input.strategy.id}:${pos.id}:tp`,
                time: pos.openedAt,
                price: target.price,
                kind: "take_profit",
                side: pos.side === "LONG" ? "SELL" : "BUY",
                label: target.id.toUpperCase(),
                color: COLORS.target,
                strategyId: input.strategy.id,
                strategyVersion: pos.strategyVersion ?? version,
                tradeId: pos.id,
                status: "open",
            });
        }
    }

    // Deterministic order: time, then kind, then id (stable across renders).
    markers.sort((a, b) => a.time - b.time || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

    const limit = input.limit ?? 2000;
    return markers.length > limit ? markers.slice(markers.length - limit) : markers;
}

/** Markers belonging to a different strategy/version — used to purge stale layers. */
export function markersForStrategy(markers: StrategyMarker[], strategyId: string, strategyVersion?: string): StrategyMarker[] {
    return markers.filter((m) => m.strategyId === strategyId && (!strategyVersion || m.strategyVersion === strategyVersion));
}
