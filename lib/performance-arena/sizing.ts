// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — position sizing (pure, deterministic, shared).
//
// This module is the single source of truth for HOW MUCH you may trade and
// WHY an order is or is not allowed. It is imported by the server rule gate
// (./rules) and by the order ticket, so the number the trader sees before
// clicking Buy is exactly the number the server enforces — no drift, no
// "it rejected with a number I never saw".
//
// Why sizing is measured in RISK, not notional
// ─────────────────────────────────────────────
// A raw notional-to-equity ratio is not a risk measure. On a $10K virtual
// account EURUSD carries $10,000 of notional per lot (100,000 contract size),
// so a 0.10 lot — a single 0.01 step — reads as 100% of equity in notional
// while risking about $10 at a 10-pip stop. The old rule compared that
// notional against "25% of equity" and rejected essentially every normal
// order, which is exactly what users reported. Professional prop engines size
// from the stop distance, so that is what this module does:
//
//   1. AGGREGATE_RISK  — open risk across ALL positions + this one ≤
//                        maxAggregateRiskPctOfEquity of equity
//   2. RISK_PER_TRADE  — (stop distance × size × contractSize + costs) ≤
//                        maxRiskPerTradePct of equity
//   3. LEVERAGE        — total net notional ≤ equity × maxLeverageRatio
//   4. POSITION_SIZE   — per-instrument NET notional ≤ equity × multiple
//
// Gates 1–2 are what actually protect the account; 3–4 keep notional sane.
// Exits and reductions bypass all four — a trader must always be able to
// de-risk (see RISK_REDUCING_ALLOWED in ./rules).
//
// All arithmetic is integer cents / integer centi-lots, rounded exactly once,
// half away from zero — the same determinism contract as ./money.
// ─────────────────────────────────────────────────────────────────────────────

import { CENTI_LOT, MICRO, notionalCents, plannedRiskCents, roundHalfAwayFromZero } from "./money";
import type { ArenaSymbolSpec } from "./execution";
import type { ChallengePolicy } from "./types";

/** Per-lot economics and the lot grid of one instrument. */
export interface InstrumentEconomics {
    /** Round-trip cost in cents for one lot. */
    costPerLotCents: number;
    /** Round-trip cost in cents for one centi-lot. */
    costPerCentiLotCents: number;
    /** Position value in cents for one centi-lot, at `priceMicros`. */
    valuePerCentiLotCents: number;
    /** Risk in cents for one centi-lot moved `distanceMicros` against you. */
    riskPerCentiLotCents: (distanceMicros: number) => number;
}

/**
 * Solve the linear per-centi-lot economics of an instrument at a price.
 * Everything downstream is a division against these, so lot-step rounding
 * stays exact.
 */
export function instrumentEconomics(params: {
    spec: ArenaSymbolSpec;
    policy: ChallengePolicy;
    priceMicros: number;
}): InstrumentEconomics {
    const { spec, policy, priceMicros } = params;
    const spreadPriceUnits = policy.costModel.useTypicalSpread ? spec.typicalSpread : 0;
    const slippagePriceUnits = policy.costModel.slippagePips * spec.pipSize;

    const spreadCents = Math.max(0, roundHalfAwayFromZero(spreadPriceUnits * spec.contractSize * 100));
    const slippageCents = Math.max(0, roundHalfAwayFromZero(slippagePriceUnits * 2 * spec.contractSize * 100));
    const commissionCents = Math.max(0, roundHalfAwayFromZero(policy.costModel.commissionPerLotCents));
    const costPerLotCents = spreadCents + slippageCents + commissionCents;

    const priceUnits = priceMicros / MICRO;
    const valuePerCentiLotCents = priceUnits * spec.contractSize;

    return {
        costPerLotCents,
        costPerCentiLotCents: costPerLotCents / CENTI_LOT,
        valuePerCentiLotCents,
        riskPerCentiLotCents: (distanceMicros: number) =>
            (Math.abs(distanceMicros) / MICRO) * spec.contractSize + costPerLotCents / CENTI_LOT,
    };
}

// ──────────── Lot-grid helpers ──────────────────────────────────────────────

/** Largest multiple of `step` (in lots) that is ≤ `lots`. */
export function floorToLotStep(lots: number, step: number): number {
    if (!Number.isFinite(lots) || lots <= 0) return 0;
    if (!Number.isFinite(step) || step <= 0) return lots;
    const units = Math.floor(lots / step + 1e-9);
    return Math.max(0, roundHalfAwayFromZero(units * step * CENTI_LOT));
}

