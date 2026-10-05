import type { ChartCandle } from "./candle";
import type { Timeframe } from "../market-data/types";
import { indicatorRegistry } from "../market-core/registry";
import { IndicatorEngine } from "../market-core/indicators/engine";
import { detectSmartMoney } from "../market-core/smart-money/engine";

/**
 * Overlay & indicator contracts — Phases 14/15/16/18 + Phase 3 consolidation.
 *
 * Indicators and overlays NEVER touch canvas or React. They receive canonical
 * candles and return pure data series/zones/events; the renderer draws them.
 * Since Phase 3 all indicator math and all Smart Money structure detection
 * delegate to the ONE Market Intelligence Core (`lib/market-core`) — this
 * module is only the chart-facing adapter (series shape + colors).
 */

// ── indicator series (Phase 14) ─────────────────────────────────────────────

export type IndicatorId = string;

export interface IndicatorSeries {
    id: IndicatorId;
    /** Values aligned 1:1 with the candle snapshot (null = not computed yet). */
    values: Array<number | null>;
    color: string;
    lineWidth: 1 | 2 | 3;
    /** Render on the price pane (true) or a sub-pane (false, future). */
    overlay: boolean;
    label: string;
}

export interface IndicatorDefinition {
    id: IndicatorId;
    label: string;
    color: string;
    overlay: boolean;
    params?: Record<string, number>;
    compute: (candles: readonly ChartCandle[], params: Record<string, number>) => Array<number | null>;
}

/**
 * Registry of deterministic indicator implementations. The chart keeps its
 * legacy ids/colors here, but every `compute` delegates to the core
 * IndicatorEngine (`lib/market-core/indicators`) so a plotted line always
 * equals the platform's measured value — no duplicate indicator math.
 */
interface ChartIndicatorBinding {
    /** Core registry id (`ema`, `sma`, `rsi`, …). */
    coreId: string;
    /** Core output key to plot. */
    output: string;
    engineCache: WeakMap<readonly ChartCandle[], Map<string, Array<number | null>>>;
}

const coreBindings = new Map<IndicatorId, ChartIndicatorBinding>();

function bindCore(id: IndicatorId, coreId: string, output: string): void {
    coreBindings.set(id, { coreId, output, engineCache: new WeakMap() });
}

bindCore("ema20", "ema", "value");
bindCore("ema50", "ema", "value");
bindCore("sma20", "sma", "value");
bindCore("rsi", "rsi", "value");

/** Compute one legacy chart indicator through the core engine (memoized). */
function computeThroughCore(
    candles: readonly ChartCandle[],
    id: IndicatorId,
    params: Record<string, number>,
): Array<number | null> {
    const binding = coreBindings.get(id);
    if (!binding) return new Array(candles.length).fill(null);
    const def = indicatorRegistry.get(binding.coreId);
    if (!def) return new Array(candles.length).fill(null);

    let byKey = binding.engineCache.get(candles);
    if (!byKey) {
        byKey = new Map();
        binding.engineCache.set(candles, byKey);
    }
    const cacheKey = `${binding.coreId}|${JSON.stringify(params)}`;
    const cached = byKey.get(cacheKey);
    if (cached) return cached;

    const first = candles[0];
    const engine = new IndicatorEngine({
        symbol: first?.symbol ?? "UNKNOWN",
        timeframe: first?.timeframe ?? "M5",
        indicators: [{ id: binding.coreId, params }],
    });
    engine.setSeries(candles);
    const aligned = engine.getOutputAligned(
        { id: binding.coreId, params },
        binding.output,
        candles.map((c) => c.timestamp),
    );
    byKey.set(cacheKey, aligned);
    return aligned;
}

export const CHART_INDICATORS: Record<IndicatorId, IndicatorDefinition> = {
    ema20: {
        id: "ema20",
        label: "EMA 20",
        color: "#38bdf8",
        overlay: true,
        params: { period: 20 },
        compute: (candles, p) => computeThroughCore(candles, "ema20", p),
    },
    ema50: {
        id: "ema50",
        label: "EMA 50",
        color: "#a78bfa",
        overlay: true,
        params: { period: 50 },
        compute: (candles, p) => computeThroughCore(candles, "ema50", p),
    },
    sma20: {
        id: "sma20",
        label: "SMA 20",
        color: "#94a3b8",
        overlay: true,
        params: { period: 20 },
        compute: (candles, p) => computeThroughCore(candles, "sma20", p),
    },
    rsi: {
        id: "rsi",
        label: "RSI 14",
        color: "#c084fc",
        overlay: false,
        params: { period: 14 },
        compute: (candles, p) => computeThroughCore(candles, "rsi", p),
    },
};

/** Compute an enabled indicator set over a candle snapshot. */
export function computeIndicatorSeries(
    candles: readonly ChartCandle[],
    enabledIds: Iterable<IndicatorId>,
): IndicatorSeries[] {
    const out: IndicatorSeries[] = [];
    for (const id of enabledIds) {
        const def = CHART_INDICATORS[id];
        if (!def) continue;
        out.push({
            id: def.id,
            values: def.compute(candles, def.params ?? {}),
            color: def.color,
            lineWidth: 2,
            overlay: def.overlay,
            label: def.label,
        });
    }
    return out;
}

// ── smart money / structure overlays (Phase 15) ─────────────────────────────

