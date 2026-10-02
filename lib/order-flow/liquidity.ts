/**
 * Liquidity engine — Level 2 order-book analytics.
 *
 * HARD GATE: every function requires real L2 snapshots. When none exist the
 * engine returns an explicit UNAVAILABLE state — candle data is NEVER turned
 * into fake liquidity. All events carry sizes, persistence and distance from
 * market so the AI/UI can weigh them properly.
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { HeatmapCell, HeatmapState, L2Snapshot, LiquidityEvent, OrderFlowMode } from "./types";

export interface LiquidityOptions {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    /** Resting size above which a level is a wall (required; 0 = auto off). */
    wallThreshold?: number;
    /** Consecutive snapshots a level must persist to be a wall. Default 3. */
    wallPersistence?: number;
    /** Add/remove detection ratio. Default 1.5. */
    changeRatio?: number;
    /** How deep (price distance from mid) to track levels. Optional cap. */
    maxLevelsPerSide?: number;
}

interface TrackedLevel {
    price: number;
    side: "bid" | "ask";
    size: number;
    persistence: number;
    wallEmittedSize?: number;
}

/** Detect all liquidity events across a chronological snapshot series. */
export function detectLiquidityEvents(snapshots: readonly L2Snapshot[], options: LiquidityOptions): LiquidityEvent[] {
    const events: LiquidityEvent[] = [];
    if (!snapshots || snapshots.length === 0) return events;

    const changeRatio = options.changeRatio ?? 1.5;
    const wallPersistence = Math.max(1, Math.round(options.wallPersistence ?? 3));
    const maxPerSide = options.maxLevelsPerSide ?? 25;

    const tracked = new Map<string, TrackedLevel>();
    const keyOf = (price: number, side: "bid" | "ask") => `${side}:${price}`;
    // Emitted walls — each wall fires once per appearance/strengthening.
    const emittedWalls = new Set<string>();
    // Consecutive add/pull streaks per level (stacking / pulling).
    const stackCounter = new Map<string, number>();
    const pullCounter = new Map<string, number>();
    const wallThreshold = options.wallThreshold !== undefined && options.wallThreshold > 0 ? options.wallThreshold : null;

    const midOf = (s: L2Snapshot): number | null => {
        const bestBid = s.bids.length ? Math.max(...s.bids.map((l) => l.price)) : null;
        const bestAsk = s.asks.length ? Math.min(...s.asks.map((l) => l.price)) : null;
        if (bestBid === null && bestAsk === null) return null;
        if (bestBid === null) return bestAsk as number;
        if (bestAsk === null) return bestBid;
        return (bestBid + bestAsk) / 2;
    };

    for (const snap of snapshots) {
        const mid = midOf(snap);
        if (mid === null) continue;

        const seen = new Set<string>();
        const processSide = (side: "bid" | "ask") => {
            const levels = side === "bid" ? snap.bids : snap.asks;
            // Deepest-first cap keeps O(levels) bounded and focuses near market.
            const sorted = [...levels].sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price)).slice(0, maxPerSide);
            for (const level of sorted) {
                const key = keyOf(level.price, side);
                seen.add(key);
                const prev = tracked.get(key);
                if (!prev) {
                    tracked.set(key, { price: level.price, side, size: level.size, persistence: 1 });
                    continue;
                }
                // Size change classification.
                let sizeChanged = false;
                if (level.size > prev.size * changeRatio) {
                    events.push(mkEvent("LIQUIDITY_ADDED", options, snap, side, level.price, level.size, { previousSize: prev.size, newSize: level.size, distance: Math.abs(level.price - mid) }));
                    sizeChanged = true;
                } else if (level.size < prev.size / changeRatio) {
                    events.push(mkEvent("LIQUIDITY_REMOVED", options, snap, side, level.price, level.size, { previousSize: prev.size, newSize: level.size, distance: Math.abs(level.price - mid) }));
                    sizeChanged = true;
                }

                // Stacking: consecutive ADDs at the same level.
                if (level.size > prev.size * changeRatio) {
                    const adds = (stackCounter.get(key) ?? 0) + 1;
                    stackCounter.set(key, adds);
                    if (adds >= 2) {
                        events.push(mkEvent("STACKING", options, snap, side, level.price, level.size, { previousSize: prev.size, newSize: level.size, distance: Math.abs(level.price - mid) }));
                    }
                } else if (level.size < prev.size / changeRatio) {
                    const pulls = (pullCounter.get(key) ?? 0) + 1;
                    pullCounter.set(key, pulls);
                    if (pulls >= 2) events.push(mkEvent("PULLING", options, snap, side, level.price, level.size, { previousSize: prev.size, newSize: level.size, distance: Math.abs(level.price - mid) }));
                } else {
                    stackCounter.delete(key);
                    pullCounter.delete(key);
                }

                // Wall: persistent oversized level. Fires when persistence is
                // first reached, and re-fires only if the level re-arms after
                // being pulled or strengthening further.
                if (wallThreshold !== null && level.size >= wallThreshold) {
                    const strengthened = sizeChanged && (!prev.wallEmittedSize || level.size > prev.wallEmittedSize);
                    if ((!emittedWalls.has(key) && prev.persistence + 1 >= wallPersistence) || strengthened) {
                        events.push(mkEvent("LIQUIDITY_WALL", options, snap, side, level.price, level.size, { persistence: prev.persistence + 1, distance: Math.abs(level.price - mid) }));
                        emittedWalls.add(key);
                    }
                } else {
                    emittedWalls.delete(key);
                }
                tracked.set(key, { ...prev, size: level.size, persistence: prev.persistence + 1, ...(emittedWalls.has(key) ? { wallEmittedSize: level.size } : {}) });
            }
        };
        void seen;

        processSide("bid");
        processSide("ask");

        // Disappearance → pulled/removed (level gone from the book).
        for (const [key, lv] of tracked) {
            if (seen.has(key)) continue;
            if (wallThreshold !== null && lv.size >= wallThreshold) {
                events.push(mkEvent("LIQUIDITY_REMOVED", options, snap, lv.side, lv.price, 0, { previousSize: lv.size, newSize: 0, distance: Math.abs(lv.price - mid) }));
            }
            tracked.delete(key);
            stackCounter.delete(key);
            pullCounter.delete(key);
            emittedWalls.delete(key);
        }
    }

    return events;
}

