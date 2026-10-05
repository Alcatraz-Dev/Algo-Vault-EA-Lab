/**
 * AlgoVault — Portfolio Exposure Engine (Phase 15 §6).
 *
 * PURE + DETERMINISTIC. Reads positions produced by the snapshot builder (which
 * reads real gateway records) and writes slices. No I/O, no AI, no clock.
 *
 * Definitions (documented so a reviewer can recompute any number by hand):
 *
 *   notional(p)      = currentPrice × |quantity| × contractSize
 *                      (the currency value of the position at the mark price)
 *   grossExposure    = Σ |notional(p)|
 *   netExposure      = Σ sign(p) × |notional(p)|      sign: +1 LONG, −1 SHORT
 *   grossWeight(k)   = Σ |notional(p)| over the slice / grossExposure
 *   signedWeight(k)  = Σ sign(p) × |notional(p)| over the slice / grossExposure
 *
 * Because account currency may differ from the position's currency, weights are
 * computed against the *portfolio base currency*. When an account currency is
 * unknown, the axis reports `UNAVAILABLE` with a reason rather than guessing.
 */

import { currencyWeights, instrumentMetadata, supportedAssetClasses, unsupportedAssetClasses } from "./instruments";
import type {
    AssetClass,
    DataFreshness,
    PortfolioAccount,
    PortfolioExposure,
    PortfolioExposureSlice,
    PortfolioPosition,
} from "./types";

interface SliceAccumulator {
    key: string;
    label: string;
    gross: number;
    signed: number;
    count: number;
}

function add(acc: Map<string, SliceAccumulator>, key: string, label: string, notional: number, sign: number): void {
    const entry = acc.get(key) ?? { key, label, gross: 0, signed: 0, count: 0 };
    entry.gross += Math.abs(notional);
    entry.signed += sign * Math.abs(notional);
    entry.count += 1;
    acc.set(key, entry);
}

function finalize(
    acc: Map<string, SliceAccumulator>,
    totalGross: number,
    directional: boolean
): PortfolioExposureSlice[] {
    return Array.from(acc.values())
        .map((e) => ({
            key: e.key,
            label: e.label,
            grossWeight: totalGross > 0 ? e.gross / totalGross : 0,
            signedWeight: totalGross > 0 ? e.signed / totalGross : null,
            grossNotional: e.gross,
            signedNotional: e.signed,
            positionCount: e.count,
            status: "AVAILABLE" as const,
        }))
        .sort((a, b) => b.grossWeight - a.grossWeight || a.key.localeCompare(b.key))
        .map((s) => (directional ? s : { ...s, signedWeight: null, signedNotional: 0 }));
}

const UNAVAILABLE_SLICE = (key: string, reason: string): PortfolioExposureSlice => ({
    key,
    label: key,
    grossWeight: 0,
    signedWeight: null,
    grossNotional: 0,
    signedNotional: 0,
    positionCount: 0,
    status: "UNAVAILABLE",
    reason,
});

/** Signed direction multiplier for a position. */
function signOf(side: PortfolioPosition["side"]): number {
    return side === "LONG" ? 1 : -1;
}

export interface ComputeExposureInput {
    portfolioId: string;
    positions: PortfolioPosition[];
    accounts: PortfolioAccount[];
    equity: number;
    calculatedAt: number;
    dataTimestamp: number;
    freshness: DataFreshness;
}

/**
 * Build the full exposure breakdown. When `positions` is empty the axes are
 * still returned (all zero weights) so downstream consumers never have to
 * special-case a brand-new portfolio.
 */
