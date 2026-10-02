/**
 * GEX levels — chart-ready level extraction (walls + flip) from a GexResult.
 * Kept separate so the chart overlay and the AI context consume the same
 * level list without re-deriving anything.
 */

import type { GexResult } from "../types";

export interface GexLevel {
    kind: "call_wall" | "put_wall" | "gamma_flip";
    price: number;
    label: string;
    /** Relative gamma magnitude for renderer sizing. */
    magnitude: number;
}

/** Flatten a GexResult into chart-ready levels (respects display options). */
export function gexLevels(
    gex: GexResult | null,
    options?: { showWalls?: boolean; showGammaFlip?: boolean; maxPerSide?: number },
): GexLevel[] {
    if (!gex || gex.dataQuality === "INSUFFICIENT_HISTORY" || gex.dataQuality === "UNAVAILABLE") return [];
    const out: GexLevel[] = [];
    const max = options?.maxPerSide ?? 3;
    if (options?.showWalls !== false) {
        for (const w of gex.callWalls.slice(0, max)) {
            out.push({ kind: "call_wall", price: w.strike, label: `Call wall ${w.strike}`, magnitude: w.gamma });
        }
        for (const w of gex.putWalls.slice(0, max)) {
            out.push({ kind: "put_wall", price: w.strike, label: `Put wall ${w.strike}`, magnitude: w.gamma });
        }
    }
    if (options?.showGammaFlip !== false && gex.gammaFlip !== null) {
        out.push({ kind: "gamma_flip", price: gex.gammaFlip, label: `Gamma flip ${gex.gammaFlip}`, magnitude: Math.abs(gex.netGex) });
    }
    return out;
}
