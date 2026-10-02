/**
 * OrderFlowContext builder — the structured-facts contract for the AI signal
 * engine, Market Intelligence and the terminal panels.
 *
 * Replay-safety: `asOf` bounds every calculation. Callers pass only candles/
 * trades/snapshots with timestamp ≤ asOf; the builder re-asserts the boundary
 * defensively (extra filtering, not trust) so a future-leak upstream can never
 * leak through into AI evidence.
 *
 * Facts / Interpretations / Limitations mirror the existing Intelligence Layer
 * (lib/market-intelligence/ai/intelligence-layer.ts) and every fact traces to
 * structured event ids or calculation provenance.
 */

import type { Timeframe } from "@/lib/market-data/types";
import {
    canonicalOrderFlowProvider,
    resolveCapabilities,
} from "./normalizer";
import { deriveFeatureAvailability, worstQuality, type OrderFlowCapabilities, type OrderFlowContext, type OrderFlowDataQuality, type OrderFlowEvidence, type OrderFlowMode, type OrderFlowTrade } from "./types";
import { computeVolumeProfile } from "./volume-profile";
import { computeDelta, detectDeltaDivergences, type DeltaOptions } from "./delta";
import { computeEstimatedDelta, detectEstimatedDeltaDivergences, ESTIMATED_DELTA_METHOD } from "./delta-proxy";
import { computeFootprint } from "./footprint";
import { detectAbsorption } from "./absorption";
import { detectExhaustion } from "./exhaustion";
import { detectLargeTrades } from "./large-trades";
import { detectLiquidityEvents, detectSweepsAndReplenishment, buildHeatmapState, type LiquidityOptions } from "./liquidity";
import { computeGex } from "./gex/calculator";
import type { L2Snapshot, OptionQuote } from "./types";
import type { MarketCandle } from "@/lib/market-data/types";
import type { ChartCandle } from "@/lib/chart-engine/candle";

export interface OrderFlowContextInput {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    /** Boundary timestamp — everything later is defensively dropped. */
    asOf: number;
    /** Canonical candles (OHLCV). Candles AFTER asOf are dropped. */
    candles: readonly (ChartCandle | MarketCandle)[];
    /** Classified trades (aggressor or tick-rule classified). */
    trades?: readonly OrderFlowTrade[];
    /** L2 snapshots (real order book). */
    l2Snapshots?: readonly L2Snapshot[];
    /** Validated options quotes. */
    options?: readonly OptionQuote[];
    /**
     * Capability override for per-symbol providers (e.g. candles + options).
     * When omitted, the canonical candle-only provider is used.
     */
    capabilities?: OrderFlowCapabilities;
    /**
     * Contract multiplier for the GEX calculator (default 100). Crypto chains
     * (Deribit) use 1 contract = 1 coin → multiplier 1.
     */
    gexContractMultiplier?: number;
    /** Feature flags applied on top of capability detection. */
    flags?: {
        volumeProfile?: boolean;
        delta?: boolean;
        footprint?: boolean;
        liquidity?: boolean;
        heatmap?: boolean;
        gex?: boolean;
    };
    settings?: {
        valueAreaPercent?: number;
        profileBins?: number;
        imbalanceThreshold?: number;
        stackedImbalanceLevels?: number;
        absorptionSensitivity?: number;
        exhaustionSensitivity?: number;
        largeTradeAbsoluteThreshold?: number;
        largeTradePercentile?: number;
        largeTradeRollingMultiple?: number;
        liquidityWallThreshold?: number;
        heatmapHistoryDepth?: number;
    };
}

/**
 * Build the complete OrderFlowContext. Deterministic for a given input; safe
 * for replay (asOf enforced internally) and for live (asOf = now).
 */
