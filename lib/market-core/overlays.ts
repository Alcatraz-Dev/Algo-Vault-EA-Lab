/**
 * Overlay engine — one abstraction for every market-coordinate object.
 *
 * Rules:
 *  - Every overlay is stored in MARKET coordinates (startTime/endTime +
 *    priceStart/priceEnd). Nothing here knows about pixels, panes, scroll
 *    offsets or React components.
 *  - Renderers translate through the single coordinate pipeline
 *    (`lib/chart-engine/coordinate-mapping.ts` → renderer series), so pan,
 *    zoom, resize and history prepends can never move an object.
 *  - Layers are explicit, independently toggleable groups; each has a
 *    default visual priority and a density budget so hundreds of smart-money
 *    objects cannot destroy readability. Density reduction NEVER drops the
 *    underlying object — only its rendering.
 */

import { overlayRegistry } from "./registry";
import type { IntelligenceLayerId, MarketOverlay, OverlayDefinition, OverlayPriority, SmartMoneyObject } from "./types";

// ── layer groups ───────────────────────────────────────────────────────────

export interface LayerDefinition {
    id: IntelligenceLayerId;
    label: string;
    /** Default toggle state for a fresh workspace. */
    defaultVisible: boolean;
    /** Fallback priority for objects that do not declare one. */
    priority: OverlayPriority;
    /** Maximum objects drawn per viewport for this layer (density budget). */
    budget: number;
}

export const INTELLIGENCE_LAYERS: LayerDefinition[] = [
    { id: "candles", label: "Candles", defaultVisible: true, priority: "critical", budget: 10_000 },
    { id: "volume", label: "Volume", defaultVisible: true, priority: "medium", budget: 10_000 },
    { id: "indicators", label: "Indicators", defaultVisible: true, priority: "high", budget: 60 },
    { id: "market_structure", label: "Market Structure", defaultVisible: true, priority: "high", budget: 120 },
    { id: "liquidity", label: "Liquidity", defaultVisible: true, priority: "high", budget: 80 },
    { id: "fvg", label: "FVG", defaultVisible: true, priority: "high", budget: 60 },
    { id: "order_blocks", label: "Order Blocks", defaultVisible: false, priority: "high", budget: 40 },
    { id: "premium_discount", label: "Premium / Discount", defaultVisible: true, priority: "medium", budget: 12 },
    { id: "sessions", label: "Sessions", defaultVisible: true, priority: "medium", budget: 30 },
    { id: "signals", label: "Signals", defaultVisible: true, priority: "critical", budget: 60 },
    { id: "strategies", label: "Strategies", defaultVisible: true, priority: "critical", budget: 120 },
    { id: "ai", label: "AI", defaultVisible: true, priority: "low", budget: 40 },
    { id: "drawings", label: "Drawings", defaultVisible: true, priority: "medium", budget: 500 },
];

export const LAYER_BY_ID: Record<IntelligenceLayerId, LayerDefinition> = INTELLIGENCE_LAYERS.reduce(
    (acc, l) => {
        acc[l.id] = l;
        return acc;
    },
    {} as Record<IntelligenceLayerId, LayerDefinition>,
);

// ── visual priority ────────────────────────────────────────────────────────

export const PRIORITY_RANK: Record<OverlayPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};

const DEFAULT_PRIORITY: Record<IntelligenceLayerId, OverlayPriority> = {
    candles: "critical",
    volume: "medium",
    indicators: "high",
    market_structure: "high",
    liquidity: "high",
    fvg: "high",
    order_blocks: "high",
    premium_discount: "medium",
    sessions: "medium",
    signals: "critical",
    strategies: "critical",
    ai: "low",
    drawings: "medium",
};

export function overlayPriority(overlay: MarketOverlay): OverlayPriority {
    return overlay.priority ?? DEFAULT_PRIORITY[overlay.layer] ?? "medium";
}

// ── density management ─────────────────────────────────────────────────────

export interface DensityOptions {
    /** Currently visible time window (open times, ms). */
    fromTime?: number;
    toTime?: number;
    /** Layer toggle state; missing keys fall back to layer defaults. */
    visible?: Partial<Record<IntelligenceLayerId, boolean>>;
    /** Global multiplier (1 = full budget, 0.5 = half). */
    budgetScale?: number;
}

/**
 * Select which overlays to DRAW for the current viewport. Objects are never
 * mutated or deleted: the caller keeps the full set and renders this view.
 *
 * Rules, in order:
 *  1. hidden layers are excluded,
 *  2. objects outside the viewport window are excluded,
 *  3. within a layer, higher priority draws first; when a layer exceeds its
 *     budget, the lowest-priority/oldest objects are dropped (their data
 *     stays available for dashboards, alerts, AI and debug inspection).
 */
export function selectOverlaysForViewport(overlays: readonly MarketOverlay[], options: DensityOptions = {}): MarketOverlay[] {
    const budgetScale = options.budgetScale ?? 1;
    const inWindow = overlays.filter((o) => {
        const layer = LAYER_BY_ID[o.layer];
        const visible = options.visible?.[o.layer] ?? layer?.defaultVisible ?? true;
        if (!visible) return false;
        if (options.fromTime !== undefined && o.endTime !== undefined && o.endTime < options.fromTime) return false;
        if (options.toTime !== undefined && o.startTime > options.toTime) return false;
        return true;
    });

    const byLayer = new Map<IntelligenceLayerId, MarketOverlay[]>();
    for (const o of inWindow) {
        const list = byLayer.get(o.layer) ?? [];
        list.push(o);
        byLayer.set(o.layer, list);
    }

    const out: MarketOverlay[] = [];
    for (const [layerId, list] of byLayer) {
        const budget = Math.max(0, Math.round((LAYER_BY_ID[layerId]?.budget ?? 100) * budgetScale));
        list.sort((a, b) => {
            const pr = PRIORITY_RANK[overlayPriority(a)] - PRIORITY_RANK[overlayPriority(b)];
            if (pr !== 0) return pr;
            return b.startTime - a.startTime; // newer first
        });
        for (let i = 0; i < list.length && i < budget; i++) out.push(list[i]);
    }
    return out;
}

