/**
 * Developer / debug mode for chart intelligence.
 *
 * Disabled by default for normal users. Enable with:
 *   • browser:  localStorage.setItem("algovault_market_core_debug", "1")
 *   • server:   MARKET_CORE_DEBUG=1
 *
 * When enabled, surfaces can render an inspector showing candle identity,
 * indicator rows, overlay coordinates, structure source candles,
 * confirmation timestamps and calculation versions — enough to answer
 * "why did this object appear here?" without reading the source.
 */

import type { IndicatorEngine } from "./indicators/engine";
import type { MarketOverlay, CoreCandle, SmartMoneyObject } from "./types";
import { indicatorRegistry } from "./registry";
import "./indicators/definitions"; // ensure built-ins are registered

const STORAGE_KEY = "algovault_market_core_debug";
let forcedFlag: boolean | null = null;

export function setMarketCoreDebug(enabled: boolean): void {
    forcedFlag = enabled;
}

export function isMarketCoreDebug(): boolean {
    if (forcedFlag !== null) return forcedFlag;
    try {
        if (typeof window !== "undefined" && typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1") return true;
    } catch {
        // SSR / storage blocked — fall through to env.
    }
    try {
        return process.env.MARKET_CORE_DEBUG === "1";
    } catch {
        return false;
    }
}

export interface CandleDebug {
    index: number;
    timestamp: number;
    iso: string;
    symbol?: string;
    timeframe?: string;
    finalized: boolean;
    ohlc: [number, number, number, number];
    volume: number;
}

export function describeCandle(candle: CoreCandle, index: number): CandleDebug {
    return {
        index,
        timestamp: candle.timestamp,
        iso: new Date(candle.timestamp).toISOString(),
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        finalized: Boolean(candle.finalized),
        ohlc: [candle.open, candle.high, candle.low, candle.close],
        volume: candle.volume ?? 0,
    };
}

export interface OverlayDebug {
    id: string;
    type: string;
    layer: string;
    priority: string;
    symbol: string;
    timeframe: string;
    startTimeIso: string;
    endTimeIso: string | null;
    priceStart: number | null;
    priceEnd: number | null;
    status: string | null;
    confirmationAtIso: string | null;
}

export function describeOverlay(overlay: MarketOverlay): OverlayDebug {
    return {
        id: overlay.id,
        type: overlay.type,
        layer: overlay.layer,
        priority: overlay.priority ?? "layer-default",
        symbol: overlay.symbol,
        timeframe: overlay.timeframe,
        startTimeIso: new Date(overlay.startTime).toISOString(),
        endTimeIso: overlay.endTime !== undefined ? new Date(overlay.endTime).toISOString() : null,
        priceStart: overlay.priceStart ?? null,
        priceEnd: overlay.priceEnd ?? null,
        status: typeof overlay.metadata?.status === "string" ? overlay.metadata.status : null,
        confirmationAtIso:
            typeof overlay.metadata?.confirmationAt === "number"
                ? new Date(overlay.metadata.confirmationAt as number).toISOString()
                : null,
    };
}

export interface SmartMoneyDebug {
    id: string;
    kind: string;
    status: string;
    direction: string;
    detectedAtIso: string;
    confirmationAtIso: string;
    price: number | null;
    bounds: [number, number] | null;
    sourceCandles: string[];
    strength: number | null;
    invalidationCondition: string | null;
}

export function describeSmartMoney(obj: SmartMoneyObject): SmartMoneyDebug {
    return {
        id: obj.id,
        kind: obj.kind,
        status: obj.status,
        direction: obj.direction,
        detectedAtIso: new Date(obj.detectedAt).toISOString(),
        confirmationAtIso: new Date(obj.confirmationAt).toISOString(),
        price: obj.price ?? null,
        bounds: obj.priceHigh !== undefined && obj.priceLow !== undefined ? [obj.priceHigh, obj.priceLow] : null,
        sourceCandles: obj.sourceCandles.map((t) => new Date(t).toISOString()),
        strength: obj.strength ?? null,
        invalidationCondition:
            obj.kind === "fvg"
                ? "close beyond the gap origin"
                : obj.kind === "order_block"
                    ? "close beyond the block extreme"
                    : obj.kind === "liquidity_pool" || obj.kind === "equal_highs" || obj.kind === "equal_lows"
                        ? "swept (level traded through and closed back)"
                        : null,
    };
}

export interface IndicatorDebug {
    key: string;
    id: string;
    name: string;
    version: string;
    params: Record<string, number>;
    rows: number;
    firstValue: number | null;
    lastValue: number | null;
    warmup: number;
}

export function describeIndicators(engine: IndicatorEngine): IndicatorDebug[] {
    return engine.describeInstances().map((inst) => {
        const def = indicatorRegistry.get(inst.id);
        return {
            ...inst,
            warmup: def ? def.warmup(inst.params) : 0,
        };
    });
}

/** Full inspector payload for a chart surface (only when debug is on). */
export function debugSnapshot(input: {
    candles: readonly CoreCandle[];
    indicators?: IndicatorEngine | null;
    overlays?: readonly MarketOverlay[];
    smartMoney?: readonly SmartMoneyObject[];
}): Record<string, unknown> {
    const last = input.candles[input.candles.length - 1];
    return {
        candles: {
            count: input.candles.length,
            first: input.candles[0] ? describeCandle(input.candles[0], 0) : null,
            last: last ? describeCandle(last, input.candles.length - 1) : null,
        },
        indicators: input.indicators ? describeIndicators(input.indicators) : [],
        overlays: (input.overlays ?? []).slice(0, 50).map(describeOverlay),
        smartMoney: (input.smartMoney ?? []).slice(0, 50).map(describeSmartMoney),
    };
}