/** Largest valid centi-lot count ≤ `centiLots`, snapped to the lot grid. */
export function floorToCentiLotStep(centiLots: number, stepLots: number): number {
    if (!Number.isFinite(centiLots) || centiLots <= 0) return 0;
    const stepUnits = Math.max(1, Math.round((stepLots > 0 ? stepLots : 0.01) * CENTI_LOT));
    return Math.floor(centiLots / stepUnits) * stepUnits;
}

export function centiLotsToLots(centiLots: number): number {
    return centiLots / CENTI_LOT;
}

/** Cents budget for a percentage of a base. Never negative. */
export function pctOfCentsSafe(baseCents: number, pct: number): number {
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    return Math.max(0, roundHalfAwayFromZero((Math.max(0, baseCents) * pct) / 100));
}

// ──────────── Effective policy ceilings ─────────────────────────────────────

/**
 * Effective per-instrument net-notional ceiling, as a multiple of equity.
 *
 * `maxPositionNotionalMultiple` is the modern field. `maxPositionPctOfEquity`
 * is the legacy per-position percentage; dividing it by 100 keeps a stored
 * policy meaningful (an admin who genuinely wants 300% of equity in one
 * instrument can still express it). Taking the max means legacy values such
 * as the shipped 25 no longer impose an impossible 0.25× cap on FX, while an
 * intentionally strict stored value still binds.
 */
export function effectiveNotionalMultiple(policy: ChallengePolicy): number {
    const modern = Number.isFinite(policy.maxPositionNotionalMultiple) && policy.maxPositionNotionalMultiple > 0
        ? policy.maxPositionNotionalMultiple
        : 0;
    const legacyMultiple = Number.isFinite(policy.maxPositionPctOfEquity) && policy.maxPositionPctOfEquity > 0
        ? policy.maxPositionPctOfEquity / 100
        : 0;
    return Math.max(modern, legacyMultiple, 1);
}

/** Aggregate open-risk ceiling, % of equity. Falls back to the per-trade cap. */
export function effectiveAggregateRiskPct(policy: ChallengePolicy): number {
    const perTrade = Number.isFinite(policy.maxRiskPerTradePct) && policy.maxRiskPerTradePct > 0 ? policy.maxRiskPerTradePct : 0;
    const configured = Number.isFinite(policy.maxAggregateRiskPctOfEquity) ? policy.maxAggregateRiskPctOfEquity : 0;
    // A policy predating the field gets 3× the per-trade cap — always ≥ the
    // per-trade budget so one trade can never be rejected by a ceiling that is
    // smaller than its own per-trade allowance.
    return configured > 0 ? Math.max(configured, perTrade) : perTrade * 3;
}

// ──────────── The sizing solve ──────────────────────────────────────────────

/** Which ceiling currently binds the position size. */
export type SizingGate = "aggregate_risk" | "per_trade_risk" | "notional" | "leverage" | "hard_max";

export interface SizingCeilings {
    /** Max centi-lots allowed by the aggregate open-risk cap. */
    aggregateRiskCentiLots: number;
    /** Max centi-lots allowed by the per-trade risk cap. */
    perTradeRiskCentiLots: number;
    /** Max centi-lots allowed by per-instrument net notional. */
    notionalCentiLots: number;
    /** Max centi-lots allowed by the account leverage cap. */
    leverageCentiLots: number;
    /** Max centi-lots allowed by the policy / instrument lot ceiling. */
    hardMaxCentiLots: number;
    /** The binding ceiling: the minimum of the above. */
    maxCentiLots: number;
    /** Which ceiling binds. */
    bindingGate: SizingGate;
}

export interface SizingInput {
    spec: ArenaSymbolSpec;
    policy: ChallengePolicy;
    /** Current equity in cents (the denominator for every percentage). */
    equityCents: number;
    /** Fill price in integer micros. */
    entryPriceMicros: number;
    /** Stop price in integer micros; null ⇒ risk cannot be measured. */
    stopLossMicros: number | null;
    /** Take-profit in integer micros (reward:risk only). */
    takeProfitMicros?: number | null;
    side?: "long" | "short";
    /**
     * SIGNED net notional already open on this instrument (positive long,
     * negative short), in cents. Signed because an opposing order NETS the
     * position down rather than adding to it — a short that flattens a long
     * frees exposure instead of consuming it.
     */
    currentSignedSymbolExposureCents?: number;
    /** Planned risk already committed by open positions, in cents. */
    openRiskCents?: number;
    /** SIGNED net notional across the whole account, in cents. */
    currentSignedTotalExposureCents?: number;
}

