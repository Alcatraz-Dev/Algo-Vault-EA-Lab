// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — partial-close planning (pure, deterministic).
//
// ONE engine for both partial-close modes, so the preview a trader confirms
// is produced by exactly the same arithmetic that settles the close.
//
//   Mode A — VOLUME_PARTIAL
//     "close 50% of the position" → close 50% of the remaining quantity.
//     The realized P&L is whatever that quantity is worth at the executable
//     price. This is the pre-existing platform semantic, unchanged.
//
//   Mode B — PROFIT_PRESERVATION
//     "lock 50% of the current profit" → solve for the quantity whose ACTUAL
//     expected net realized P&L equals 50% of the position's current net
//     unrealized P&L, then snap it to the tradable lot grid.
//
// Both modes are the same solve with a different target quantity:
//
//     volume mode  → target quantity  = pct(position size)
//     profit mode  → target quantity  = targetCents / netCentsPerCentiLot
//
// This module is pure: it never reads RTDB, never resolves a quote and never
// writes an account. The service layer supplies a server-resolved quote and
// executes the returned plan through the single netting path (reduceExposure).
//
// All money is integer cents and all sizes integer centi-lots, and every
// crossing of the integer boundary rounds exactly once — so the same inputs
// always produce the same plan.
// ─────────────────────────────────────────────────────────────────────────────

import {
    CENTI_LOT,
    centiLotsToNumber,
    grossPnLCents,
    pctOfCents,
    roundHalfAwayFromZero,
    toPriceMicros,
} from "./money";
import type { ArenaSymbolSpec } from "./execution";
import type { ChallengeTrade, TradeCloseType, TradeFillCosts } from "./types";

export type PartialCloseMode = "VOLUME" | "PROFIT_PRESERVATION";

/** Server-resolved quote. The caller guarantees freshness before planning. */
export interface PartialCloseQuote {
    price: number;
    timestamp: number;
}

/** A closed slice of a trade, priced at the executable quote. */
export interface SlicePnl {
    /** Gross P&L of the slice before any cost. */
    grossCents: number;
    /** Pro-rata round-trip costs charged to the slice. */
    costCents: number;
    /** Net realized P&L for the slice (gross − cost). */
    netCents: number;
    exitPriceMicros: number;
}

// ──────────── Canonical cost splitting ───────────────────────────────────────

/**
 * Split a trade's round-trip costs between a closed slice and the remainder.
 *
 * Costs are charged once, round-trip, at entry. A partial close therefore
 * splits them pro-rata and hands the residual to the surviving trade, so the
 * slices of a position always sum back to the original gross P&L and cost.
 *
 * Canonical home for this math — the netting engine imports it from here so
 * preview and execution can never disagree about who paid what.
 */
export function splitTradeCosts(
    costs: TradeFillCosts,
    closeCentiLots: number,
    totalCentiLots: number
): { closed: TradeFillCosts; remaining: TradeFillCosts } {
    if (closeCentiLots >= totalCentiLots) {
        return { closed: costs, remaining: { spreadCostCents: 0, slippageCostCents: 0, commissionCents: 0 } };
    }
    const share = (value: number) => roundHalfAwayFromZero((value * closeCentiLots) / totalCentiLots);
    const closed = {
        spreadCostCents: share(costs.spreadCostCents),
        slippageCostCents: share(costs.slippageCostCents),
        commissionCents: share(costs.commissionCents),
    };
    return {
        closed,
        remaining: {
            spreadCostCents: costs.spreadCostCents - closed.spreadCostCents,
            slippageCostCents: costs.slippageCostCents - closed.slippageCostCents,
            commissionCents: costs.commissionCents - closed.commissionCents,
        },
    };
}

export function totalCostCentsOf(costs: TradeFillCosts): number {
    return Math.max(0, costs.spreadCostCents + costs.slippageCostCents + costs.commissionCents);
}

// ──────────── Canonical slice P&L ────────────────────────────────────────────

