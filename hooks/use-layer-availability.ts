"use client";

/**
 * useLayerAvailability — per-symbol chart-layer availability.
 *
 * The static CHART_LAYERS vocabulary declares renderer capability; some
 * layers additionally depend on the SYMBOL having a wired data source (GEX
 * needs an options chain). For those, the per-symbol resolver's verdict
 * REPLACES the static availability — so a consumer that does not feed the
 * required data (e.g. a workspace that never passes an options chain) simply
 * keeps the static `available: false` and the layer stays honestly disabled.
 */

import { useMemo } from "react";
import { CHART_LAYERS, PER_SYMBOL_LAYERS, type ChartLayerId } from "@/components/pro-scalping-terminal/chart-layers";

export function useLayerAvailability(symbol: string): Record<ChartLayerId, boolean> {
    return useMemo(() => {
        const out = {} as Record<ChartLayerId, boolean>;
        for (const layer of CHART_LAYERS) {
            const perSymbol = PER_SYMBOL_LAYERS[layer.id];
            out[layer.id] = perSymbol ? perSymbol(symbol) : layer.available;
        }
        return out;
    }, [symbol]);
}
