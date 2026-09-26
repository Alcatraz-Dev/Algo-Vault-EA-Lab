/**
 * Chart Overlay Toggle Adapter
 */
export type ChartLayer = "candles" | "structure" | "liquidity" | "fvg" | "ob" | "sessions" | "indicators" | "trades" | "replay";

export const DEFAULT_LAYERS: ChartLayer[] = ["candles", "indicators", "structure", "liquidity", "fvg", "ob", "sessions"];

export function toggleLayer(current: ChartLayer[], layer: ChartLayer): ChartLayer[] {
  return current.includes(layer) ? current.filter((l) => l !== layer) : [...current, layer];
}