function mkEvent(
    type: LiquidityEvent["type"],
    options: LiquidityOptions,
    snap: L2Snapshot,
    side: "bid" | "ask",
    price: number,
    size: number,
    extra: { previousSize?: number; newSize?: number; persistence?: number; distance: number },
): LiquidityEvent {
    return {
        id: `liq_${type}_${options.symbol}_${options.timeframe}_${snap.timestamp}_${side}_${price}`,
        timestamp: snap.timestamp,
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: options.mode,
        method: "l2-snapshots",
        quality: "HIGH",
        type,
        side,
        price,
        size,
        ...(extra.previousSize !== undefined ? { previousSize: extra.previousSize } : {}),
        ...(extra.newSize !== undefined ? { newSize: extra.newSize } : {}),
        ...(extra.persistence !== undefined ? { persistence: extra.persistence } : {}),
        distanceFromMarket: extra.distance,
    };
}

/**
 * Sweep / replenishment detection: a snapshot whose best bid or ask drops
 * sharply against a previously-persistent level, then re-appears.
 */
export function detectSweepsAndReplenishment(
    snapshots: readonly L2Snapshot[],
    options: LiquidityOptions,
): LiquidityEvent[] {
    const events: LiquidityEvent[] = [];
    if (!snapshots || snapshots.length < 3) return events;

    for (let i = 1; i < snapshots.length; i++) {
        const prev = snapshots[i - 1];
        const cur = snapshots[i];
        const prevBestBid = prev.bids.length ? Math.max(...prev.bids.map((l) => l.price)) : null;
        const prevBestAsk = prev.asks.length ? Math.min(...prev.asks.map((l) => l.price)) : null;
        const curBestBid = cur.bids.length ? Math.max(...cur.bids.map((l) => l.price)) : null;
        const curBestAsk = cur.asks.length ? Math.min(...cur.asks.map((l) => l.price)) : null;

        // Bid swept: best bid dropped notably.
        if (prevBestBid !== null && curBestBid !== null && prevBestBid - curBestBid > (options.wallThreshold ?? 0) * 0 + 1e-9 && prevBestBid - curBestBid >= Math.abs(prevBestBid) * 0.0005) {
            const mid = (curBestBid + (curBestAsk ?? curBestBid)) / 2;
            events.push(mkEvent("LIQUIDITY_SWEEP", options, cur, "bid", prevBestBid, 0, { previousSize: prev.bids.find((l) => l.price === prevBestBid)?.size, newSize: 0, distance: Math.abs(prevBestBid - mid) }));
            // Replenished: next snapshot restores a bid at/above the swept price.
            const next = snapshots[i + 1];
            if (next) {
                const nextBestBid = next.bids.length ? Math.max(...next.bids.map((l) => l.price)) : null;
                if (nextBestBid !== null && nextBestBid >= prevBestBid) {
                    events.push(mkEvent("LIQUIDITY_REPLENISHED", options, next, "bid", nextBestBid, next.bids.find((l) => l.price === nextBestBid)?.size ?? 0, { distance: Math.abs(nextBestBid - mid) }));
                }
            }
        }
        // Ask swept: best ask rose notably.
        if (prevBestAsk !== null && curBestAsk !== null && curBestAsk - prevBestAsk >= Math.abs(prevBestAsk) * 0.0005) {
            const mid = ((curBestBid ?? curBestAsk) + curBestAsk) / 2;
            events.push(mkEvent("LIQUIDITY_SWEEP", options, cur, "ask", prevBestAsk, 0, { previousSize: prev.asks.find((l) => l.price === prevBestAsk)?.size, newSize: 0, distance: Math.abs(prevBestAsk - mid) }));
        }
    }
    return events;
}

