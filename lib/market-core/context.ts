/**
 * Market Intelligence Context — the structured facts bundle.
 *
 * Every consumer (chart panels, backtest, replay, alerts, strategies, AI)
 * reads THIS object. Fields are deterministic functions of canonical market
 * data; an AI model may interpret the bundle but can never contribute a raw
 * fact to it. Anything unknown is omitted (or null) — never guessed.
 */

import type { IndicatorEngine } from "./indicators/engine";
import { primarySession } from "./smart-money/sessions";
import { SMART_MONEY_VERSION, detectSmartMoney, visibleAsOf, type SmartMoneyDetection } from "./smart-money/engine";
import type { CoreCandle, MarketIntelligenceContext, SmartMoneyObject } from "./types";

export interface IntelligenceContextInput {
    candles: readonly CoreCandle[];
    symbol: string;
    timeframe: string;
    /** Pre-computed detection (chart reuse) — computed when omitted. */
    detection?: SmartMoneyDetection;
    /** Indicator engine whose configured instances feed `indicators`. */
    indicators?: IndicatorEngine | null;
}

export function buildIntelligenceContext(input: IntelligenceContextInput): MarketIntelligenceContext {
    const { candles, symbol, timeframe } = input;
    const detection = input.detection ?? detectSmartMoney(candles, { symbol, timeframe });
    const last = candles[candles.length - 1];
    const asOf = last ? last.timestamp : 0;

    const structureObjects = detection.structure.objects;
    const activeOrConfirmed = (o: SmartMoneyObject) => o.status === "active" || o.status === "confirmed" || o.status === "developing";

    const indicatorValues: Record<string, Record<string, number | null>> = {};
    const indicatorVersions: Record<string, string> = {};
    let atr: number | undefined;

    if (input.indicators) {
        for (const inst of input.indicators.describeInstances()) {
            const rows = input.indicators.getByKey(inst.key);
            const latest = rows.length > 0 ? rows[rows.length - 1] : null;
            indicatorValues[inst.key] = latest ? { ...latest.values } : {};
            indicatorVersions[inst.id] = inst.version;
            if (inst.id === "atr" && latest && typeof latest.values.value === "number") atr = latest.values.value;
        }
    }

    const range = detection.dealingRange;

    return {
        version: SMART_MONEY_VERSION,
        computedAt: Date.now(),
        market: {
            symbol: detection.symbol,
            timeframe: detection.timeframe,
            price: last ? last.close : 0,
            candleTimestamp: asOf,
            session: last ? primarySession(last.timestamp) : "closed",
        },
        structure: {
            bias: detection.structure.bias,
            events: structureObjects.filter((o) => o.kind === "bos" || o.kind === "choch" || o.kind === "hh" || o.kind === "hl" || o.kind === "lh" || o.kind === "ll"),
            ...(detection.structure.lastSwingHigh !== undefined ? { lastSwingHigh: detection.structure.lastSwingHigh } : {}),
            ...(detection.structure.lastSwingLow !== undefined ? { lastSwingLow: detection.structure.lastSwingLow } : {}),
        },
        liquidity: {
            pools: detection.pools.filter((o) => o.status !== "invalidated"),
            sweeps: detection.sweeps,
        },
        imbalances: {
            fvgs: detection.fvgs.filter(activeOrConfirmed),
        },
        orderBlocks: {
            active: detection.orderBlocks.filter(activeOrConfirmed),
            mitigated: detection.orderBlocks.filter((o) => o.status === "mitigated"),
        },
        premiumDiscount: {
            ...(range ? { rangeHigh: range.high, rangeLow: range.low, equilibrium: range.equilibrium, zone: range.zone } : { zone: "unknown" as const }),
        },
        indicators: indicatorValues,
        ...(atr !== undefined
            ? { volatility: { atr, atrPercent: last && last.close > 0 ? (atr / last.close) * 100 : undefined } }
            : { volatility: {} }),
        activeSetups: visibleAsOf(detection.objects, asOf).filter(
            (o) => (o.status === "active" || o.status === "confirmed") && (o.kind === "fvg" || o.kind === "order_block" || o.kind === "bos" || o.kind === "choch" || o.kind === "liquidity_sweep"),
        ),
        provenance: {
            indicatorVersions,
            smartMoneyVersion: SMART_MONEY_VERSION,
        },
    };
}