/** Stable ordering for rendering (time, then priority, then id). */
export function sortOverlays(overlays: readonly MarketOverlay[]): MarketOverlay[] {
    return [...overlays].sort((a, b) => {
        if (a.startTime !== b.startTime) return a.startTime - b.startTime;
        const pr = PRIORITY_RANK[overlayPriority(a)] - PRIORITY_RANK[overlayPriority(b)];
        if (pr !== 0) return pr;
        return a.id.localeCompare(b.id);
    });
}

// ── smart money → overlay mapping (single adapter) ─────────────────────────

/**
 * Convert a detected Smart Money object into a drawable market-coordinate
 * overlay. Every smart-money visualization on every surface goes through
 * this function, so chart/dashboard/backtest cannot disagree.
 */
export function smartMoneyToOverlay(
    obj: SmartMoneyObject,
    options: { layer?: IntelligenceLayerId; priority?: OverlayPriority; color?: string } = {},
): MarketOverlay {
    const layer: IntelligenceLayerId =
        options.layer ??
        (obj.kind === "fvg"
            ? "fvg"
            : obj.kind === "order_block"
                ? "order_blocks"
                : obj.kind === "equal_highs" || obj.kind === "equal_lows" || obj.kind === "liquidity_pool" || obj.kind === "liquidity_sweep"
                    ? "liquidity"
                    : obj.kind === "dealing_range"
                        ? "premium_discount"
                        : "market_structure");
    const type: MarketOverlay["type"] =
        obj.kind === "fvg"
            ? "fvg"
            : obj.kind === "order_block"
                ? "order_block"
                : obj.kind === "liquidity_sweep"
                    ? "marker"
                    : obj.kind === "equal_highs" || obj.kind === "equal_lows"
                        ? obj.kind === "equal_highs"
                            ? "equal_high"
                            : "equal_low"
                        : obj.kind === "bos" || obj.kind === "choch"
                            ? "structure_break"
                            : obj.kind === "dealing_range"
                                ? "range"
                                : obj.kind === "liquidity_pool"
                                    ? "liquidity"
                                    : "marker";
    return {
        id: obj.id,
        type,
        layer,
        symbol: obj.symbol,
        timeframe: obj.timeframe,
        startTime: obj.detectedAt,
        endTime: obj.status === "invalidated" ? obj.invalidatedAt ?? undefined : undefined,
        priceStart: obj.priceHigh ?? obj.price,
        priceEnd: obj.priceLow ?? (obj.priceHigh !== undefined ? obj.priceHigh : undefined),
        direction: obj.direction,
        priority: options.priority,
        label: obj.kind.toUpperCase(),
        ...(options.color ? { color: options.color } : {}),
        metadata: {
            status: obj.status,
            confirmationAt: obj.confirmationAt,
            strength: obj.strength,
            ...(obj.metadata ?? {}),
        },
    };
}

// ── built-in overlay registrations ────────────────────────────────────────

const BUILTIN_OVERLAYS: OverlayDefinition[] = [
    { id: "indicator.line", name: "Indicator line", category: "indicator", version: "1.0.0", layer: "indicators", kinds: ["line"] },
    { id: "indicator.band", name: "Indicator band", category: "indicator", version: "1.0.0", layer: "indicators", kinds: ["channel", "line"] },
    { id: "sm.structure", name: "Market structure event", category: "smart-money", version: "1.0.0", layer: "market_structure", kinds: ["marker", "structure_break", "label"] },
    { id: "sm.liquidity", name: "Liquidity pool / sweep", category: "smart-money", version: "1.0.0", layer: "liquidity", kinds: ["liquidity", "equal_high", "equal_low", "marker", "line"] },
    { id: "sm.fvg", name: "Fair value gap", category: "smart-money", version: "1.0.0", layer: "fvg", kinds: ["fvg", "zone"] },
    { id: "sm.order_block", name: "Order block", category: "smart-money", version: "1.0.0", layer: "order_blocks", kinds: ["order_block", "box"] },
    { id: "sm.dealing_range", name: "Premium/discount dealing range", category: "smart-money", version: "1.0.0", layer: "premium_discount", kinds: ["range", "line"] },
    { id: "signal.marker", name: "Signal marker", category: "signal", version: "1.0.0", layer: "signals", kinds: ["marker", "entry", "exit", "stop_loss", "take_profit"] },
    { id: "strategy.marker", name: "Strategy marker", category: "strategy", version: "1.0.0", layer: "strategies", kinds: ["marker", "entry", "exit", "stop_loss", "take_profit"] },
    { id: "ai.annotation", name: "AI annotation", category: "ai", version: "1.0.0", layer: "ai", kinds: ["ai_annotation", "label", "line"] },
    { id: "session.band", name: "Session band", category: "session", version: "1.0.0", layer: "sessions", kinds: ["zone", "session"] },
];

let overlaysRegistered = false;

export function registerBuiltinOverlays(): void {
    if (overlaysRegistered) return;
    overlaysRegistered = true;
    for (const def of BUILTIN_OVERLAYS) {
        if (!overlayRegistry.has(def.id)) overlayRegistry.register(def);
    }
}

registerBuiltinOverlays();