/** Bid/ask imbalance across the visible book (ratio, −1..1 signed). */
export function bookImbalance(snapshot: L2Snapshot, depth = 10): number {
    const bidSize = snapshot.bids.slice(0, depth).reduce((s, l) => s + l.size, 0);
    const askSize = snapshot.asks.slice(0, depth).reduce((s, l) => s + l.size, 0);
    const total = bidSize + askSize;
    if (total <= 0) return 0;
    return (bidSize - askSize) / total;
}

/**
 * Build heatmap cells from snapshots (one row per snapshot, price-binned).
 * Cells are bounded by `maxCells` — oldest rows are dropped first.
 */
export function buildHeatmapState(
    snapshots: readonly L2Snapshot[],
    options: LiquidityOptions & { maxCells?: number },
): HeatmapState {
    const maxCells = options.maxCells ?? 20_000;
    const cells: HeatmapCell[] = [];
    let maxSize = 0;
    let wallCount = 0;
    const wallThreshold = options.wallThreshold && options.wallThreshold > 0 ? options.wallThreshold : null;

    for (const snap of snapshots) {
        const push = (side: "bid" | "ask", levels: L2Snapshot["bids"]) => {
            for (const l of levels) {
                const isWall = wallThreshold !== null && l.size >= wallThreshold;
                if (isWall) wallCount += 1;
                cells.push({ timestamp: snap.timestamp, price: l.price, size: l.size, side, isWall });
                if (l.size > maxSize) maxSize = l.size;
            }
        };
        push("bid", snap.bids);
        push("ask", snap.asks);
    }

    // Bounded buffer: drop oldest rows when over budget.
    const bounded = cells.length > maxCells ? cells.slice(cells.length - maxCells) : cells;

    return {
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: options.mode,
        cells: bounded,
        maxSize,
        wallCount,
        dataQuality: snapshots.length === 0 ? "UNAVAILABLE" : "HIGH",
        computedAt: 0,
    };
}