export interface SizingPreview {
    /** Requested size snapped to the lot grid, before any ceiling is applied. */
    requestedCentiLots: number;
    /** Requested size clamped by every gate — the largest legal size at or below the request. */
    centiLots: number;
    /** True when a ceiling forced the size below what was requested. */
    clamped: boolean;
    lots: number;
    /** Net notional in cents this order adds to the instrument. */
    notionalCents: number;
    notionalPctOfEquity: number;
    /** Planned risk in cents (null without a valid stop-loss). */
    riskCents: number | null;
    riskPctOfEquity: number | null;
    /** Aggregate open risk after the fill, % of equity. */
    projectedAggregateRiskPct: number;
    /** Total net notional after the fill, × equity. */
    projectedLeverageMultiple: number;
    /** Stop distance in pips (null without a stop-loss). */
    stopDistancePips: number | null;
    /** Reward:risk from the configured take-profit, when both exist. */
    rewardRiskRatio: number | null;
    /** Round-trip cost in cents for this size. */
    costCents: number;
    ceilings: SizingCeilings;
}

/**
 * Solve the largest legal position and describe what a requested size costs
 * against every gate. Pure — the ticket calls it for a live preview, the rule
 * engine calls it to build an actionable rejection message.
 */
export function previewPosition(input: SizingInput, requestedCentiLots: number): SizingPreview {
    const { spec, policy, entryPriceMicros, stopLossMicros, side = "long" } = input;
    const equityCents = Math.max(1, input.equityCents);
    const lotStep = Math.max(0.01, policy.positionSizePolicy.stepLots);
    const econ = instrumentEconomics({ spec, policy, priceMicros: entryPriceMicros });

    const hardMaxCentiLots = Math.max(
        0,
        Math.round(Math.min(policy.positionSizePolicy.maxSizeLots, spec.maxLot) * CENTI_LOT)
    );
    // `requestedCentiLots` is what the trader asked for, snapped to the lot
    // grid — deliberately NOT clamped to a ceiling. The rule engine compares it
    // against `ceilings.maxCentiLots` to reject an oversized order, and reports
    // the legal maximum in the message. Clamping it here would make every
    // ceiling unenforceable: the violation test would run against the already-
    // shrunken size and always pass.
    const requested = Math.max(0, floorToCentiLotStep(requestedCentiLots, lotStep));

    // ── Stop validity ────────────────────────────────────────────────────
    // A stop on the wrong side of the fill cannot measure risk, so it is
    // treated as absent rather than as a negative risk.
    const stopValid =
        stopLossMicros !== null &&
        (side === "long" ? stopLossMicros < entryPriceMicros : stopLossMicros > entryPriceMicros);
    const stopDistanceMicros = stopValid ? Math.abs(entryPriceMicros - (stopLossMicros as number)) : 0;
    const riskPerCentiLot = stopValid ? econ.riskPerCentiLotCents(stopDistanceMicros) : 0;

    // ── Gate ceilings ────────────────────────────────────────────────────
    const perTradeBudget = pctOfCentsSafe(equityCents, policy.maxRiskPerTradePct);
    const aggregateBudget = Math.max(
        0,
        pctOfCentsSafe(equityCents, effectiveAggregateRiskPct(policy)) - Math.max(0, input.openRiskCents ?? 0)
    );
    // Without a measurable stop the risk gates cannot bound size; they must
    // not clamp to 0 either, or every stop-less order becomes unrepresentable
    // and the aggregate cap would be silently unenforceable.
    const riskCeiling = (budget: number) => (riskPerCentiLot > 0 ? Math.floor(budget / riskPerCentiLot) : hardMaxCentiLots);

    // Notional and leverage ceilings are solved against the SIGNED book, so an
    // order on the opposite side nets exposure down and can never be blocked by
    // a budget that its own reduction is what relieves. Solving u such that
    // |current + valuePerUnit·u| ≤ budget gives u ≤ (budget − current) / value,
    // which is the same formula for both directions.
    const signedSymbolExposure = input.currentSignedSymbolExposureCents ?? 0;
    const signedTotalExposure = input.currentSignedTotalExposureCents ?? 0;
    const direction = side === "long" ? 1 : -1;
    // Headroom for |S + direction·v·u| ≤ M solves to u ≤ (M − direction·S) / v.
    // The sign matters: selling into a long RELIEVES the book, so it gains
    // headroom (M + |S|) rather than consuming it (M − |S|). Using the unsigned
    // exposure here would cap a de-risking order at the same size as an entry —
    // exactly the "can't get out" failure netting exists to prevent.
    const notionalMultiple = effectiveNotionalMultiple(policy);
    const symbolCeilingCents = equityCents * notionalMultiple - direction * signedSymbolExposure;
    const leverageCeilingCents =
        equityCents * Math.max(1, policy.leveragePolicy.maxLeverageRatio) - direction * signedTotalExposure;
    const valueCeiling = (ceilingCents: number) =>
        econ.valuePerCentiLotCents > 0
            ? Math.max(0, Math.floor(ceilingCents / econ.valuePerCentiLotCents))
            : hardMaxCentiLots;

    const ceilings: SizingCeilings = {
        aggregateRiskCentiLots: riskCeiling(aggregateBudget),
        perTradeRiskCentiLots: riskCeiling(perTradeBudget),
        notionalCentiLots: valueCeiling(symbolCeilingCents),
        leverageCentiLots: valueCeiling(leverageCeilingCents),
        hardMaxCentiLots,
        maxCentiLots: 0,
        bindingGate: "hard_max",
    };

    let bindingGate: SizingGate = "hard_max";
    let maxCentiLots = hardMaxCentiLots;
    const ranked: Array<[SizingGate, number]> = [
        ["aggregate_risk", ceilings.aggregateRiskCentiLots],
        ["per_trade_risk", ceilings.perTradeRiskCentiLots],
        ["notional", ceilings.notionalCentiLots],
        ["leverage", ceilings.leverageCentiLots],
    ];
    for (const [gate, value] of ranked) {
        if (value < maxCentiLots) {
            maxCentiLots = value;
            bindingGate = gate;
        }
    }
    ceilings.maxCentiLots = Math.max(0, maxCentiLots);
    ceilings.bindingGate = bindingGate;

    // ── Describe the requested size ──────────────────────────────────────
    const centiLots = Math.min(requested, ceilings.maxCentiLots);
    const notional =
        centiLots > 0
            ? notionalCents({ priceMicros: entryPriceMicros, sizeCentiLots: centiLots, contractSize: spec.contractSize })
            : 0;
    const costCents = Math.max(0, roundHalfAwayFromZero((econ.costPerLotCents * centiLots) / CENTI_LOT));
    const risk = stopValid && centiLots > 0
        ? plannedRiskCents({
            side,
            entryPriceMicros,
            stopLossMicros,
            sizeCentiLots: centiLots,
            contractSize: spec.contractSize,
            costCents,
        })
        : null;

    const projectedOpenRisk = Math.max(0, input.openRiskCents ?? 0) + Math.max(0, risk ?? 0);
    // Projected leverage uses the NETTED result, so a reduction can only lower it.
    const projectedExposure = Math.abs(signedTotalExposure + direction * econ.valuePerCentiLotCents * centiLots);

    return {
        requestedCentiLots: requested,
        centiLots,
        clamped: requested > centiLots,
        lots: centiLotsToLots(centiLots),
        notionalCents: notional,
        notionalPctOfEquity: (notional / equityCents) * 100,
        riskCents: risk,
        riskPctOfEquity: risk === null ? null : (risk / equityCents) * 100,
        projectedAggregateRiskPct: (projectedOpenRisk / equityCents) * 100,
        projectedLeverageMultiple: projectedExposure / equityCents,
        stopDistancePips: stopValid && spec.pipSize > 0 ? stopDistanceMicros / MICRO / spec.pipSize : null,
        rewardRiskRatio: rewardRiskRatio({ entryPriceMicros, stopLossMicros, takeProfitMicros: input.takeProfitMicros ?? null }),
        costCents,
        ceilings,
    };
}

