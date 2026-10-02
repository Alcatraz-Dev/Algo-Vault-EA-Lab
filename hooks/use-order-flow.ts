"use client";

/**
 * useOrderFlow — live order-flow analytics over the canonical candle feed.
 *
 * Reads the SAME candles the chart renders (useLiveCandles) and derives the
 * honestly-computable subset: volume profile (POC/VAH/VAL/HVN/LVN), estimated
 * absorption/exhaustion events, capability-driven availability and a complete
 * OrderFlowContext for panels/AI. Delta/footprint/heatmap/GEX stay explicitly
 * UNAVAILABLE until a provider that supplies trades/L2/options is connected —
 * the hook never fabricates them.
 *
 * Recomputation is memoized on (symbol|timeframe|barCount|lastBarClose) so a
 * burst of live ticks coalesces into at most one profile recompute per change.
 */

import { useMemo } from "react";
import type { ChartCandle } from "@/lib/chart-engine/candle";
import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import {
    DEFAULT_ORDER_FLOW_SETTINGS,
    mergeOrderFlowSettings,
    orderFlowGate,
    type OrderFlowSettings,
} from "@/lib/order-flow/settings";
import {
    computeSessionProfile,
    computeDailyProfiles,
    detectAbsorption,
    detectExhaustion,
    computeEstimatedDelta,
    computeGex,
    buildOrderFlowContext,
} from "@/lib/order-flow/client-bridge";
import type { AbsorptionEvent, DeltaResult, ExhaustionEvent, GexResult, OrderFlowCapabilities, OrderFlowContext, VolumeProfileResult } from "@/lib/order-flow/types";

export interface UseOrderFlowResult {
    enabled: boolean;
    settings: OrderFlowSettings;
    /** Session (last UTC day) volume profile. Null when insufficient data. */
    sessionProfile: VolumeProfileResult | null;
    /** Daily profiles for the loaded window (bounded). */
    dailyProfiles: VolumeProfileResult[];
    absorptionEvents: AbsorptionEvent[];
    exhaustionEvents: ExhaustionEvent[];
    /**
     * Candle-derived ESTIMATED delta over the loaded window (null when the
     * true trade-grade delta is available or the feed has no volume). Rendered
     * only with its ESTIMATED label — never presented as bid/ask delta.
     */
    estimatedDelta: DeltaResult | null;
    /**
     * Real GEX result when an options chain is available (HIGH quality);
     * null otherwise — the layer renders unavailable, never estimated.
     */
    gex: GexResult | null;
    /** Full structured context (facts/interpretations/limitations). */
    context: OrderFlowContext | null;
    /** Candle count the current results were computed from. */
    computedFrom: number;
}

const MIN_BARS = 10;