/**
 * Net P&L that closing `closeCentiLots` of `trade` would realize at
 * `quotePrice`. This mirrors the netting engine's settlement arithmetic
 * exactly (gross on the slice, minus the slice's pro-rata costs) and is the
 * single definition used by both the preview and the execution path.
 */
export function slicePnlAt(
    trade: ChallengeTrade,
    spec: Pick<ArenaSymbolSpec, "contractSize">,
    quotePrice: number,
    closeCentiLots: number
): SlicePnl {
    const exitPriceMicros = toPriceMicros(quotePrice);
    const grossCents = grossPnLCents({
        side: trade.side,
        entryPriceMicros: trade.entryPriceMicros,
        exitPriceMicros,
        sizeCentiLots: closeCentiLots,
        contractSize: spec.contractSize,
    });
    const { closed } = splitTradeCosts(trade.costs, closeCentiLots, trade.sizeCentiLots);
    return { grossCents, costCents: totalCostCentsOf(closed), netCents: grossCents - totalCostCentsOf(closed), exitPriceMicros };
}

/** Current net unrealized P&L of the whole open position (costs included). */
export function positionNetPnl(
    trade: ChallengeTrade,
    spec: Pick<ArenaSymbolSpec, "contractSize">,
    quotePrice: number
): SlicePnl {
    return slicePnlAt(trade, spec, quotePrice, trade.sizeCentiLots);
}

// ──────────── Lot-grid helpers ───────────────────────────────────────────────

/** Smallest tradable increment in centi-lots (never below 1). */
export function stepOf(stepLots: number): number {
    return Math.max(1, roundHalfAwayFromZero(stepLots * CENTI_LOT));
}

/** Snap DOWN to the tradable grid so a partial close is always executable. */
export function snapDownToStep(centiLots: number, stepCentiLots: number): number {
    if (stepCentiLots <= 1) return Math.max(0, roundHalfAwayFromZero(centiLots));
    return Math.max(0, Math.floor(centiLots / stepCentiLots) * stepCentiLots);
}

// ──────────── Mode A — volume partial close ──────────────────────────────────

/**
 * Resolve a volume-based close to centi-lots.
 *
 * Preserves the platform's established semantics verbatim (including the
 * min-step floor and the percent re-clamp) so existing behaviour is unchanged;
 * it is centralised here only so the preview and the settlement share one
 * implementation.
 */
export function resolveVolumeCloseCentiLots(params: {
    trade: ChallengeTrade;
    stepCentiLots: number;
    lots?: number | null;
    percent?: number | null;
}): { closeCentiLots: number } | { error: string } {
    const { trade, stepCentiLots } = params;
    const step = Math.max(1, stepCentiLots);
    const positionCentiLots = trade.sizeCentiLots;

    // No size requested → close the whole position.
    if (params.lots == null && params.percent == null) return { closeCentiLots: positionCentiLots };

    const requestedCentiLots =
        params.lots != null
            ? Math.round(params.lots * CENTI_LOT)
            : Math.round((positionCentiLots * (params.percent as number)) / 100);

    if (!Number.isSafeInteger(requestedCentiLots) || requestedCentiLots <= 0) {
        return { error: "Close size must be a positive number of lots or percent." };
    }

    // Snap DOWN to the lot grid so a partial close is always tradable, and
    // never exceed the position.
    let closeCentiLots = Math.min(
        positionCentiLots,
        Math.max(step, snapDownToStep(requestedCentiLots, step))
    );

    // Guard: percent-based close must not exceed position after grid snap.
    if (params.percent != null && params.percent > 0) {
        const maxFromPercent = snapDownToStep((positionCentiLots * params.percent) / 100, step);
        closeCentiLots = Math.min(closeCentiLots, maxFromPercent, positionCentiLots);
    }

    if (closeCentiLots <= 0) return { error: "Close size resolves below the tradable lot step." };
    return { closeCentiLots };
}