/** Normalized structure event drawable on the chart. */
export interface StructureOverlayEvent {
    kind: "BOS" | "CHOCH" | "HH" | "HL" | "LH" | "LL" | "swing_high" | "swing_low";
    direction: "bullish" | "bearish";
    /** Price level of the event (line price or swing price). */
    price: number;
    /** Candle opening time the event anchors to. */
    timestamp: number;
    /** Broken level for BOS/CHOCH lines (from → to). */
    brokenLevel?: number;
    id: string;
}

/**
 * Deterministic structure overlay source.
 *
 * Since Phase 3 this delegates to the ONE Smart Money engine
 * (`lib/market-core/smart-money`) — the same detector the dashboard, the
 * backtester, alerts and the AI context consume. The chart therefore draws
 * exactly what the engines measure: no chart-local reimplementation, no LLM
 * output, fully deterministic, timestamp-anchored and confirmation-aware.
 *
 * `bias` is derived from the most recent break directions.
 */
export function computeStructureOverlay(
    candles: readonly ChartCandle[],
    timeframe: Timeframe,
): { events: StructureOverlayEvent[]; bias: "bullish" | "bearish" | "neutral" } {
    if (candles.length === 0) return { events: [], bias: "neutral" };
    const symbol = candles[0].symbol ?? "UNKNOWN";
    const detection = detectSmartMoney(candles, {
        symbol,
        timeframe,
        structure: true,
        liquidity: false,
        zones: false,
        orderBlocks: false,
        sessions: false,
    });

    const kindMap: Record<string, StructureOverlayEvent["kind"]> = {
        bos: "BOS",
        choch: "CHOCH",
        hh: "HH",
        hl: "HL",
        lh: "LH",
        ll: "LL",
        swing_high: "swing_high",
        swing_low: "swing_low",
    };

    const events: StructureOverlayEvent[] = [];
    for (const obj of detection.objects) {
        const kind = kindMap[obj.kind];
        if (!kind) continue;
        const brokenLevel =
            obj.kind === "bos" || obj.kind === "choch"
                ? typeof obj.metadata?.brokenLevel === "number"
                    ? obj.metadata.brokenLevel
                    : undefined
                : undefined;
        events.push({
            kind,
            direction: obj.direction === "bearish" ? "bearish" : "bullish",
            price: obj.price ?? obj.priceHigh ?? 0,
            timestamp: obj.detectedAt,
            ...(brokenLevel !== undefined ? { brokenLevel } : {}),
            id: obj.id,
        });
    }

    return { events, bias: detection.structure.bias };
}

// ── generic overlay layer contract (Phases 15/16/17) ────────────────────────

export type OverlayLayerKind = "zones" | "events" | "lines" | "markers" | "annotations";

export interface OverlayZone {
    id: string;
    top: number;
    bottom: number;
    fromTime: number;
    /** Optional right edge; extends to the live edge when omitted. */
    toTime?: number;
    color: string;
    label?: string;
}

export interface OverlayEventMarker {
    id: string;
    time: number;
    price: number;
    text: string;
    color: string;
    /** aboveBar | belowBar | atPrice */
    position?: "aboveBar" | "belowBar" | "atPrice";
}

export interface OverlayLine {
    id: string;
    y1Price: number;
    y2Price?: number;
    x1Time?: number;
    x2Time?: number;
    color: string;
    label?: string;
    dashed?: boolean;
}

/**
 * An overlay layer is a pure data producer. AI outputs (Phase 16) plug in
 * here as interpretation layers — they can annotate but never mutate the
 * candle dataset, because they never receive a mutable reference.
 */
export interface ChartOverlayLayer {
    id: string;
    kind: OverlayLayerKind;
    enabled: boolean;
    getZones?: (candles: readonly ChartCandle[]) => OverlayZone[];
    getEventMarkers?: (candles: readonly ChartCandle[]) => OverlayEventMarker[];
    getLines?: (candles: readonly ChartCandle[]) => OverlayLine[];
}

/**
 * Structure → overlay layer adapter: feeds BOS/CHoCH/swing events from the
 * canonical engine into the renderer's event-marker/line pipeline.
 */
export function structureOverlayLayer(enabled: boolean): ChartOverlayLayer {
    let cache: { key: string; events: StructureOverlayEvent[] } | null = null;
    return {
        id: "smart-money-structure",
        kind: "events",
        enabled,
        getEventMarkers: (candles) => {
            if (candles.length === 0) return [];
            const tf = candles[0].timeframe;
            const key = `${candles.length}|${candles[candles.length - 1].timestamp}|${candles[candles.length - 1].close}`;
            if (!cache || cache.key !== key) {
                cache = { key, events: computeStructureOverlay(candles, tf).events };
            }
            return cache.events.map((e) => ({
                id: e.id,
                time: e.timestamp,
                price: e.price,
                text: e.kind,
                color:
                    e.kind === "BOS" ? (e.direction === "bullish" ? "#34d399" : "#fb7185")
                        : e.kind === "CHOCH" ? (e.direction === "bullish" ? "#22d3ee" : "#f97316")
                            : e.direction === "bullish" ? "#4ade80" : "#f87171",
                position: e.direction === "bullish" ? "belowBar" : "aboveBar",
            }));
        },
    };
}
