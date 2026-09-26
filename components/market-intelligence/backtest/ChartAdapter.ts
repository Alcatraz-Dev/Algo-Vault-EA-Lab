/**
 * Chart Interaction Adapter — connects chart layers to existing overlay adapter.
 */
export const chartLayers = [
  { id: "candles", label: "Candles", default: true },
  { id: "indicators", label: "Indicators", default: true },
  { id: "structure", label: "Structure", default: true },
  { id: "liquidity", label: "Liquidity", default: true },
  { id: "fvg", label: "FVG", default: true },
  { id: "ob", label: "Order Blocks", default: true },
  { id: "sessions", label: "Sessions", default: true },
  { id: "trades", label: "Trades", default: true },
  { id: "replay", label: "Replay Markers", default: false },
];