// ──────────── Mode B — profit-preservation partial close ──────────────────────

export type ProfitPreservationRejection =
    | "NOT_OPEN"
    | "NO_POSITION"
    | "INVALID_PERCENT"
    | "NOT_PROFITABLE"
    | "SPEC_MISSING"
    | "INVALID_QUOTE";

export interface ProfitPreservationRejectionDetail {
    ok: false;
    reason: ProfitPreservationRejection;
    message: string;
    currentNetCents: number | null;
}

export interface ProfitPreservationInput {
    trade: ChallengeTrade;
    spec: Pick<ArenaSymbolSpec, "contractSize"> | null;
    quote: PartialCloseQuote | null;
    /** Percentage of the CURRENT NET UNREALIZED profit to lock, in (0, 100]. */
    profitPercent: number;
    stepCentiLots: number;
}

export type ProfitPreservationResult =
    | ProfitPreservationRejectionDetail
    | {
          ok: true;
          /** Net unrealized P&L of the whole position right now. */
          currentNetCents: number;
          /** Profit the trader asked to lock. */
          targetCents: number;
          /** Exact (unrounded) quantity that would hit the target. */
          idealCentiLots: number;
          /** Quantity after normalising to the tradable grid. */
          closeCentiLots: number;
          remainingCentiLots: number;
          /** What the tradable quantity actually realizes. */
          realized: SlicePnl;
          /** What the position keeps running with. */
          remaining: SlicePnl;
          executionPrice: number;
      };

/**
 * Solve for the quantity that realizes approximately `profitPercent` of the
 * position's current net unrealized P&L.
 *
 * Steps:
 *   1. Price the position as-is → current net unrealized P&L.
 *   2. Refuse outright when that is not positive — a loss cannot be "locked".
 *   3. target = pctOfCents(currentNet, profitPercent).
 *   4. Solve target = net(q). Verified against `slicePnlAt` rather than
 *      assumed linear, so a cost model with any size-independent component
 *      still produces a correct quantity.
 *   5. Snap DOWN to the tradable grid: never lock more than was asked.
 *   6. Report the honest realized figure, not the requested one.
 */
export function calculateProfitPreservingPartialClose(input: ProfitPreservationInput): ProfitPreservationResult {
    const { trade, spec, quote, profitPercent, stepCentiLots } = input;
    const step = Math.max(1, stepCentiLots);

    if (trade.status !== "open" || trade.sizeCentiLots <= 0) {
        return { ok: false, reason: "NO_POSITION", message: "Position is not open.", currentNetCents: null };
    }
    if (!Number.isFinite(profitPercent) || profitPercent <= 0 || profitPercent > 100) {
        return { ok: false, reason: "INVALID_PERCENT", message: "Profit percentage must be greater than 0 and at most 100.", currentNetCents: null };
    }
    if (!spec) {
        return { ok: false, reason: "SPEC_MISSING", message: "Execution specification unavailable for this instrument.", currentNetCents: null };
    }
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
        return { ok: false, reason: "INVALID_QUOTE", message: "No executable price available.", currentNetCents: null };
    }

    const current = positionNetPnl(trade, spec, quote.price);
    if (current.netCents <= 0) {
        return {
            ok: false,
            reason: "NOT_PROFITABLE",
            message: "This position is not in profit — there is no profit to preserve.",
            currentNetCents: current.netCents,
        };
    }

    const targetCents = pctOfCents(current.netCents, profitPercent);

    // Net P&L is very nearly linear in quantity (every cost component scales
    // with lots), so solve analytically and then VERIFY with the canonical
    // slice pricer. If the cost model is not linear, fall back to a bounded
    // deterministic search on the lot grid.
    let closeCentiLots = solveByLinearScale(trade, current.netCents, targetCents);
    if (Math.abs(slicePnlAt(trade, spec, quote.price, safeQuantise(closeCentiLots, trade.sizeCentiLots)).netCents - targetCents) > 1) {
        closeCentiLots = solveOnGrid(trade, spec, quote.price, targetCents, step);
    }

    const idealCentiLots = closeCentiLots;

    // Snap DOWN: locking must never exceed the requested percentage.
    let snapped = snapDownToStep(closeCentiLots, step);
    if (snapped <= 0) snapped = Math.min(step, trade.sizeCentiLots);
    snapped = Math.min(snapped, trade.sizeCentiLots);
    if (snapped <= 0) {
        return { ok: false, reason: "NO_POSITION", message: "Position is below the tradable lot step.", currentNetCents: current.netCents };
    }

    const realized = slicePnlAt(trade, spec, quote.price, snapped);
    const remainingCentiLots = trade.sizeCentiLots - snapped;
    const remaining = remainingCentiLots > 0 ? slicePnlAt(trade, spec, quote.price, remainingCentiLots) : null;

    return {
        ok: true,
        currentNetCents: current.netCents,
        targetCents,
        idealCentiLots,
        closeCentiLots: snapped,
        remainingCentiLots,
        realized,
        remaining: remaining ?? { grossCents: 0, costCents: 0, netCents: 0, exitPriceMicros: toPriceMicros(quote.price) },
        executionPrice: quote.price,
    };
}

