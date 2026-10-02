/**
 * Net Gamma Exposure (GEX) — isolated capability module.
 *
 * Inputs are validated options quotes (strike, expiry, OI, IV, gamma when the
 * provider supplies it). Nothing is ever fabricated: with no options provider
 * the calculator returns an explicit UNAVAILABLE result and the UI/AI must
 * present it as such.
 *
 * Methodology (documented, deterministic):
 *  • Provider gamma (per contract) when available, else Black–Scholes gamma
 *    computed from strike/expiry/IV/spot.
 *  • Contract gamma exposure = gamma × OI × 100 (standard contract multiplier)
 *    × spot² / 100 → dollar gamma per 1% move. Dealers assumed LONG options
 *    they sold is NOT assumed here: the classic convention treats dealer
 *    positioning as short customer buying — net GEX sign convention documented
 *    as: call GEX positive, put GEX negative, net = call − put.
 *  • Gamma flip: the spot level where cumulative net GEX crosses zero when
 *    strikes are scanned as a ladder (computed by shifting spot through the
 *    strike range).
 */

import type { GexExpirationBreakdown, GexResult, GammaWall, OptionQuote, OrderFlowMode } from "../types";
import { validateOptionChain } from "../validation";

export interface GexOptions {
    underlying: string;
    mode?: OrderFlowMode;
    /** Max expiries included (nearest-first). Default 3. */
    expirationsLimit?: number;
    /** Contract multiplier. Default 100. */
    contractMultiplier?: number;
}

/** Standard normal PDF. */
function npdf(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Black–Scholes gamma for a European option. */
export function blackScholesGamma(spot: number, strike: number, iv: number, yearsToExpiry: number): number {
    if (spot <= 0 || strike <= 0 || iv <= 0 || yearsToExpiry <= 0) return 0;
    const sqrtT = Math.sqrt(yearsToExpiry);
    const d1 = (Math.log(spot / strike) + 0.5 * iv * iv * yearsToExpiry) / (iv * sqrtT);
    return npdf(d1) / (spot * iv * sqrtT);
}

const DAY_MS = 86_400_000;

/** Years to expiry (min 0.5 day so same-week chains stay meaningful). */
function yearsToExpiry(expirationMs: number, nowMs: number): number {
    return Math.max(0.5 / 365, (expirationMs - nowMs) / (365 * DAY_MS));
}

/**
 * Compute net GEX from a validated quote list. Returns dataQuality
 * INSUFFICIENT_HISTORY when the chain is empty after validation.
 */
export function computeGex(quotes: readonly OptionQuote[], options: GexOptions, nowMs = Date.now()): GexResult {
    const empty: GexResult = {
        underlying: options.underlying,
        timestamp: nowMs,
        mode: options.mode ?? "live",
        spot: 0,
        netGex: 0,
        callGex: 0,
        putGex: 0,
        gammaFlip: null,
        callWalls: [],
        putWalls: [],
        expirations: [],
        dataQuality: "INSUFFICIENT_HISTORY",
        method: "black-scholes-gex",
    };

    const { quotes: valid } = validateOptionChain(quotes as unknown[], nowMs);
    if (valid.length === 0) return empty;

    const limit = Math.max(1, Math.round(options.expirationsLimit ?? 3));
    const multiplier = options.contractMultiplier ?? 100;
    const spot = valid[0].underlyingPrice;

    // Keep the nearest `limit` expiries.
    const expiries = [...new Set(valid.map((q) => q.expiration))].sort((a, b) => a - b).slice(0, limit);
    const kept = valid.filter((q) => expiries.includes(q.expiration));

    let callGex = 0;
    let putGex = 0;
    const callByStrike = new Map<number, GammaWall>();
    const putByStrike = new Map<number, GammaWall>();
    const expBreakdown = new Map<number, GexExpirationBreakdown>();

    for (const q of kept) {
        const gamma = typeof q.gamma === "number" && q.gamma > 0
            ? q.gamma
            : blackScholesGamma(q.underlyingPrice, q.strike, q.impliedVolatility, yearsToExpiry(q.expiration, nowMs));
        // Dollar gamma per 1% move: gamma × OI × multiplier × spot² × 0.01.
        const gex = gamma * q.openInterest * multiplier * q.underlyingPrice * q.underlyingPrice * 0.01;
        if (q.type === "call") {
            callGex += gex;
            const prev = callByStrike.get(q.strike);
            if (prev) prev.gamma += gex;
            else callByStrike.set(q.strike, { strike: q.strike, gamma: gex, openInterest: q.openInterest });
        } else {
            putGex += gex;
            const prev = putByStrike.get(q.strike);
            if (prev) prev.gamma += gex;
            else putByStrike.set(q.strike, { strike: q.strike, gamma: gex, openInterest: q.openInterest });
        }
        const exp = expBreakdown.get(q.expiration) ?? { expiration: q.expiration, callGex: 0, putGex: 0, netGex: 0 };
        if (q.type === "call") exp.callGex += gex;
        else exp.putGex += gex;
        exp.netGex = exp.callGex - exp.putGex;
        expBreakdown.set(q.expiration, exp);
    }

    const netGex = callGex - putGex;

    // Walls: top-3 strikes by gamma exposure on each side.
    const topWalls = (m: Map<number, GammaWall>): GammaWall[] =>
        [...m.values()].sort((a, b) => b.gamma - a.gamma).slice(0, 3);
    const callWalls = topWalls(callByStrike);
    const putWalls = topWalls(putByStrike);

    // Gamma flip: find the strike ladder position where cumulative net GEX
    // (integrated from low strikes upward) crosses zero.
    const strikes = [...new Set(kept.map((q) => q.strike))].sort((a, b) => a - b);
    let gammaFlip: number | null = null;
    let cumulative = 0;
    for (const strike of strikes) {
        const callG = callByStrike.get(strike)?.gamma ?? 0;
        const putG = putByStrike.get(strike)?.gamma ?? 0;
        cumulative += callG - putG;
        if (gammaFlip === null && cumulative > 0) {
            gammaFlip = strike;
            break;
        }
    }

    return {
        underlying: options.underlying,
        timestamp: nowMs,
        mode: options.mode ?? "live",
        spot,
        netGex,
        callGex,
        putGex,
        gammaFlip,
        callWalls,
        putWalls,
        expirations: [...expBreakdown.values()].sort((a, b) => a.expiration - b.expiration),
        dataQuality: "HIGH",
        method: typeof valid[0].gamma === "number" && valid[0].gamma > 0 ? "provider-gamma" : "black-scholes-gex",
    };
}
