// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — simulated execution engine (pure, deterministic).
//
// Reuses the platform's canonical cost model conventions from the Strategy
// Lab backtester (`lib/strategy-lab/backtest.ts`):
//
//   spreadPips / typicalSpread → round-trip spread cost per lot
//   slippagePips               → adverse slippage on BOTH legs
//   commissionPerLot           → flat per lot round trip
//
// Fills are priced at the server-resolved quote (mid) and ALL round-trip
// costs are charged explicitly and recorded on the trade, so gross PnL,
// costs and net PnL are separately auditable. There is NO randomness: the
// same quote + size always produces the same integer fill record.
//
// No future leakage: fills only ever use the quote the server resolved at
// execution time (see ./service.ts), never a later price.
// ─────────────────────────────────────────────────────────────────────────────

import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import {
    CENTI_LOT,
    grossPnLCents,
    notionalCents,
    plannedRiskCents,
    positionCostCents,
    roundHalfAwayFromZero,
    toPriceMicros,
} from "./money";
import type { ChallengePolicy, MarketCategory, TradeFillCosts } from "./types";

// ──────────── Symbol metadata ────────────────────────────────────────────────

export interface ArenaSymbolSpec {
    symbol: string;
    market: MarketCategory;
    contractSize: number;
    pipSize: number;
    digits: number;
    /** Round-trip spread in price units; 0 when the platform has no data for it. */
    typicalSpread: number;
    minLot: number;
    maxLot: number;
    source: "SYMBOL_SPECS" | "derived";
}

const MARKET_BY_SYMBOL: Record<string, MarketCategory> = {
    EURUSD: "forex", GBPUSD: "forex", USDJPY: "forex", USDCHF: "forex",
    AUDUSD: "forex", NZDUSD: "forex", USDCAD: "forex", EURGBP: "forex",
    EURJPY: "forex", GBPJPY: "forex", AUDJPY: "forex", EURCHF: "forex",
    XAUUSD: "metals", XAGUSD: "metals",
    US30: "indices", NAS100: "indices", SPX500: "indices", SPY: "indices",
    QQQ: "indices", DXY: "indices",
    BTCUSD: "crypto", ETHUSD: "crypto", SOLUSD: "crypto", XRPUSD: "crypto",
    ADAUSD: "crypto", DOGEUSD: "crypto", BNBUSD: "crypto", LTCUSD: "crypto",
    DOTUSD: "crypto",
    AAPL: "equities", TSLA: "equities", MSFT: "equities", NVDA: "equities",
    AMZN: "equities", META: "equities", GOOGL: "equities", AMD: "equities",
    NFLX: "equities", COIN: "equities",
};

export function marketOfSymbol(symbol: string): MarketCategory | null {
    return MARKET_BY_SYMBOL[symbol.toUpperCase()] ?? null;
}

export const ARENA_SYMBOLS: string[] = Object.keys(MARKET_BY_SYMBOL);

/**
 * Resolve arena execution metadata for a symbol. Uses the canonical
 * SYMBOL_SPECS when available; otherwise derives conservative metadata from
 * the market category WITHOUT fabricating a spread (spread cost is 0 and the
 * policy's commission/slippage still apply).
 */
export function arenaSymbolSpec(symbol: string): ArenaSymbolSpec | null {
    const upper = symbol.toUpperCase();
    const market = marketOfSymbol(upper);
    if (!market) return null;

    const canonical = getSymbolSpec(upper);
    if (canonical) {
        return {
            symbol: upper,
            market,
            contractSize: canonical.contractSize,
            pipSize: canonical.pipSize,
            digits: canonical.digits,
            typicalSpread: canonical.typicalSpread,
            minLot: canonical.minLot,
            maxLot: canonical.maxLot,
            source: "SYMBOL_SPECS",
        };
    }

    const isJpy = upper.includes("JPY");
    const derived =
        market === "forex"
            ? { contractSize: 100_000, pipSize: isJpy ? 0.01 : 0.0001, digits: isJpy ? 3 : 5 }
            : market === "metals"
              ? { contractSize: 100, pipSize: 0.01, digits: 2 }
              : { contractSize: 1, pipSize: 0.01, digits: 2 };

    return {
        symbol: upper,
        market,
        contractSize: derived.contractSize,
        pipSize: derived.pipSize,
        digits: derived.digits,
        typicalSpread: 0,
        minLot: 0.01,
        maxLot: 100,
        source: "derived",
    };
}

/** Contract-size resolver used by metrics (registered once on import). */
export function contractSizeOf(symbol: string): number {
    return arenaSymbolSpec(symbol)?.contractSize ?? 100_000;
}

// ──────────── Fill computation ───────────────────────────────────────────────

export interface FillRequest {
    side: "long" | "short";
    sizeCentiLots: number;
    /** Server-resolved quote (mid) in price units. */
    quotePrice: number;
    spec: ArenaSymbolSpec;
    policy: ChallengePolicy;
}

