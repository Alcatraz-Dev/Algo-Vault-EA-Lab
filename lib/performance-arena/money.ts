// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — deterministic money & price math.
//
// All balances, PnL and fees are persisted as INTEGER CENTS. All prices are
// persisted as INTEGER PRICE MICROS (price × 1e6) so 5-digit FX quotes and
// 2-digit metal quotes round-trip exactly. Sizes are INTEGER CENTI-LOTS
// (lots × 100).
//
// Every transition that crosses the integer boundary rounds EXACTLY ONCE,
// half away from zero. IEEE-754 double arithmetic is deterministic for the
// same inputs, so the same trade always produces the same PnL on every run —
// the arena never accumulates balances in floating point.
// ─────────────────────────────────────────────────────────────────────────────

export const MICRO = 1_000_000; // price → price-micros
export const CENTI_LOT = 100; // lots → centi-lots

/** Round a finite number to an integer, half away from zero (deterministic). */
export function roundHalfAwayFromZero(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const sign = value < 0 ? -1 : 1;
    const abs = Math.abs(value);
    const floor = Math.floor(abs);
    const frac = abs - floor;
    // Guard against binary-float artifacts (0.49999999999999994 etc.).
    const rounded = frac >= 0.5 ? floor + 1 : floor;
    return sign * rounded;
}

/** Dollars → integer cents. Rounds half away from zero. */
export function toCents(value: number): number {
    return roundHalfAwayFromZero(value * 100);
}

/** Integer cents → dollars (display only — never re-derive money from this). */
export function centsToNumber(cents: number): number {
    return cents / 100;
}

/** Price → integer price-micros. */
export function toPriceMicros(price: number): number {
    return roundHalfAwayFromZero(price * MICRO);
}

/** Integer price-micros → price number (display / fill maths input). */
export function priceMicrosToNumber(micros: number): number {
    return micros / MICRO;
}

/** Lots → integer centi-lots. Rejects non-positive sizes via null. */
export function toCentiLots(lots: number): number | null {
    if (!Number.isFinite(lots) || lots <= 0) return null;
    const cents = roundHalfAwayFromZero(lots * CENTI_LOT);
    return cents > 0 ? cents : null;
}

export function centiLotsToNumber(centiLots: number): number {
    return centiLots / CENTI_LOT;
}

/** Add two cent amounts (integers stay integers). */
export function addCents(a: number, b: number): number {
    return roundHalfAwayFromZero(a) + roundHalfAwayFromZero(b);
}

/** Percent of a cent amount, rounded once, half away from zero. */
export function pctOfCents(cents: number, pct: number): number {
    return roundHalfAwayFromZero((cents * pct) / 100);
}

/** cents as a percentage of base (returns pct with 4 decimals of precision). */
export function pctOf(baseCents: number, cents: number): number {
    if (baseCents === 0) return 0;
    return Math.round((cents / baseCents) * 1_000_000) / 10_000;
}

/**
 * Gross PnL in cents for a closed (or marked) position.
 *
 *   pnl = (exit − entry) × sizeLots × contractSize          (long)
 *   pnl = (entry − exit) × sizeLots × contractSize          (short)
 *
 * The product is computed once in double precision and rounded ONCE to
 * integer cents. Inputs are integer micros / centi-lots, so the same trade
 * always yields the same integer result.
 */
export function grossPnLCents(params: {
    side: "long" | "short";
    entryPriceMicros: number;
    exitPriceMicros: number;
    sizeCentiLots: number;
    contractSize: number;
}): number {
    const { side, entryPriceMicros, exitPriceMicros, sizeCentiLots, contractSize } = params;
    const priceDiff = (exitPriceMicros - entryPriceMicros) / MICRO; // price units
    const sizeLots = sizeCentiLots / CENTI_LOT;
    const signed = side === "long" ? priceDiff : -priceDiff;
    // priceDiff × lots × contractSize is CURRENCY; ×100 → integer cents.
    return roundHalfAwayFromZero(signed * sizeLots * contractSize * 100);
}

/** Round-trip trading costs in cents for one position (never negative). */
export function positionCostCents(params: {
    sizeCentiLots: number;
    contractSize: number;
    spreadPriceUnits: number;
    slippagePriceUnits: number;
    commissionPerLotCents: number;
}): number {
    const { sizeCentiLots, contractSize, spreadPriceUnits, slippagePriceUnits, commissionPerLotCents } = params;
    const sizeLots = sizeCentiLots / CENTI_LOT;
    // Spread/slippage are price units → currency → ×100 for cents.
    // Commission is already configured in cents per lot.
    const spreadCents = roundHalfAwayFromZero(spreadPriceUnits * sizeLots * contractSize * 100);
    const slippageCents = roundHalfAwayFromZero(slippagePriceUnits * 2 * sizeLots * contractSize * 100);
    const commissionCents = roundHalfAwayFromZero(commissionPerLotCents * sizeLots);
    return Math.max(0, spreadCents) + Math.max(0, slippageCents) + Math.max(0, commissionCents);
}

/**
 * Planned risk in cents for a stop-loss: distance × size × contractSize,
 * plus estimated round-trip costs. Used by the risk-per-trade rule and the
 * guardian's "this position would bring you close to the limit" message.
 */
export function plannedRiskCents(params: {
    side: "long" | "short";
    entryPriceMicros: number;
    stopLossMicros: number | null;
    sizeCentiLots: number;
    contractSize: number;
    costCents: number;
}): number | null {
    const { side, entryPriceMicros, stopLossMicros, sizeCentiLots, contractSize, costCents } = params;
    if (stopLossMicros === null) return null;
    const diff = Math.abs(entryPriceMicros - stopLossMicros) / MICRO;
    const sideOk = side === "long" ? stopLossMicros < entryPriceMicros : stopLossMicros > entryPriceMicros;
    if (!sideOk) return null; // stop on the wrong side — caller must reject
    const sizeLots = sizeCentiLots / CENTI_LOT;
    const risk = roundHalfAwayFromZero(diff * sizeLots * contractSize * 100);
    return Math.max(0, risk) + Math.max(0, costCents);
}

/** Notional exposure in cents: size × contractSize × price. */
export function notionalCents(params: {
    priceMicros: number;
    sizeCentiLots: number;
    contractSize: number;
}): number {
    const { priceMicros, sizeCentiLots, contractSize } = params;
    const price = priceMicros / MICRO;
    const sizeLots = sizeCentiLots / CENTI_LOT;
    return roundHalfAwayFromZero(price * sizeLots * contractSize * 100);
}

/** Format cents for display with an explicit sign (terminal style). */
export function formatCents(cents: number, currency = "$"): string {
    const value = cents / 100;
    const sign = value < 0 ? "-" : "";
    const abs = Math.abs(value);
    return `${sign}${currency}${abs.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}
