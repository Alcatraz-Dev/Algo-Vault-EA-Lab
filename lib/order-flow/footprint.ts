/**
 * Footprint engine — bid × ask volume per price level, per bar.
 *
 * Requires bid/ask-classified trades. Trades are grouped into candle bars by
 * their timestamp (bucketed to the timeframe) and into price cells inside each
 * bar. From the cells we derive bar delta, total volume and per-bar imbalance
 * events (see imbalance.ts for the shared event construction).
 *
 * Honesty: there is no footprint without classified trades — candles are never
 * converted into fake footprint cells.
 */

import type { Timeframe } from "@/lib/market-data/types";
import type {
    FootprintBar,
    FootprintCell,
    FootprintResult,
    ImbalanceEvent,
    OrderFlowMode,
    OrderFlowTrade,
} from "./types";

export interface FootprintOptions {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    /** Approximate price cells per bar (footprint density). Default 8. */
    density?: number;
}

const TF_BUCKET_MS: Record<string, number> = {
    M1: 60_000, M3: 180_000, M5: 300_000, M15: 900_000,
    M30: 1_800_000, H1: 3_600_000, H4: 14_400_000, D1: 86_400_000,
};

/** Build a footprint over chronological classified trades. */
export function computeFootprint(trades: readonly OrderFlowTrade[], options: FootprintOptions): FootprintResult {
    const empty: FootprintResult = {
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: options.mode,
        bars: [],
        dataQuality: "UNAVAILABLE",
        method: "classified-trades",
    };
    if (!trades || trades.length === 0) return empty;

    const bucketMs = TF_BUCKET_MS[options.timeframe] ?? 300_000;
    const density = Math.max(2, Math.min(40, Math.round(options.density ?? 8)));

    // Group trades into bars.
    const barMap = new Map<number, OrderFlowTrade[]>();
    for (const t of trades) {
        const key = Math.floor(t.timestamp / bucketMs) * bucketMs;
        const arr = barMap.get(key);
        if (arr) arr.push(t);
        else barMap.set(key, [t]);
    }

    const bars: FootprintBar[] = [];
    for (const [ts, barTrades] of [...barMap.entries()].sort((a, b) => a[0] - b[0])) {
        const high = Math.max(...barTrades.map((t) => t.price));
        const low = Math.min(...barTrades.map((t) => t.price));
        const cellSize = Math.max((high - low) / density, Number.MIN_VALUE);

        const cellMap = new Map<number, FootprintCell>();
        for (const t of barTrades) {
            const idx = Math.min(density - 1, Math.floor((t.price - low) / cellSize));
            const price = low + (idx + 0.5) * cellSize;
            let cell = cellMap.get(price);
            if (!cell) {
                cell = { price, bidVolume: 0, askVolume: 0, delta: 0, totalVolume: 0 };
                cellMap.set(price, cell);
            }
            if (t.side === "buy") cell.askVolume += t.size;
            else cell.bidVolume += t.size;
        }

        const cells = [...cellMap.values()].sort((a, b) => a.price - b.price);
        let barBuy = 0;
        let barSell = 0;
        for (const c of cells) {
            c.delta = c.askVolume - c.bidVolume;
            c.totalVolume = c.askVolume + c.bidVolume;
            barBuy += c.askVolume;
            barSell += c.bidVolume;
        }

        bars.push({
            timestamp: ts,
            high,
            low,
            cells,
            delta: barBuy - barSell,
            totalVolume: barBuy + barSell,
            imbalances: detectCellImbalances(cells, {
                symbol: options.symbol,
                timeframe: options.timeframe,
                mode: options.mode,
                method: "classified-trades",
                quality: "HIGH",
                timestamp: ts,
            }),
        });
    }

    return {
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: options.mode,
        bars,
        dataQuality: "HIGH",
        method: "classified-trades",
    };
}

/**
 * Detect per-cell imbalances (buy/sell dominance) across a bar's cells.
 * Stacked imbalance is detected across CONSECUTIVE price cells within a bar
 * (the classic stacked-imbalance definition); diagonal imbalance is detected
 * by `detectDiagonalImbalances` across bars.
 */
