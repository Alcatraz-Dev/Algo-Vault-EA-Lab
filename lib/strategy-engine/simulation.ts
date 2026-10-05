/**
 * Shared position / execution mechanics (Phase 4).
 *
 * Exactly ONE implementation of:
 *   • stop-loss / take-profit planning
 *   • instrument-aware position sizing (SYMBOL_SPECS)
 *   • entry fill pricing (next-bar-open / same-bar-close, bid/ask aware)
 *   • per-leg costs (spread, slippage, commission)
 *   • intrabar exit detection + application (SL, TP1-3, trailing, break-even)
 *
 * The backtest loop, replay and paper trading all call these functions, so a
 * trade opened in backtest and the same trade opened in replay differ only in
 * fill environment — never in decision math.
 *
 * SIMULATION ASSUMPTIONS (surfaced to the UI):
 *  • OHLC data only. Prices are treated as the mid; spread and slippage are
 *    charged as explicit cash costs per leg (net-equivalent to buying at ask /
 *    selling at bid) because historical bid/ask is not available.
 *  • When SL and TP are both touched inside one bar, the STOP is assumed to
 *    fill first (conservative).
 *  • Gaps: a stop order fills at the bar OPEN when the market opened through
 *    the stop (worse than the stop); a limit/target fills at the open when the
 *    market opened through it in the favourable direction (better).
 */

import { SYMBOL_SPECS } from "@/lib/ai-signals/symbol-specs";
import type { MarketCandle } from "@/lib/market-data/types";
import type { ExecutionModel, ExitReason, Strategy } from "@/lib/strategy-lab/types";
import type { OrderSide, Position, PositionSide, PositionTarget } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Instrument specifications
// ─────────────────────────────────────────────────────────────────────────────

export interface SimSymbolSpec {
    symbol: string;
    pipSize: number;
    /** Price increment used to round executable prices (may differ from pipSize). */
    tickSize: number;
    /** Cash value of one pip per lot in account currency, from SYMBOL_SPECS.tickValue. */
    pipValue: number;
    contractSize: number;
    digits: number;
    minLot: number;
    maxLot: number;
    lotStep: number;
    typicalSpread: number;
}

const DEFAULT_SPEC: SimSymbolSpec = {
    symbol: "UNKNOWN",
    pipSize: 0.01,
    tickSize: 0.01,
    pipValue: 1,
    contractSize: 100,
    digits: 2,
    minLot: 0.01,
    maxLot: 100,
    lotStep: 0.01,
    typicalSpread: 0,
};

/** Instrument spec with safe defaults (XAUUSD-like) when unknown. */
export function simSymbolSpec(symbol: string): SimSymbolSpec {
    const s = SYMBOL_SPECS[symbol];
    if (!s) return { ...DEFAULT_SPEC, symbol };
    return {
        symbol,
        pipSize: s.pipSize ?? DEFAULT_SPEC.pipSize,
        tickSize: 10 ** -(s.digits ?? DEFAULT_SPEC.digits),
        pipValue: s.tickValue ?? DEFAULT_SPEC.pipValue,
        contractSize: s.contractSize ?? DEFAULT_SPEC.contractSize,
        digits: s.digits ?? DEFAULT_SPEC.digits,
        minLot: s.minLot ?? DEFAULT_SPEC.minLot,
        maxLot: s.maxLot ?? DEFAULT_SPEC.maxLot,
        lotStep: s.minLot ?? DEFAULT_SPEC.lotStep,
        typicalSpread: s.typicalSpread ?? 0,
    };
}

export function roundPrice(value: number, digits: number, tickSize?: number): number {
    if (!tickSize || !Number.isFinite(tickSize) || tickSize <= 0) return Number(value.toFixed(digits));
    return Number((Math.round(value / tickSize) * tickSize).toFixed(digits));
}

/** Convert a price move to account-currency P&L using configured pip value. */
export function cashValueForMove(move: number, volume: number, spec: SimSymbolSpec): number {
    return (move / spec.pipSize) * spec.pipValue * volume;
}

/** Round a volume to the instrument's lot step (never below zero). */
export function roundLots(volume: number, spec: SimSymbolSpec): number {
    if (!Number.isFinite(volume) || volume <= 0) return 0;
    const r = Math.round(volume / spec.lotStep) * spec.lotStep;
    return Number(r.toFixed(4));
}