export interface FillResult {
    entryPriceMicros: number;
    costs: TradeFillCosts;
    totalCostCents: number;
    riskCents: (stopLossMicros: number | null) => number | null;
    notionalCents: number;
}

/**
 * Deterministic fill record for an entry at the given quote.
 * Costs = round-trip spread + 2-leg slippage + commission (per lot).
 */
export function computeFill(req: FillRequest): FillResult {
    const { side, sizeCentiLots, quotePrice, spec, policy } = req;

    const spreadPriceUnits = policy.costModel.useTypicalSpread ? spec.typicalSpread : 0;
    const slippagePriceUnits = policy.costModel.slippagePips * spec.pipSize;

    const totalCostCents = positionCostCents({
        sizeCentiLots,
        contractSize: spec.contractSize,
        spreadPriceUnits,
        slippagePriceUnits,
        commissionPerLotCents: policy.costModel.commissionPerLotCents,
    });
    const lots = sizeCentiLots / CENTI_LOT;
    const spreadCostCents = Math.max(0, roundHalfAwayFromZero(spreadPriceUnits * lots * spec.contractSize * 100));
    const slippageCostCents = Math.max(0, roundHalfAwayFromZero(slippagePriceUnits * 2 * lots * spec.contractSize * 100));
    const commissionCents = Math.max(0, roundHalfAwayFromZero(policy.costModel.commissionPerLotCents * lots));

    const entryPriceMicros = toPriceMicros(quotePrice);
    const priceMicros = entryPriceMicros;

    return {
        entryPriceMicros,
        costs: { spreadCostCents, slippageCostCents, commissionCents },
        totalCostCents,
        riskCents: (stopLossMicros) =>
            plannedRiskCents({
                side,
                entryPriceMicros: priceMicros,
                stopLossMicros,
                sizeCentiLots,
                contractSize: spec.contractSize,
                costCents: totalCostCents,
            }),
        notionalCents: notionalCents({ priceMicros, sizeCentiLots, contractSize: spec.contractSize }),
    };
}

// ──────────── Exit / mark ────────────────────────────────────────────────────

export interface ExitResult {
    exitPriceMicros: number;
    grossPnLCents: number;
    netPnLCents: number;
}

/**
 * Compute a close at the given quote. Net = gross − recorded round-trip
 * costs (costs were fixed at entry — same convention as the backtester).
 */
export function computeExit(params: {
    side: "long" | "short";
    entryPriceMicros: number;
    sizeCentiLots: number;
    contractSize: number;
    quotePrice: number;
    costs: TradeFillCosts;
}): ExitResult {
    const { side, entryPriceMicros, sizeCentiLots, contractSize, quotePrice, costs } = params;
    const exitPriceMicros = toPriceMicros(quotePrice);
    const gross = grossPnLCents({ side, entryPriceMicros, exitPriceMicros, sizeCentiLots, contractSize });
    const totalCosts = costs.spreadCostCents + costs.slippageCostCents + costs.commissionCents;
    return { exitPriceMicros, grossPnLCents: gross, netPnLCents: gross - totalCosts };
}

/** Mark an open position at a live quote (unrealized, costs included). */
export function markPosition(params: {
    side: "long" | "short";
    entryPriceMicros: number;
    sizeCentiLots: number;
    contractSize: number;
    quotePrice: number | null;
    costs: TradeFillCosts;
}): { markPriceMicros: number | null; unrealizedPnLCents: number } {
    const { quotePrice } = params;
    if (quotePrice === null || !Number.isFinite(quotePrice)) {
        return { markPriceMicros: null, unrealizedPnLCents: 0 };
    }
    const exit = computeExit({ ...params, quotePrice });
    return { markPriceMicros: exit.exitPriceMicros, unrealizedPnLCents: exit.netPnLCents };
}

// ──────────── Pending orders (limit / stop) ──────────────────────────────────

export type PendingOrderType = "limit" | "stop";

export function pendingOrderSide(side: "long" | "short", orderType: PendingOrderType, limitPrice: number, quote: number): boolean {
    if (orderType === "limit") {
        return side === "long" ? quote <= limitPrice : quote >= limitPrice;
    }
    return side === "long" ? quote >= limitPrice : quote <= limitPrice;
}

// ──────────── Stop-loss / take-profit triggering ─────────────────────────────

export function stopLossHit(side: "long" | "short", stopLossMicros: number, quotePrice: number): boolean {
    const quote = toPriceMicros(quotePrice);
    return side === "long" ? quote <= stopLossMicros : quote >= stopLossMicros;
}

export function takeProfitHit(side: "long" | "short", takeProfitMicros: number, quotePrice: number): boolean {
    const quote = toPriceMicros(quotePrice);
    return side === "long" ? quote >= takeProfitMicros : quote <= takeProfitMicros;
}