/** Analytic solve: q = target × positionSize / positionNet. */
function solveByLinearScale(trade: ChallengeTrade, positionNetCents: number, targetCents: number): number {
    if (positionNetCents === 0) return 0;
    return (targetCents * trade.sizeCentiLots) / positionNetCents;
}

function safeQuantise(centiLots: number, maxCentiLots: number): number {
    const clamped = Math.max(0, Math.min(centiLots, maxCentiLots));
    return Number.isFinite(clamped) ? clamped : 0;
}

/**
 * Deterministic bounded search for the grid quantity whose net P&L is closest
 * to the target without exceeding it. Only used when the cost model turns out
 * to be non-linear, so the common path stays O(1).
 */
function solveOnGrid(
    trade: ChallengeTrade,
    spec: Pick<ArenaSymbolSpec, "contractSize">,
    quotePrice: number,
    targetCents: number,
    stepCentiLots: number
): number {
    const step = Math.max(1, stepCentiLots);
    let best = step;
    let bestNet = slicePnlAt(trade, spec, quotePrice, step).netCents;
    for (let q = step; q <= trade.sizeCentiLots; q += step) {
        const net = slicePnlAt(trade, spec, quotePrice, q).netCents;
        if (net <= targetCents) {
            best = q;
            bestNet = net;
        } else {
            break;
        }
    }
    void bestNet;
    return best;
}

// ──────────── Unified plan ────────────────────────────────────────────────────

export type PartialCloseBlockReason =
    | ProfitPreservationRejection
    | "UNINTENDED_LOSS"
    | "BELOW_TARGET"
    | "MIN_EXECUTABLE_FULL_CLOSE";

export interface PartialClosePlan {
    mode: PartialCloseMode;
    ok: boolean;
    tradeId: string;
    symbol: string;
    side: "long" | "short";
    closeType: TradeCloseType;

    /** Price the close would execute at (server-resolved quote). */
    executionPrice: number;
    quoteAt: number;

    positionCentiLots: number;
    closeCentiLots: number;
    remainingCentiLots: number;
    isFullClose: boolean;

    /** Net unrealized P&L of the position before the close. */
    currentNetCents: number;
    /** Requested locked profit — null in volume mode. */
    targetCents: number | null;
    /** Honest expectation of what this close realizes. */
    expectedGrossCents: number;
    expectedCostCents: number;
    expectedNetCents: number;
    /** What the surviving position keeps showing as unrealized. */
    remainingNetCents: number;

    stepCentiLots: number;
    /** Blocking problems — the plan must not be executed. */
    blocked: PartialCloseBlockReason[];
    /** Non-blocking notices the trader must see before confirming. */
    warnings: string[];
    message: string;
}