export function computeExposure(input: ComputeExposureInput): PortfolioExposure {
    const { positions, equity } = input;
    const limitations: string[] = [];

    let grossExposure = 0;
    let netExposure = 0;
    const bySymbol = new Map<string, SliceAccumulator>();
    const byAssetClass = new Map<string, SliceAccumulator>();
    const byCurrency = new Map<string, SliceAccumulator>();
    const byStrategy = new Map<string, SliceAccumulator>();
    const byAccount = new Map<string, SliceAccumulator>();
    const byDirection = new Map<string, SliceAccumulator>();

    let unknownAssetClassCount = 0;
    let currencyNotional = 0;
    const currencyUnavailableSymbols = new Set<string>();

    for (const pos of positions) {
        const notional = Number.isFinite(pos.notional) ? pos.notional : 0;
        const sign = signOf(pos.side);
        grossExposure += Math.abs(notional);
        netExposure += sign * Math.abs(notional);

        add(bySymbol, pos.symbol, pos.symbol, notional, sign);
        add(byAccount, pos.accountId, pos.accountId, notional, sign);
        add(byStrategy, pos.strategyId || "MANUAL", pos.strategyId || "MANUAL", notional, sign);
        add(byDirection, pos.side, pos.side === "LONG" ? "LONG" : "SHORT", notional, sign);

        if (pos.assetClass === "UNAVAILABLE") {
            unknownAssetClassCount += 1;
            add(byAssetClass, "UNAVAILABLE", "UNAVAILABLE", notional, sign);
        } else {
            add(byAssetClass, pos.assetClass, pos.assetClass, notional, sign);
        }

        const weights = currencyWeights(pos.symbol, notional);
        if (!weights) {
            currencyUnavailableSymbols.add(pos.symbol);
            continue;
        }
        for (const w of weights) {
            // Currency sensitivity follows the *direction* of the position: a
            // long EURUSD is long EUR and short USD.
            add(byCurrency, w.currency, w.currency, w.signed * sign, 1);
            currencyNotional += Math.abs(w.signed * sign);
        }
    }

    if (unknownAssetClassCount > 0) {
        limitations.push(
            `${unknownAssetClassCount} position(s) use symbols with no entry in the canonical instrument registry; their asset class is reported as UNAVAILABLE rather than estimated.`
        );
    }

    const symbolSlices = finalize(bySymbol, grossExposure, true);
    const assetClassSlices = finalize(byAssetClass, grossExposure, true);
    const strategySlices = finalize(byStrategy, grossExposure, true);
    const accountSlices = finalize(byAccount, grossExposure, true);
    const directionSlices = finalize(byDirection, grossExposure, true);

    // Currency axis is normalized against Σ|currency notional| (which is 2×
    // gross for FX pairs) so USD +42% / EUR −18% stays interpretable.
    const currencySlices =
        currencyNotional > 0
            ? Array.from(byCurrency.values())
                  .map((e) => ({
                      key: e.key,
                      label: e.key,
                      grossWeight: currencyNotional > 0 ? e.gross / currencyNotional : 0,
                      signedWeight: currencyNotional > 0 ? e.signed / currencyNotional : null,
                      grossNotional: e.gross,
                      signedNotional: e.signed,
                      positionCount: e.count,
                      status: "AVAILABLE" as const,
                  }))
                  .sort((a, b) => Math.abs(b.signedWeight ?? 0) - Math.abs(a.signedWeight ?? 0))
            : [UNAVAILABLE_SLICE("CURRENCY", currencyUnavailableSymbols.size > 0
                ? `No determinable currency split for: ${Array.from(currencyUnavailableSymbols).join(", ")}.`
                : "No open positions carry currency exposure.")];

    if (currencyUnavailableSymbols.size > 0) {
        limitations.push(
            `Currency exposure is partial: ${Array.from(currencyUnavailableSymbols).join(", ")} have no determinable currency split.`
        );
    }

    const grossToEquity = equity > 0 ? grossExposure / equity : null;
    const netToEquity = equity > 0 ? netExposure / equity : null;
    if (equity <= 0) {
        limitations.push("Equity is zero or unavailable — exposure ratios are reported as null rather than divided by zero.");
    }

    return {
        portfolioId: input.portfolioId,
        calculatedAt: input.calculatedAt,
        dataTimestamp: input.dataTimestamp,
        grossExposure,
        netExposure,
        grossToEquity,
        netToEquity,
        positionCount: positions.length,
        bySymbol: symbolSlices,
        byAssetClass: assetClassSlices,
        byCurrency: currencySlices,
        byStrategy: strategySlices,
        byAccount: accountSlices,
        byDirection: directionSlices,
        supportedAssetClasses: supportedAssetClasses(),
        unsupportedAssetClasses: unsupportedAssetClasses(),
        freshness: input.freshness,
        limitations,
    };
}

/**
 * Net exposure attributable to one symbol. Used by the trade pre-check to
 * express the *incremental* exposure a proposal adds.
 */
export function netExposureOfSymbol(
    exposure: PortfolioExposure,
    symbol: string
): { gross: number; signed: number } {
    const slice = exposure.bySymbol.find((s) => s.key === symbol);
    return { gross: slice?.grossNotional ?? 0, signed: slice?.signedNotional ?? 0 };
}

/** Share of gross exposure held by a currency (absolute, 0..1). */
export function currencyWeightOf(exposure: PortfolioExposure, currency: string): number | null {
    const slice = exposure.byCurrency.find((s) => s.key === currency);
    if (!slice || slice.status !== "AVAILABLE") return null;
    return slice.grossWeight;
}

/** Re-exported so callers do not need two imports for instrument facts. */
export { instrumentMetadata };
export type { AssetClass };
