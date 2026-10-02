/**
 * Imbalance helpers — shared ratio utilities for footprint/imbalance code.
 * Kept separate so both the footprint engine and the chart overlay produce
 * identical numbers from identical cells (single source of truth).
 */

import type { FootprintCell } from "./types";

/**
 * Ratio of dominant side over weaker side for a cell (ask/bid or bid/ask).
 * Returns 0 when the weaker side is 0 and the stronger is 0 too.
 */
export function cellImbalanceRatio(cell: FootprintCell): number {
    const { bidVolume: bid, askVolume: ask } = cell;
    if (bid <= 0 && ask <= 0) return 0;
    if (bid <= 0) return ask > 0 ? Infinity : 0;
    if (ask <= 0) return Infinity;
    return Math.max(ask / bid, bid / ask);
}

/**
 * Dominant side of a cell at a given ratio threshold (null when balanced).
 * A one-sided cell (ask > 0, bid = 0) is maximally dominant — with enough
 * absolute volume this is exactly how real one-sided prints behave.
 */
export function dominantSide(cell: FootprintCell, threshold = 3, minVolume = 1): "buy" | "sell" | null {
    if (cell.askVolume >= minVolume && (cell.bidVolume <= 0 || cell.askVolume / cell.bidVolume >= threshold)) return "buy";
    if (cell.bidVolume >= minVolume && (cell.askVolume <= 0 || cell.bidVolume / cell.askVolume >= threshold)) return "sell";
    return null;
}