export function buildOrderFlowContext(input: OrderFlowContextInput): OrderFlowContext {
    const asOf = input.asOf;
    const symbol = input.symbol.toUpperCase();
    const timeframe = input.timeframe;
    const mode = input.mode;

    // Defensive future-leak filter — never trust the caller's truncation.
    const candles = input.candles.filter((c) => c.timestamp <= asOf);
    const trades = (input.trades ?? []).filter((t) => t.timestamp <= asOf);
    const snapshots = (input.l2Snapshots ?? []).filter((s) => s.timestamp <= asOf);
    const optionQuotes = input.options ?? [];

    const caps: OrderFlowCapabilities = input.capabilities ?? resolveCapabilities(canonicalOrderFlowProvider);
    const availability = deriveFeatureAvailability(caps);
    const flags = input.flags ?? {};
    const settings = input.settings ?? {};

    const limitations: string[] = [];
    const facts: OrderFlowEvidence[] = [];
    const interpretations: OrderFlowEvidence[] = [];

    // ── volume profile (candle-grade) ────────────────────────────────────
    let vpResult: ReturnType<typeof computeVolumeProfile> | null = null;
    if (availability.volumeProfile.quality !== "UNAVAILABLE" && flags.volumeProfile !== false && candles.length > 0) {
        vpResult = computeVolumeProfile(candles, {
            kind: "session",
            symbol,
            timeframe,
            mode,
            bins: settings.profileBins ?? 48,
            valueAreaPercent: settings.valueAreaPercent ?? 70,
        });
        if (vpResult.barCount === 0) vpResult = null;
    }

    // ── delta (trade-grade, with candle-proxy fallback) ─────────────────
    // True delta wins whenever classified trades exist. Candle-only feeds get
    // the documented ESTIMATED body-direction proxy (delta-proxy.ts) — clearly
    // labelled, never merged with or presented as bid/ask delta.
    const deltaEnabled = flags.delta !== false;
    const deltaResult = deltaEnabled && trades.length > 0
        ? computeDelta(trades, { symbol, timeframe, mode } satisfies DeltaOptions)
        : null;
    const estimatedDeltaResult = deltaEnabled && deltaResult === null && availability.delta.quality === "ESTIMATED" && candles.length > 0
        ? computeEstimatedDelta(candles, { symbol, timeframe, mode })
        : null;
    const activeDelta = deltaResult ?? estimatedDeltaResult;
    if (deltaResult) {
        const divergences = detectDeltaDivergences(deltaResult, divergencePrices(candles, deltaResult.buckets.map((b) => b.timestamp)), { symbol, timeframe, mode });
        if (divergences.length > 0) {
            facts.push({ kind: "FACT", text: `Delta divergence detected: ${divergences[divergences.length - 1].type}.`, sourceIds: divergences.slice(-3).map((d) => d.id) });
        }
    } else if (estimatedDeltaResult && estimatedDeltaResult.buckets.length > 0) {
        const divergences = detectEstimatedDeltaDivergences(estimatedDeltaResult, estimatedDeltaResult.buckets.map((b) => {
            const c = candles.find((x) => x.timestamp === b.timestamp);
            return c?.close ?? 0;
        }), { symbol, timeframe, mode });
        if (divergences.length > 0) {
            const last = divergences[divergences.length - 1];
            facts.push({ kind: "FACT", text: `Estimated delta divergence detected (${ESTIMATED_DELTA_METHOD}): ${last.type}. Not bid/ask evidence.`, sourceIds: divergences.slice(-3).map((d) => d.id) });
        }
    }

    // ── footprint (trade-grade) ─────────────────────────────────────────
    const footprintResult = deltaEnabled && trades.length > 0 ? computeFootprint(trades, { symbol, timeframe, mode, density: 8 }) : null;

    // ── events from candles (ESTIMATED) ─────────────────────────────────
    const absorptionEvents = flags.volumeProfile !== false
        ? detectAbsorption(candles, { symbol, timeframe, mode, sensitivity: settings.absorptionSensitivity ?? 0.5 })
        : [];
    const exhaustionEvents = flags.volumeProfile !== false
        ? detectExhaustion(candles, { symbol, timeframe, mode, sensitivity: settings.exhaustionSensitivity ?? 0.5 })
        : [];

    // ── large trades (trade-grade) ──────────────────────────────────────
    const largeTradeEvents = trades.length > 0
        ? detectLargeTrades(trades, {
            symbol, timeframe, mode,
            absoluteThreshold: settings.largeTradeAbsoluteThreshold ?? 0,
            percentile: settings.largeTradePercentile ?? 0.98,
            rollingMultiple: settings.largeTradeRollingMultiple ?? 8,
        })
        : [];

    // ── liquidity + heatmap (L2-grade) ──────────────────────────────────
    const liquidityEnabled = flags.liquidity !== false;
    const liquidityEvents = liquidityEnabled && snapshots.length > 0
        ? [...detectLiquidityEvents(snapshots, { symbol, timeframe, mode, wallThreshold: settings.liquidityWallThreshold ?? 0 } satisfies LiquidityOptions), ...detectSweepsAndReplenishment(snapshots, { symbol, timeframe, mode, wallThreshold: 0 })]
        : [];
    const heatmapState = flags.heatmap !== false && snapshots.length > 0
        ? buildHeatmapState(snapshots.slice(-Math.max(1, settings.heatmapHistoryDepth ?? 120)), { symbol, timeframe, mode })
        : null;

    // ── GEX (options-grade) ─────────────────────────────────────────────
    const gexResult = flags.gex !== false && optionQuotes.length > 0
        ? computeGex(optionQuotes, {
            underlying: symbol,
            mode,
            ...(input.gexContractMultiplier !== undefined ? { contractMultiplier: input.gexContractMultiplier } : {}),
        })
        : null;

    // ── data quality ────────────────────────────────────────────────────
    let dataQuality: OrderFlowDataQuality = "UNAVAILABLE";
    if (vpResult) dataQuality = worstQuality(dataQuality === "UNAVAILABLE" ? "ESTIMATED" : dataQuality, "ESTIMATED");
    if (deltaResult) dataQuality = "HIGH";
    else if (activeDelta && candles.length > 0) dataQuality = worstQuality(dataQuality === "UNAVAILABLE" ? "ESTIMATED" : dataQuality, "ESTIMATED");
    if (snapshots.length > 0) dataQuality = "HIGH";

    // ── facts / interpretations / limitations ───────────────────────────
    if (candles.length > 0) {
        const last = candles[candles.length - 1];
        facts.push({ kind: "FACT", text: `${candles.length} candles available through ${new Date(asOf).toISOString()}.`, sourceIds: [] });
        if (vpResult?.poc != null) {
            const rel = last.close > vpResult.poc ? "above" : last.close < vpResult.poc ? "below" : "at";
            facts.push({ kind: "FACT", text: `Price is ${rel} session POC (${vpResult.poc}).`, sourceIds: [vpResult.profileId] });
            facts.push({ kind: "FACT", text: `VAH ${vpResult.vah}, VAL ${vpResult.val} (value area ${vpResult.valueAreaPercent}%).`, sourceIds: [vpResult.profileId] });
            if (rel === "above" && vpResult.vah != null && last.close > vpResult.vah) {
                interpretations.push({ kind: "INTERPRETATION", text: "Price accepted above the value area — order-flow participation currently supports upward acceptance.", sourceIds: [vpResult.profileId] });
            } else if (rel === "below" && vpResult.val != null && last.close < vpResult.val) {
                interpretations.push({ kind: "INTERPRETATION", text: "Price accepted below the value area — order-flow participation currently supports downward acceptance.", sourceIds: [vpResult.profileId] });
            }
        }
    }
    if (deltaResult) {
        facts.push({ kind: "FACT", text: `Delta ${deltaResult.delta >= 0 ? "+" : ""}${deltaResult.delta} (buy ${deltaResult.buyVolume} / sell ${deltaResult.sellVolume}), cumulative ${deltaResult.cumulativeDelta >= 0 ? "+" : ""}${deltaResult.cumulativeDelta}.`, sourceIds: ["delta-engine"] });
    } else if (estimatedDeltaResult && estimatedDeltaResult.buckets.length > 0) {
        facts.push({ kind: "FACT", text: `Estimated delta ${estimatedDeltaResult.delta >= 0 ? "+" : ""}${estimatedDeltaResult.delta.toFixed(0)} (candle-direction volume pressure), cumulative ${estimatedDeltaResult.cumulativeDelta >= 0 ? "+" : ""}${estimatedDeltaResult.cumulativeDelta.toFixed(0)} — proxy model, not bid/ask delta.`, sourceIds: [ESTIMATED_DELTA_METHOD] });
    } else {
        limitations.push("True bid/ask delta unavailable — the current provider does not classify trade sides.");
    }
    if (!availability.footprint || availability.footprint.quality === "UNAVAILABLE") {
        limitations.push("True footprint unavailable without bid/ask classified trades.");
    }
    if (absorptionEvents.length > 0) {
        facts.push({ kind: "FACT", text: `${absorptionEvents.length} absorption event(s) detected from volume/price behaviour (estimated).`, sourceIds: absorptionEvents.slice(-3).map((e) => e.id) });
    }
    if (exhaustionEvents.length > 0) {
        facts.push({ kind: "FACT", text: `${exhaustionEvents.length} exhaustion event(s) detected from extension/volume evidence (estimated).`, sourceIds: exhaustionEvents.slice(-3).map((e) => e.id) });
    }
    if (liquidityEvents.length > 0) {
        facts.push({ kind: "FACT", text: `${liquidityEvents.length} L2 liquidity event(s) recorded.`, sourceIds: liquidityEvents.slice(-3).map((e) => e.id) });
    }
    if (!liquidityEnabled || snapshots.length === 0) {
        limitations.push("Historical Level 2 data unavailable — liquidity heatmap and order-book events cannot be computed.");
    }
    if (!gexResult || gexResult.dataQuality === "INSUFFICIENT_HISTORY") {
        limitations.push("GEX unavailable — requires options chain with open interest and implied volatility.");
    }

    // ── confluence ──────────────────────────────────────────────────────
    const confluence = buildOrderFlowConfluence({
        candles,
        vp: vpResult ? { poc: vpResult.poc, vah: vpResult.vah, val: vpResult.val } : null,
        // The active delta (true when trades exist, else the ESTIMATED proxy)
        // feeds confluence as directional evidence; provenance stays on the
        // context (deltaEstimated.*) so consumers can weigh it accordingly.
        delta: activeDelta ? { delta: activeDelta.delta, cumulative: activeDelta.cumulativeDelta } : null,
        imbalances: footprintResult ? footprintResult.bars.flatMap((b) => b.imbalances) : [],
        liquidityEvents,
        absorptionEvents,
        exhaustionEvents,
        largeTrades: largeTradeEvents,
    });

    return {
        symbol,
        timeframe,
        mode,
        asOf,
        capabilities: caps,
        featureAvailability: availability,
        dataQuality,
        delta: {
            // "available" = true trade-grade delta only. The estimated proxy
            // is reported through deltaEstimated so consumers can never
            // mistake proxy pressure for real aggressor flow.
            available: deltaResult !== null,
            value: deltaResult?.delta ?? null,
            cumulative: deltaResult?.cumulativeDelta ?? null,
            deltaPercent: deltaResult?.deltaPercent ?? null,
            method: deltaResult?.method ?? null,
        },
        deltaEstimated: {
            available: estimatedDeltaResult !== null && estimatedDeltaResult.buckets.length > 0,
            value: estimatedDeltaResult?.delta ?? null,
            cumulative: estimatedDeltaResult?.cumulativeDelta ?? null,
            deltaPercent: estimatedDeltaResult?.deltaPercent ?? null,
            method: estimatedDeltaResult?.method ?? null,
            dataQuality: estimatedDeltaResult?.dataQuality ?? "UNAVAILABLE",
        },
        volumeProfile: {
            available: vpResult !== null,
            kind: vpResult?.kind ?? null,
            poc: vpResult?.poc ?? null,
            vah: vpResult?.vah ?? null,
            val: vpResult?.val ?? null,
            hvn: vpResult?.hvn ?? [],
            lvn: vpResult?.lvn ?? [],
            priceRelation: vpResult?.poc != null
                ? candles[candles.length - 1].close > vpResult.poc ? "above_poc" : candles[candles.length - 1].close < vpResult.poc ? "below_poc" : "inside_value_area"
                : null,
            method: vpResult?.method ?? null,
        },
        footprint: {
            available: footprintResult !== null,
            method: footprintResult?.method ?? null,
            recentBars: footprintResult?.bars.length ?? 0,
        },
        imbalances: {
            available: footprintResult !== null,
            recent: footprintResult ? footprintResult.bars.flatMap((b) => b.imbalances).slice(-12) : [],
        },
        absorption: { available: true, recent: absorptionEvents.slice(-6) },
        exhaustion: { available: true, recent: exhaustionEvents.slice(-6) },
        largeTrades: { available: trades.length > 0, recent: largeTradeEvents.slice(-6) },
        liquidity: { available: snapshots.length > 0, recentEvents: liquidityEvents.slice(-10) },
        heatmap: { available: heatmapState !== null, cellCount: heatmapState?.cells.length ?? 0 },
        gex: {
            available: gexResult !== null && gexResult.dataQuality === "HIGH",
            netGex: gexResult?.netGex ?? null,
            gammaFlip: gexResult?.gammaFlip ?? null,
            callWalls: gexResult?.callWalls.map((w) => w.strike) ?? [],
            putWalls: gexResult?.putWalls.map((w) => w.strike) ?? [],
            method: gexResult?.method ?? null,
        },
        confluence,
        facts,
        interpretations,
        limitations,
    };
}