// ─────────────────────────────────────────────────────────────────────────────
// Costs
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionCostConfig {
    spreadPips: number;
    commissionPerLot: number;
    slippagePips: number;
}

export interface LegCosts {
    spread: number;
    slippage: number;
    commission: number;
    total: number;
}

/**
 * Cash cost of executing `volume` lots on one leg.
 * `spreadPips` is a full quoted spread, so each leg pays half; across a
 * round-trip the two halves equal one full spread. Commission is charged on
 * EXIT only (matches the established Strategy Lab cost model).
 */
export function legCosts(volume: number, spec: SimSymbolSpec, costs: ExecutionCostConfig): LegCosts {
    const spread = (costs.spreadPips * spec.pipValue * volume) / 2;
    const slippage = costs.slippagePips * spec.pipValue * volume;
    const commission = costs.commissionPerLot * volume * spec.contractSize;
    return { spread, slippage, commission, total: spread + slippage + commission };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry pricing (bid/ask awareness)
// ─────────────────────────────────────────────────────────────────────────────

export interface EntryFillInput {
    side: OrderSide;
    executionModel: ExecutionModel;
    /** The bar the order executes on. */
    bar: MarketCandle;
    spec: SimSymbolSpec;
    costs: ExecutionCostConfig;
}

/**
 * Price a MARKET entry.
 *
 * next_bar_open → the entry bar's open; same_bar_close → the entry bar's
 * close. The OHLC price is the mid; spread/slippage are charged as cash costs
 * (see module header), which is the net-equivalent of buying at the ask.
 */
export function entryFillPrice(input: EntryFillInput): number {
    const raw = input.executionModel === "next_bar_open" ? input.bar.open : input.bar.close;
    return roundPrice(raw, input.spec.digits);
}

/**
 * Evaluate a resting LIMIT / STOP order against a bar.
 * Returns the fill price, or null when the order does not fill on this bar.
 * Gap-aware: fills at the open when the bar opened through the price.
 */
export function restingOrderFillPrice(
    side: OrderSide,
    type: "LIMIT" | "STOP",
    price: number,
    bar: MarketCandle,
    spec: SimSymbolSpec
): number | null {
    if (type === "LIMIT") {
        if (side === "BUY") {
            if (bar.open <= price) return roundPrice(bar.open, spec.digits); // gapped through → better price
            if (bar.low <= price) return roundPrice(price, spec.digits);
            return null;
        }
        if (bar.open >= price) return roundPrice(bar.open, spec.digits);
        if (bar.high >= price) return roundPrice(price, spec.digits);
        return null;
    }
    // STOP
    if (side === "BUY") {
        if (bar.open >= price) return roundPrice(bar.open, spec.digits); // gapped through → worse price
        if (bar.high >= price) return roundPrice(price, spec.digits);
        return null;
    }
    if (bar.open <= price) return roundPrice(bar.open, spec.digits);
    if (bar.low <= price) return roundPrice(price, spec.digits);
    return null;
}

/**
 * Fill price for a protective STOP (loss) order on an existing position.
 * Returns a price WORSE than (or equal to) the stop when the bar opened
 * through it — never pretends the stop price was achievable.
 */
export function stopFillPrice(
    side: PositionSide,
    stopPrice: number,
    bar: MarketCandle,
    spec: SimSymbolSpec,
    gapAware: boolean
): number {
    if (side === "LONG") {
        if (bar.low <= stopPrice) {
            if (gapAware && bar.open < stopPrice) return roundPrice(bar.open, spec.digits);
            return roundPrice(stopPrice, spec.digits);
        }
        return roundPrice(stopPrice, spec.digits);
    }
    if (bar.high >= stopPrice) {
        if (gapAware && bar.open > stopPrice) return roundPrice(bar.open, spec.digits);
        return roundPrice(stopPrice, spec.digits);
    }
    return roundPrice(stopPrice, spec.digits);
}

/** Fill price for a profit target: never worse than the target, better on gaps. */
export function targetFillPrice(
    side: PositionSide,
    targetPrice: number,
    bar: MarketCandle,
    spec: SimSymbolSpec,
    gapAware: boolean
): number {
    if (side === "LONG") {
        if (bar.high >= targetPrice) {
            if (gapAware && bar.open > targetPrice) return roundPrice(bar.open, spec.digits);
            return roundPrice(targetPrice, spec.digits);
        }
        return roundPrice(targetPrice, spec.digits);
    }
    if (bar.low <= targetPrice) {
        if (gapAware && bar.open < targetPrice) return roundPrice(bar.open, spec.digits);
        return roundPrice(targetPrice, spec.digits);
    }
    return roundPrice(targetPrice, spec.digits);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stops & position sizing
// ─────────────────────────────────────────────────────────────────────────────

export interface StopsPlan {
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    /** |entry − SL| using the RAW entry price (identical to Strategy Lab). */
    riskPrice: number;
}

/** Plan SL/TP levels for an entry. Identical math in every environment. */
export function computeStops(
    strategy: Strategy,
    entryPrice: number,
    atr: number,
    isLong: boolean,
    digits: number,
    tickSize = 10 ** -digits
): StopsPlan {
    let sl: number;
    if (strategy.stopLoss.mode === "atr") {
        sl = isLong
            ? entryPrice - strategy.stopLoss.atrMultiple * atr
            : entryPrice + strategy.stopLoss.atrMultiple * atr;
    } else {
        sl = isLong
            ? entryPrice - strategy.stopLoss.levelOffset
            : entryPrice + strategy.stopLoss.levelOffset;
    }
    const riskPrice = Math.abs(entryPrice - sl);
    const slRounded = roundPrice(sl, digits, tickSize);

    const tpDistance = (r: number) => strategy.takeProfit.mode === "fixed"
        ? (r > 0 ? strategy.takeProfit.fixedDistance * r : 0)
        : r * riskPrice;
    const tp1Distance = tpDistance(strategy.takeProfit.r1 || (strategy.takeProfit.mode === "fixed" ? 1 : 0));
    const tp2Distance = tpDistance(strategy.takeProfit.r2);
    const tp3Distance = tpDistance(strategy.takeProfit.r3);
    const tp1 = tp1Distance > 0 ? roundPrice(isLong ? entryPrice + tp1Distance : entryPrice - tp1Distance, digits, tickSize) : 0;
    const tp2 = tp2Distance > 0 ? roundPrice(isLong ? entryPrice + tp2Distance : entryPrice - tp2Distance, digits, tickSize) : 0;
    const tp3 = tp3Distance > 0 ? roundPrice(isLong ? entryPrice + tp3Distance : entryPrice - tp3Distance, digits, tickSize) : 0;

    return { sl: slRounded, tp1, tp2, tp3, riskPrice };
}

export interface SizingInput {
    strategy: Strategy;
    balance: number;
    riskPrice: number;
    spec: SimSymbolSpec;
}

/**
 * Instrument-aware position sizing.
 *  • risk_percent → riskAmount / (stopDistance × pipValue / pipSize), clamped to
 *    lot step, min lot and max lot.
 *  • fixed_lot → the configured lot, clamped the same way.
 * Returns 0 when the instrument granularity cannot express the risk (never
 * silently over-risks with a minimum lot).
 */
export function sizePosition(input: SizingInput): number {
    const { strategy, balance, riskPrice, spec } = input;
    if (riskPrice <= 0 || balance <= 0) return 0;

    let volume: number;
    if (strategy.risk.mode === "percent") {
        const riskAmount = balance * (strategy.risk.riskPercent / 100);
        const cashRiskPerLot = (riskPrice / spec.pipSize) * spec.pipValue;
        volume = cashRiskPerLot > 0 ? riskAmount / cashRiskPerLot : 0;
    } else {
        volume = strategy.risk.fixedLot;
    }

    volume = roundLots(volume, spec);
    if (volume <= 0) return 0;
    if (volume < spec.minLot) return 0;
    if (volume > spec.maxLot) volume = spec.maxLot;
    return volume;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulated position (canonical Position + backtest bookkeeping)
// ─────────────────────────────────────────────────────────────────────────────

export interface FillChunk {
    pnl: number;
    volume: number;
    reason: ExitReason;
    price: number;
    barsHeld: number;
    timestamp: number;
}

export interface SimPosition extends Position {
    tp1: number;
    tp2: number;
    tp3: number;
    tp1Hit: boolean;
    tp2Hit: boolean;
    openBarIndex: number;
    closeBarIndex: number;
    chunks: FillChunk[];
}

let positionSeq = 0;
let ticketSeq = 100000;

/** Test hook: reset id sequences for deterministic ids. */
export function resetPositionIds(): void {
    positionSeq = 0;
    ticketSeq = 100000;
}

export interface OpenPositionInput {
    strategy: Strategy;
    symbol: string;
    side: OrderSide;
    /** Raw fill price (unrounded). */
    entryPrice: number;
    atr: number;
    balance: number;
    spec: SimSymbolSpec;
    costs: ExecutionCostConfig;
    /** Costs already embedded in the opening executable quote (e.g. paper bid/ask). */
    entryCostOverride?: number;
    timestamp: number;
    barIndex: number;
    session: string;
    regime: string;
    source?: "strategy" | "manual";
    /** Manual orders can force an exact volume instead of risk sizing. */
    forcedVolume?: number;
    /** Precomputed SL/TP plan (strategy entries — computed from the fill price). */
    plan?: StopsPlan;
    /** Manual orders use EXACTLY these levels; missing SL/TP means none. */
    manual?: { sl?: number; tp?: number };
}

/** Open a canonical position with planned stops, targets and sizing. */
export function openSimPosition(input: OpenPositionInput): SimPosition | null {
    const { strategy, spec, costs } = input;
    const isLong = input.side === "BUY";
    const digits = spec.digits;

    const entry = roundPrice(input.entryPrice, digits, spec.tickSize);

    let sl: number;
    let tp1 = 0;
    let tp2 = 0;
    let tp3 = 0;
    let riskPrice: number;

    if (input.plan) {
        sl = input.plan.sl;
        tp1 = input.plan.tp1;
        tp2 = input.plan.tp2;
        tp3 = input.plan.tp3;
        riskPrice = input.plan.riskPrice;
    } else if (input.manual) {
        sl = input.manual.sl !== undefined && Number.isFinite(input.manual.sl)
            ? roundPrice(input.manual.sl, digits)
            : Number.NaN;
        tp1 = input.manual.tp !== undefined && input.manual.tp > 0 ? roundPrice(input.manual.tp, digits) : 0;
        riskPrice = Number.isFinite(sl) ? Math.abs(input.entryPrice - sl) : 0;
    } else {
        const plan = computeStops(strategy, input.entryPrice, input.atr, isLong, digits, spec.tickSize);
        sl = plan.sl;
        tp1 = plan.tp1;
        tp2 = plan.tp2;
        tp3 = plan.tp3;
        riskPrice = plan.riskPrice;
    }
    if (!input.manual && riskPrice <= 0) return null;

    const volume = input.forcedVolume !== undefined
        ? roundLots(input.forcedVolume, spec)
        : sizePosition({ strategy, balance: input.balance, riskPrice, spec });
    if (volume <= 0) return null;

    const entryLeg = legCosts(volume, spec, costs);
    const entryCost = input.entryCostOverride ?? (entryLeg.spread + entryLeg.slippage);

    const isManual = !!input.manual;
    const targets: PositionTarget[] = (
        isManual
            ? [{ id: "tp1" as const, price: tp1, closePercent: 100, hit: false }]
            : [
                { id: "tp1" as const, price: tp1, closePercent: targetClosePercent(strategy, 1), hit: false },
                { id: "tp2" as const, price: tp2, closePercent: targetClosePercent(strategy, 2), hit: false },
                { id: "tp3" as const, price: tp3, closePercent: targetClosePercent(strategy, 3), hit: false },
            ]
    ).filter((t) => t.price > 0 && t.closePercent > 0);

    positionSeq++;
    ticketSeq++;

    return {
        id: `pos-${positionSeq}`,
        ticket: ticketSeq,
        symbol: input.symbol,
        side: isLong ? "LONG" : "SHORT",
        quantity: volume,
        remainingQuantity: volume,
        entryPrice: entry,
        currentPrice: entry,
        stopLoss: sl,
        targets,
        initialRisk: riskPrice,
        realizedPnL: 0,
        unrealizedPnL: 0,
        openedAt: input.timestamp,
        updatedAt: input.timestamp,
        strategyId: strategy.id,
        strategyVersion: strategy.version,
        session: input.session,
        regime: input.regime,
        status: "open",
        mae: 0,
        mfe: 0,
        trailingActive: false,
        entryCost,
        source: input.source ?? "strategy",
        tp1,
        tp2,
        tp3,
        tp1Hit: false,
        tp2Hit: false,
        openBarIndex: input.barIndex,
        closeBarIndex: input.barIndex,
        chunks: [],
    };
}

function targetClosePercent(strategy: Strategy, level: 1 | 2 | 3): number {
    const r = level === 1 ? strategy.takeProfit.r1 : level === 2 ? strategy.takeProfit.r2 : strategy.takeProfit.r3;
    const found = strategy.takeProfit.partialCloses.find((p) => p.atR === r);
    if (found) return found.closePercent;
    // Legacy semantics: TP1/TP2 only execute when configured; TP3 closes 100%.
    return level === 3 ? 100 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intrabar exit processing
// ─────────────────────────────────────────────────────────────────────────────

export type PositionAction =
    | { type: "close"; price: number; reason: ExitReason; volume: number }
    | { type: "partial"; price: number; reason: ExitReason; volume: number }
    | { type: "modify_sl"; price: number }
    | { type: "arm_trailing" }
    | { type: "break_even" };

export interface ProcessBarInput {
    strategy: Strategy;
    spec: SimSymbolSpec;
    costs: ExecutionCostConfig;
    gapAware: boolean;
    /** Close of the previous bar (trailing stops derive from CONFIRMED closes). */
    prevClose: number | null;
    atr: number;
    barIndex: number;
    /** Timestamp of the bar being processed (stamped onto fills). */
    timestamp: number;
}

/**
 * Detect AND apply the bar's exits to `pos`, returning the ordered action log.
 *
 * Order (documented, conservative):
 *   1. Stop loss / trailing stop (gap-aware fill)
 *   2. TP1 → TP2 → TP3 partial closes with break-even / lock / trailing arming
 *   3. Trailing stop update from this bar's confirmed close (effective next bar)
 *
 * Only data in `bar` is used — no future information.
 */
export function processPositionBar(
    pos: SimPosition,
    bar: MarketCandle,
    input: ProcessBarInput
): PositionAction[] {
    const { strategy, spec, gapAware } = input;
    const actions: PositionAction[] = [];
    if (pos.status !== "open") return actions;

    const digits = spec.digits;
    const isLong = pos.side === "LONG";

    // ── 1. Stop loss (or trailing stop, once armed) ──
    const hasStop = Number.isFinite(pos.stopLoss);
    const stopHit = hasStop && (isLong ? bar.low <= pos.stopLoss : bar.high >= pos.stopLoss);
    if (stopHit) {
        const price = stopFillPrice(pos.side, pos.stopLoss, bar, spec, gapAware);
        const reason: ExitReason = pos.trailingActive ? "trailing" : "sl";
        const volume = pos.remainingQuantity;
        closeChunk(pos, price, reason, input);
        actions.push({ type: "close", price, reason, volume });
        finalizeIfClosed(pos, bar, input);
        return actions;
    }

    // ── 2. Profit targets (sequential, state mutates between them) ──
    for (const target of pos.targets) {
        if (target.hit) continue;
        if (target.id === "tp2" && !pos.tp1Hit) continue;
        if (target.id === "tp3" && !(pos.tp1Hit && pos.tp2Hit)) continue;
        const hit = isLong ? bar.high >= target.price : bar.low <= target.price;
        if (!hit) continue;

        const price = targetFillPrice(pos.side, target.price, bar, spec, gapAware);
        let closeVol = roundLots(pos.remainingQuantity * (target.closePercent / 100), spec);
        if (closeVol < spec.minLot) {
            // The partial cannot be expressed in lot steps → close the rest.
            closeVol = pos.remainingQuantity;
        }

        closeChunk(pos, price, target.id, input, closeVol);
        target.hit = true;
        actions.push({ type: "partial", price, reason: target.id, volume: closeVol });

        if (target.id === "tp1") {
            pos.tp1Hit = true;
            if (strategy.takeProfit.moveBeAfterTp1) {
                pos.stopLoss = roundPrice(pos.entryPrice, digits);
                actions.push({ type: "break_even" });
            }
        } else if (target.id === "tp2") {
            pos.tp2Hit = true;
            if (strategy.takeProfit.lockAfterTp2 && pos.tp1 > 0) {
                pos.stopLoss = roundPrice(pos.tp1, digits);
                actions.push({ type: "modify_sl", price: pos.stopLoss });
            }
        }

        if (pos.remainingQuantity <= 0) {
            finalizeIfClosed(pos, bar, input);
            return actions;
        }

        // TP3 partially closed with volume left and trailing enabled → arm.
        if (target.id === "tp3" && strategy.takeProfit.trailingEnabled) {
            pos.trailingActive = true;
            actions.push({ type: "arm_trailing" });
        }
    }

    // ── 3. Trailing stop update from this bar's CONFIRMED close ──
    if (pos.trailingActive && input.prevClose !== null && input.atr > 0) {
        const trailAtr = strategy.takeProfit.trailingStopAtr * input.atr;
        const candidate = isLong
            ? roundPrice(input.prevClose - trailAtr, digits)
            : roundPrice(input.prevClose + trailAtr, digits);
        if (isLong && candidate > pos.stopLoss) {
            pos.stopLoss = candidate;
            actions.push({ type: "modify_sl", price: candidate });
        } else if (!isLong && candidate < pos.stopLoss) {
            pos.stopLoss = candidate;
            actions.push({ type: "modify_sl", price: candidate });
        }
    }

    return actions;
}

/** Close `volume` (or all remaining) at `price`, recording the net chunk. */
function closeChunk(
    pos: SimPosition,
    price: number,
    reason: ExitReason,
    input: ProcessBarInput,
    volume?: number
): void {
    const spec = input.spec;
    const closeVol = Math.min(volume ?? pos.remainingQuantity, pos.remainingQuantity);
    if (closeVol <= 0) return;
    const move = pos.side === "LONG" ? price - pos.entryPrice : pos.entryPrice - price;
    const gross = cashValueForMove(move, closeVol, spec);
    const costs = legCosts(closeVol, spec, input.costs);
    const pnl = gross - costs.spread - costs.slippage - costs.commission;

    pos.chunks.push({
        pnl,
        volume: closeVol,
        reason,
        price,
        barsHeld: Math.max(0, input.barIndex - pos.openBarIndex),
        timestamp: input.timestamp,
    });

    pos.realizedPnL += pnl;
    pos.remainingQuantity = roundLots(pos.remainingQuantity - closeVol, spec);
    pos.currentPrice = price;
    pos.updatedAt = input.timestamp;
}

function finalizeIfClosed(pos: SimPosition, bar: MarketCandle, input: ProcessBarInput): void {
    if (pos.remainingQuantity > 0) return;
    pos.status = "closed";
    pos.closedAt = bar.timestamp;
    pos.updatedAt = bar.timestamp;
    pos.closeBarIndex = input.barIndex;
    pos.unrealizedPnL = 0;
    // Entry cost is charged once, at finalization (parity with Strategy Lab).
    pos.realizedPnL = round2(pos.realizedPnL - pos.entryCost);
}

/** Force-close a position at market (end of data, risk kill, manual close). */
export function closePositionAt(
    pos: SimPosition,
    price: number,
    reason: ExitReason,
    input: ProcessBarInput,
    bar: MarketCandle
): PositionAction[] {
    if (pos.status !== "open") return [];
    const volume = pos.remainingQuantity;
    closeChunk(pos, price, reason, input);
    finalizeIfClosed(pos, bar, input);
    return [{ type: "close", price, reason, volume }];
}

/** Mark a position to market, updating unrealized PnL + MAE/MFE. */
export function markPosition(pos: SimPosition, price: number, bar?: MarketCandle, symbolSpec?: SimSymbolSpec): void {
    if (pos.status !== "open") return;
    pos.currentPrice = price;
    const move = pos.side === "LONG" ? price - pos.entryPrice : pos.entryPrice - price;
    const spec = symbolSpec ?? simSymbolSpec(pos.symbol);
    pos.unrealizedPnL = round2(cashValueForMove(move, pos.remainingQuantity, spec));

    if (bar) {
        const adverse = pos.side === "LONG" ? pos.entryPrice - bar.low : bar.high - pos.entryPrice;
        const favorable = pos.side === "LONG" ? bar.high - pos.entryPrice : pos.entryPrice - bar.low;
        pos.mae = Math.max(pos.mae, adverse);
        pos.mfe = Math.max(pos.mfe, favorable);
    } else {
        pos.mae = Math.max(pos.mae, -move);
        pos.mfe = Math.max(pos.mfe, move);
    }
}

function round2(v: number): number {
    return Number(v.toFixed(2));
}