export function detectCellImbalances(
    cells: readonly FootprintCell[],
    meta: { symbol: string; timeframe: Timeframe; mode: OrderFlowMode; method: string; quality: "HIGH" | "PARTIAL"; timestamp: number },
    threshold = 3,
    stackedLevels = 3,
): ImbalanceEvent[] {
    const events: ImbalanceEvent[] = [];
    if (cells.length === 0) return events;

    // Per-cell dominance: ask ≥ ratio × bid → BUY_IMBALANCE, mirrored for sell.
    // One-sided cells (bid = 0, ask > 0) are dominant by definition.
    const dominant: Array<"buy" | "sell" | null> = cells.map((c) => {
        if (c.askVolume > 0 && (c.bidVolume <= 0 || c.askVolume >= threshold * c.bidVolume)) return "buy";
        if (c.bidVolume > 0 && (c.askVolume <= 0 || c.bidVolume >= threshold * c.askVolume)) return "sell";
        return null;
    });

    // Stacked runs of dominant cells (consecutive price levels).
    let runStart = -1;
    let runSide: "buy" | "sell" | null = null;
    const flush = (endIdx: number) => {
        if (runSide && endIdx - runStart + 1 >= stackedLevels) {
            events.push({
                id: `imb_STACKED_${runSide.toUpperCase()}_${meta.symbol}_${meta.timeframe}_${meta.timestamp}_${cells[runStart].price}`,
                timestamp: meta.timestamp,
                symbol: meta.symbol,
                timeframe: meta.timeframe,
                mode: meta.mode,
                method: meta.method,
                quality: meta.quality,
                type: runSide === "buy" ? "STACKED_BUY_IMBALANCE" : "STACKED_SELL_IMBALANCE",
                priceStart: cells[runStart].price,
                priceEnd: cells[endIdx].price,
                ratio: cells.slice(runStart, endIdx + 1).reduce((s, c) => s + c.totalVolume, 0) > 0
                    ? cells.slice(runStart, endIdx + 1).reduce((s, c) => s + c.delta, 0) /
                      Math.max(1, cells.slice(runStart, endIdx + 1).reduce((s, c) => s + c.totalVolume, 0))
                    : 0,
                levels: endIdx - runStart + 1,
                buyVolume: cells.slice(runStart, endIdx + 1).reduce((s, c) => s + c.askVolume, 0),
                sellVolume: cells.slice(runStart, endIdx + 1).reduce((s, c) => s + c.bidVolume, 0),
            });
        }
        runStart = -1;
        runSide = null;
    };
    for (let i = 0; i < cells.length; i++) {
        const side = dominant[i];
        if (side && side === runSide) {
            // extend run
        } else {
            if (runSide !== null) flush(i - 1);
            if (side) {
                runStart = i;
                runSide = side;
            } else {
                runStart = -1;
                runSide = null;
            }
        }
    }
    if (runSide !== null) flush(cells.length - 1);

    // Single-cell (non-stacked) imbalances for completeness.
    for (let i = 0; i < cells.length; i++) {
        const side = dominant[i];
        if (!side) continue;
        const inStacked = events.some((e) => (e.type === "STACKED_BUY_IMBALANCE" || e.type === "STACKED_SELL_IMBALANCE") && cells[i].price >= e.priceStart && cells[i].price <= e.priceEnd);
        if (inStacked) continue;
        const c = cells[i];
        events.push({
            id: `imb_${side.toUpperCase()}_${meta.symbol}_${meta.timeframe}_${meta.timestamp}_${c.price}`,
            timestamp: meta.timestamp,
            symbol: meta.symbol,
            timeframe: meta.timeframe,
            mode: meta.mode,
            method: meta.method,
            quality: meta.quality,
            type: side === "buy" ? "BUY_IMBALANCE" : "SELL_IMBALANCE",
            priceStart: c.price,
            priceEnd: c.price,
            ratio: c.bidVolume > 0 && c.askVolume > 0 ? Math.max(c.askVolume / c.bidVolume, c.bidVolume / c.askVolume) : threshold,
            levels: 1,
            buyVolume: c.askVolume,
            sellVolume: c.bidVolume,
        });
    }

    return events;
}

/**
 * Diagonal imbalance: a diagonal of dominant cells across two consecutive
 * bars (cell i in bar A dominant buy AND cell i+1 in bar B dominant buy at a
 * higher price → diagonal buy). Documented approximation of the concept.
 */
export function detectDiagonalImbalances(
    prevBar: FootprintBar | null,
    currBar: FootprintBar,
    meta: { symbol: string; timeframe: Timeframe; mode: OrderFlowMode; method: string; quality: "HIGH" | "PARTIAL" },
    threshold = 3,
): ImbalanceEvent[] {
    const events: ImbalanceEvent[] = [];
    if (!prevBar) return events;

    const dominantOf = (cells: readonly FootprintCell[]): Array<"buy" | "sell" | null> =>
        cells.map((c) => {
            if (c.askVolume > 0 && (c.bidVolume <= 0 || c.askVolume >= threshold * c.bidVolume)) return "buy";
            if (c.bidVolume > 0 && (c.askVolume <= 0 || c.bidVolume >= threshold * c.askVolume)) return "sell";
            return null;
        });

    const prevDom = dominantOf(prevBar.cells);
    const currDom = dominantOf(currBar.cells);
    for (let i = 0; i < prevDom.length; i++) {
        const side = prevDom[i];
        if (!side) continue;
        const next = currDom[i + 1] ?? currDom[i];
        if (!next || next !== side) continue;
        const pCell = prevBar.cells[i];
        if (!pCell) continue;
        const cCell = currBar.cells[Math.min(i + 1, currBar.cells.length - 1)];
        if (!cCell) continue;
        const diagonalUp = cCell.price > pCell.price;
        if (side === "buy" && !diagonalUp) continue;
        if (side === "sell" && diagonalUp) continue;
        events.push({
            id: `imb_DIAG_${side.toUpperCase()}_${meta.symbol}_${meta.timeframe}_${currBar.timestamp}_${pCell.price}`,
            timestamp: currBar.timestamp,
            symbol: meta.symbol,
            timeframe: meta.timeframe,
            mode: meta.mode,
            method: meta.method,
            quality: meta.quality,
            type: side === "buy" ? "DIAGONAL_BUY_IMBALANCE" : "DIAGONAL_SELL_IMBALANCE",
            priceStart: pCell.price,
            priceEnd: cCell.price,
            ratio: threshold,
            levels: 2,
            buyVolume: pCell.askVolume + cCell.askVolume,
            sellVolume: pCell.bidVolume + cCell.bidVolume,
        });
    }
    return events;
}
