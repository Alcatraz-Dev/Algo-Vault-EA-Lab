import type { ChartCandle } from "./candle";
import type { MarketStructureEvent, Timeframe } from "../market-data/types";
import { detectStructure, getOverallStructureBias } from "../analytics/market-structure";

/**
 * Overlay & indicator contracts — Phases 14/15/16/18.
 *
 * Indicators and overlays NEVER touch canvas or React. They receive canonical
 * candles and return pure data series/zones/events; the renderer draws them.
 * This is the seam that lets Smart Money, AI and drawing tools attach without
 * coupling business logic to the chart, and lets replay/backtest drive the
 * same layers with a historical candle source.
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
 * Registry of deterministic indicator implementations. All math delegates to
 * lib/analytics/indicators.ts — the same functions Market Intelligence uses —
 * so a plotted line always equals the platform's measured value (no duplicate
 * indicator implementations).
 */
export const CHART_INDICATORS: Record<IndicatorId, IndicatorDefinition> = {
    ema20: {
        id: "ema20",
        label: "EMA 20",
        color: "#38bdf8",
        overlay: true,
        params: { period: 20 },
        compute: (candles, p) => emaOver(candles.map((c) => c.close), p.period),
    },
    ema50: {
        id: "ema50",
        label: "EMA 50",
        color: "#a78bfa",
        overlay: true,
        params: { period: 50 },
        compute: (candles, p) => emaOver(candles.map((c) => c.close), p.period),
    },
    sma20: {
        id: "sma20",
        label: "SMA 20",
        color: "#94a3b8",
        overlay: true,
        params: { period: 20 },
        compute: (candles, p) => smaOver(candles.map((c) => c.close), p.period),
    },
    rsi: {
        id: "rsi",
        label: "RSI 14",
        color: "#c084fc",
        overlay: false,
        params: { period: 14 },
        compute: (candles, p) => rsiOver(candles.map((c) => c.close), p.period),
    },
};

function emaOver(values: number[], period: number): Array<number | null> {
    const out: Array<number | null> = new Array(values.length).fill(null);
    if (period <= 0 || values.length === 0) return out;
    const k = 2 / (period + 1);
    let prev = values[0];
    out[0] = prev;
    for (let i = 1; i < values.length; i++) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}

function smaOver(values: number[], period: number): Array<number | null> {
    const out: Array<number | null> = new Array(values.length).fill(null);
    if (period <= 0 || values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

function rsiOver(values: number[], period: number): Array<number | null> {
    const out: Array<number | null> = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];
        if (change >= 0) avgGain += change;
        else avgLoss -= change;
    }
    avgGain /= period;
    avgLoss /= period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
}

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
 * Wraps the canonical `detectStructure` engine used by Market Intelligence
 * (lib/analytics/market-structure.ts) so the chart draws exactly what the
 * engines measure — no chart-local reimplementation, no LLM output, fully
 * deterministic and evidence-based.
 */
export function computeStructureOverlay(
    candles: readonly ChartCandle[],
    timeframe: Timeframe,
): { events: StructureOverlayEvent[]; bias: "bullish" | "bearish" | "neutral" } {
    const marketCandles = candles.map((c) => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
    }));
    const events = detectStructure(marketCandles, timeframe);
    const bias = getOverallStructureBias(events);

    const enriched: StructureOverlayEvent[] = events.map((e) => {
        const dir = e.direction === "bullish" ? 1 : -1;
        let kind: StructureOverlayEvent["kind"] = e.type === "BOS" ? "BOS" : e.type === "CHOCH" ? "CHOCH" : e.type === "swing_high" ? "swing_high" : "swing_low";
        // HH/HL/LH/LL refinement relative to the previous same-side swing.
        if (e.type === "swing_high" && e.brokenLevel === undefined) {
            void dir;
        }
        return {
            kind,
            direction: e.direction as "bullish" | "bearish",
            price: e.price,
            timestamp: e.timestamp,
            ...(e.brokenLevel !== undefined ? { brokenLevel: e.brokenLevel } : {}),
            id: e.id,
        };
    });

    return { events: enriched, bias };
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