export interface PlanPartialCloseInput {
    trade: ChallengeTrade;
    spec: Pick<ArenaSymbolSpec, "contractSize"> | null;
    quote: PartialCloseQuote | null;
    stepCentiLots: number;
    volume?: { lots?: number | null; percent?: number | null } | null;
    /** Profit-preservation request. Mutually exclusive with `volume`. */
    profitPercent?: number | null;
}

const BLOCK_MESSAGES: Record<ProfitPreservationRejection, string> = {
    NOT_OPEN: "Position is not open.",
    NO_POSITION: "Position is not open.",
    INVALID_PERCENT: "Profit percentage must be greater than 0 and at most 100.",
    NOT_PROFITABLE: "This position is not in profit — there is no profit to preserve.",
    SPEC_MISSING: "Execution specification unavailable for this instrument.",
    INVALID_QUOTE: "No executable price available.",
};

/**
 * Build the single plan used by BOTH the confirmation preview and execution.
 * Never invents a value: every number below is derived from the trade record,
 * the instrument spec and the server-resolved quote.
 */
export function planPartialClose(input: PlanPartialCloseInput): PartialClosePlan {
    const { trade, spec, quote, stepCentiLots } = input;
    const step = Math.max(1, stepCentiLots);
    const executionPrice = quote?.price ?? 0;
    const quoteAt = quote?.timestamp ?? 0;
    const base = {
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        side: trade.side,
        executionPrice,
        quoteAt,
        positionCentiLots: trade.sizeCentiLots,
        stepCentiLots: step,
    };

    const empty = (mode: PartialCloseMode, blocked: PartialCloseBlockReason[], message: string, currentNetCents: number | null): PartialClosePlan => ({
        mode,
        ok: false,
        ...base,
        closeType: "FULL",
        closeCentiLots: 0,
        remainingCentiLots: trade.sizeCentiLots,
        isFullClose: false,
        currentNetCents: currentNetCents ?? 0,
        targetCents: null,
        expectedGrossCents: 0,
        expectedCostCents: 0,
        expectedNetCents: 0,
        remainingNetCents: 0,
        blocked,
        warnings: [],
        message,
    });

    // ── Mode B: profit preservation ─────────────────────────────────────────
    if (input.profitPercent != null) {
        const result = calculateProfitPreservingPartialClose({
            trade,
            spec,
            quote,
            profitPercent: input.profitPercent,
            stepCentiLots: step,
        });
        if (!result.ok) {
            const message = BLOCK_MESSAGES[result.reason];
            return empty("PROFIT_PRESERVATION", [result.reason], message, result.currentNetCents);
        }

        const remainingCentiLots = result.remainingCentiLots;
        const isFullClose = remainingCentiLots <= 0;
        const warnings: string[] = [];
        const blocked: PartialCloseBlockReason[] = [];

        // HARD BUSINESS RULE: a profit-preservation close on a profitable
        // position must never be planned to realize a loss. Rounding to the lot
        // grid, spread, slippage and commission are all allowed to leave the
        // realized figure BELOW target — never below zero.
        if (result.currentNetCents > 0 && result.realized.netCents <= 0) {
            blocked.push("UNINTENDED_LOSS");
        }

        const shortfallCents = result.targetCents - result.realized.netCents;
        if (shortfallCents > 0) {
            warnings.push(
                `Lot grid and costs leave ${(shortfallCents / 100).toFixed(2)} below the ${(result.targetCents / 100).toFixed(2)} target.`
            );
        } else if (shortfallCents < 0) {
            warnings.push(`Realizes ${Math.abs(shortfallCents / 100).toFixed(2)} more than the target — the tradable minimum.`);
        }

        if (trade.sizeCentiLots < step) {
            warnings.push("Position is smaller than one tradable lot step; the only executable close is the whole position.");
        } else if (result.closeCentiLots >= step && result.closeCentiLots < step * 2 && result.targetCents < result.currentNetCents) {
            warnings.push("Target is below one tradable lot step; closing the smallest tradable slice.");
        }

        const message = blocked.length
            ? "Refused: this close cannot realize a profit on a profitable position. Nothing was executed."
            : `Lock ${input.profitPercent}% of profit → close ${centiLotsToNumber(result.closeCentiLots)} of ${centiLotsToNumber(trade.sizeCentiLots)} lot(s), realizing ${formatSigned(result.realized.netCents)}.`;

        return {
            mode: "PROFIT_PRESERVATION",
            ok: blocked.length === 0,
            ...base,
            closeType: isFullClose ? "FULL" : "PROFIT_PRESERVATION",
            closeCentiLots: result.closeCentiLots,
            remainingCentiLots,
            isFullClose,
            currentNetCents: result.currentNetCents,
            targetCents: result.targetCents,
            expectedGrossCents: result.realized.grossCents,
            expectedCostCents: result.realized.costCents,
            expectedNetCents: result.realized.netCents,
            remainingNetCents: result.remaining.netCents,
            blocked,
            warnings,
            message,
        };
    }

    // ── Mode A: volume partial close (or a plain full close) ─────────────────
    if (!spec || !quote || !Number.isFinite(quote.price) || quote.price <= 0) {
        return empty("VOLUME", ["INVALID_QUOTE"], "No executable price available.", null);
    }
    const current = positionNetPnl(trade, spec, quote.price);
    const resolved = resolveVolumeCloseCentiLots({
        trade,
        stepCentiLots: step,
        lots: input.volume?.lots ?? null,
        percent: input.volume?.percent ?? null,
    });
    if ("error" in resolved) {
        return empty("VOLUME", ["NO_POSITION"], resolved.error, current.netCents);
    }

    const closeCentiLots = resolved.closeCentiLots;
    const remainingCentiLots = trade.sizeCentiLots - closeCentiLots;
    const isFullClose = remainingCentiLots <= 0;
    const realized = slicePnlAt(trade, spec, quote.price, closeCentiLots);
    const remainingSlice = remainingCentiLots > 0 ? slicePnlAt(trade, spec, quote.price, remainingCentiLots) : null;

    return {
        mode: "VOLUME",
        ok: true,
        ...base,
        closeType: isFullClose ? "FULL" : "VOLUME_PARTIAL",
        closeCentiLots,
        remainingCentiLots,
        isFullClose,
        currentNetCents: current.netCents,
        targetCents: null,
        expectedGrossCents: realized.grossCents,
        expectedCostCents: realized.costCents,
        expectedNetCents: realized.netCents,
        remainingNetCents: remainingSlice?.netCents ?? 0,
        blocked: [],
        warnings: [],
        message: `Close ${centiLotsToNumber(closeCentiLots)} of ${centiLotsToNumber(trade.sizeCentiLots)} lot(s), realizing ${formatSigned(realized.netCents)}.`,
    };
}

function formatSigned(cents: number): string {
    const value = cents / 100;
    return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

// ──────────── Trade-record close type ────────────────────────────────────────

/**
 * Close type for a trade record, backfilling legacy rows that predate the
 * field. Legacy partial closes were ALWAYS volume-based (profit preservation
 * did not exist), so `partial_close` maps to VOLUME_PARTIAL — the migration is
 * exact, not a guess.
 */
export function closeTypeOf(trade: Pick<ChallengeTrade, "exitReason" | "closeType">): TradeCloseType {
    if (trade.closeType) return trade.closeType;
    switch (trade.exitReason) {
        case "partial_close":
            return "VOLUME_PARTIAL";
        case "stop_loss":
            return "STOP_LOSS";
        case "take_profit":
            return "TAKE_PROFIT";
        case "breach_close":
            return "CHALLENGE_RISK";
        case "manual":
        case "challenge_end":
        default:
            return "FULL";
    }
}