// ── confluence ───────────────────────────────────────────────────────────────

export interface ConfluenceInput {
    candles: readonly { close: number }[];
    vp: { poc: number | null; vah: number | null; val: number | null } | null;
    delta: { delta: number; cumulative: number } | null;
    imbalances: ReadonlyArray<{ type: string }>;
    liquidityEvents: ReadonlyArray<{ type: string; side: string }>;
    absorptionEvents: ReadonlyArray<{ type: string }>;
    exhaustionEvents: ReadonlyArray<{ type: string }>;
    largeTrades: ReadonlyArray<{ type: string }>;
}

/**
 * Order Flow confluence — evidence aggregation, NOT an unconditional rule.
 * Bullish/bearish evidence lists are returned for the AI to weigh alongside
 * Smart Money evidence; conflicts are explicit.
 */
export function buildOrderFlowConfluence(input: ConfluenceInput): import("./types").OrderFlowConfluenceResult {
    const bull: string[] = [];
    const bear: string[] = [];
    const conflicts: string[] = [];
    const last = input.candles.length > 0 ? input.candles[input.candles.length - 1] : null;

    if (input.vp?.poc != null && last) {
        if (last.close > input.vp.poc) bull.push("PRICE_ABOVE_POC");
        else if (last.close < input.vp.poc) bear.push("PRICE_BELOW_POC");
    }
    if (input.delta) {
        if (input.delta.delta > 0) bull.push("POSITIVE_DELTA");
        else if (input.delta.delta < 0) bear.push("NEGATIVE_DELTA");
        if (input.delta.cumulative > 0) bull.push("POSITIVE_CUM_DELTA");
        else if (input.delta.cumulative < 0) bear.push("NEGATIVE_CUM_DELTA");
    }
    for (const imb of input.imbalances.slice(-8)) {
        if (imb.type === "STACKED_BUY_IMBALANCE" || imb.type === "BUY_IMBALANCE") bull.push(imb.type);
        if (imb.type === "STACKED_SELL_IMBALANCE" || imb.type === "SELL_IMBALANCE") bear.push(imb.type);
    }
    for (const e of input.liquidityEvents.slice(-8)) {
        if (e.type === "LIQUIDITY_WALL") {
            if (e.side === "bid") bull.push("LIQUIDITY_SUPPORT");
            else bear.push("LIQUIDITY_RESISTANCE");
        }
    }
    for (const a of input.absorptionEvents.slice(-4)) {
        // Absorption is *counter*-evidence: buying absorbed is bearish pressure.
        if (a.type === "BUY_ABSORPTION") bear.push("BUY_SIDE_ABSORBED");
        else bull.push("SELL_SIDE_ABSORBED");
    }
    for (const e of input.exhaustionEvents.slice(-4)) {
        if (e.type === "BUY_EXHAUSTION") conflicts.push("BUY_EXHAUSTION — upward move showing exhaustion evidence");
        else conflicts.push("SELL_EXHAUSTION — downward move showing exhaustion evidence");
    }
    for (const t of input.largeTrades.slice(-4)) {
        if (t.type === "LARGE_BUY") bull.push("LARGE_BUY");
        else bear.push("LARGE_SELL");
    }

    const score = Math.round((bull.length / Math.max(1, bull.length + bear.length)) * 100);
    const direction = bull.length === 0 && bear.length === 0 ? "neutral" : score >= 65 ? "bullish" : score <= 35 ? "bearish" : "neutral";

    return { direction, score, bullEvidence: bull, bearEvidence: bear, conflicts };
}

// ── internal adapters ────────────────────────────────────────────────────────

/** Prices aligned to delta-bucket timestamps (last close within each bucket). */
function divergencePrices(candles: readonly { timestamp: number; close: number }[], bucketTimestamps: number[]): number[] {
    if (bucketTimestamps.length === 0) return [];
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const out: number[] = [];
    let ci = 0;
    for (const bt of bucketTimestamps) {
        while (ci < sorted.length - 1 && sorted[ci + 1].timestamp <= bt) ci += 1;
        out.push(sorted[ci]?.close ?? sorted[sorted.length - 1]?.close ?? 0);
    }
    return out;
}