export function useOrderFlow(
    symbol: SupportedSymbol | string,
    timeframe: Timeframe,
    candles: readonly (ChartCandle | MarketCandle)[],
    options?: {
        settings?: Partial<OrderFlowSettings>;
        mode?: "live" | "replay" | "historical";
        /**
         * Real options chain for GEX-capable symbols (from useOptionsChain).
         * When absent the GEX layer stays explicitly unavailable.
         */
        optionsChain?: {
            quotes: import("@/lib/order-flow/types").OptionQuote[];
            available: boolean;
            contractMultiplier?: number;
        } | null;
    },
): UseOrderFlowResult {
    const settings = useMemo(
        () => mergeOrderFlowSettings(options?.settings ?? {}),
        [options?.settings],
    );
    const masterOn = orderFlowGate("orderFlow.enabled");
    const profileOn = masterOn && orderFlowGate("orderFlow.volumeProfile");

    const last = candles.length > 0 ? candles[candles.length - 1] : null;
    // Deterministic memo key: identity changes only when the dataset meaningfully
    // changed (new bar or the forming bar's OHLCV moved).
    const memoKey = `${symbol}|${timeframe}|${candles.length}|${last ? `${last.close}|${last.volume ?? 0}` : ""}`;

    return useMemo(() => {
        const empty: UseOrderFlowResult = {
            enabled: masterOn,
            settings,
            sessionProfile: null,
            dailyProfiles: [],
            absorptionEvents: [],
            exhaustionEvents: [],
            estimatedDelta: null,
            gex: null,
            context: null,
            computedFrom: 0,
        };
        if (!masterOn || candles.length < MIN_BARS) return empty;

        const mode = options?.mode ?? "live";

        const sessionProfile = profileOn
            ? computeSessionProfile(candles, { symbol: String(symbol).toUpperCase(), timeframe, mode, bins: settings.profileBins, valueAreaPercent: settings.valueAreaPercent })
            : null;
        const dailyProfiles = profileOn
            ? computeDailyProfiles(candles, { symbol: String(symbol).toUpperCase(), timeframe, mode, bins: settings.profileBins, valueAreaPercent: settings.valueAreaPercent }).slice(-5)
            : [];

        const absorptionEvents = masterOn
            ? detectAbsorption(candles, { symbol: String(symbol).toUpperCase(), timeframe, mode, sensitivity: settings.absorptionSensitivity })
            : [];
        const exhaustionEvents = masterOn
            ? detectExhaustion(candles, { symbol: String(symbol).toUpperCase(), timeframe, mode, sensitivity: settings.exhaustionSensitivity })
            : [];

        // Estimated (candle-direction) delta — computed whenever the delta
        // gate is on and volume exists. When a real trade-grade feed supplies
        // delta the renderers prefer it and ignore this proxy.
        const estimatedDelta = masterOn && orderFlowGate("orderFlow.delta")
            ? computeEstimatedDelta(candles, { symbol: String(symbol).toUpperCase(), timeframe, mode })
            : null;

        // Per-symbol capability class: GEX-capable symbols add the options
        // capability when a real chain is present (never otherwise).
        const chain = options?.optionsChain ?? null;
        const gexQuotes = chain && chain.available && chain.quotes.length > 0 ? chain.quotes : [];
        const capabilities: OrderFlowCapabilities | undefined = gexQuotes.length > 0
            ? { candles: true, trades: false, bidAskClassification: false, bidAskQuotes: false, level2: false, historicalLevel2: false, options: true, openInterest: true, impliedVolatility: true }
            : undefined;

        const context = buildOrderFlowContext({
            symbol: String(symbol),
            timeframe,
            mode,
            // Render purity: the boundary is the LAST CANDLE's timestamp (a
            // stable value), never Date.now() during render.
            asOf: candles.length > 0 ? candles[candles.length - 1].timestamp : 0,
            candles,
            ...(gexQuotes.length > 0
                ? { options: gexQuotes, capabilities, gexContractMultiplier: chain?.contractMultiplier }
                : {}),
            settings: {
                valueAreaPercent: settings.valueAreaPercent,
                profileBins: settings.profileBins,
                absorptionSensitivity: settings.absorptionSensitivity,
                exhaustionSensitivity: settings.exhaustionSensitivity,
            },
            flags: {
                volumeProfile: profileOn,
                delta: masterOn && orderFlowGate("orderFlow.delta"),
                footprint: masterOn && orderFlowGate("orderFlow.footprint"),
                liquidity: masterOn && orderFlowGate("orderFlow.liquidity"),
                heatmap: masterOn && orderFlowGate("orderFlow.heatmap"),
                gex: masterOn && orderFlowGate("orderFlow.gex"),
            },
        });

        // Full GEX result for the chart renderer — computed from the same
        // validated quotes the context consumes (pure, deterministic engine).
        const gexResult = gexQuotes.length > 0
            ? computeGex(gexQuotes, {
                underlying: String(symbol).toUpperCase(),
                mode,
                ...(chain?.contractMultiplier !== undefined ? { contractMultiplier: chain.contractMultiplier } : {}),
            })
            : null;

        return {
            enabled: masterOn,
            settings,
            sessionProfile,
            dailyProfiles,
            absorptionEvents,
            exhaustionEvents,
            estimatedDelta: estimatedDelta && estimatedDelta.buckets.length > 0 ? estimatedDelta : null,
            gex: gexResult && gexResult.dataQuality === "HIGH" ? gexResult : null,
            context,
            computedFrom: candles.length,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memoKey, masterOn, profileOn, settings]);
}

export { DEFAULT_ORDER_FLOW_SETTINGS };