function rewardRiskRatio(params: {
    entryPriceMicros: number;
    stopLossMicros: number | null;
    takeProfitMicros: number | null;
}): number | null {
    const { entryPriceMicros, stopLossMicros, takeProfitMicros } = params;
    if (stopLossMicros === null || takeProfitMicros === null) return null;
    const risk = Math.abs(entryPriceMicros - stopLossMicros);
    if (risk <= 0) return null;
    return Math.abs(takeProfitMicros - entryPriceMicros) / risk;
}

// ──────────── Net exposure (one-way netting per instrument) ─────────────────

/**
 * Aggregate NET exposure for one instrument: same-side lots add, opposite-side
 * lots cancel. Without this, holding a long and selling an equal short would
 * read as 2× exposure when the account is in fact flat.
 */
export function netExposureCents(params: {
    priceMicros: number;
    centiLotsBySide: { long: number; short: number };
    contractSize: number;
}): number {
    const netCentiLots = params.centiLotsBySide.long - params.centiLotsBySide.short;
    if (netCentiLots === 0) return 0;
    return Math.abs(
        notionalCents({
            priceMicros: params.priceMicros,
            sizeCentiLots: Math.abs(netCentiLots),
            contractSize: params.contractSize,
        })
    );
}

/** Total planned risk (cents) carried by a set of open positions. */
export function sumOpenRiskCents(positions: Array<{ riskCents: number | null }>): number {
    return positions.reduce((sum, position) => sum + Math.max(0, position.riskCents ?? 0), 0);
}