import type { Candle } from "@/components/tradingview/TradingChart/types";

export interface SymbolInfo {
  ticker: string;
  tickerid: string;
  mintick: number;
  pointvalue: number;
  currency: string;
  prefix: string;
  description: string;
}

export interface TimeframeInfo {
  period: string;
  multiplier: number;
  isintraday: boolean;
  isdaily: boolean;
  isweekly: boolean;
  ismonthly: boolean;
}

export interface BarState {
  isfirst: boolean;
  islast: boolean;
  isconfirmed: boolean;
  isrealtime: boolean;
  ishistory: boolean;
  isnew: boolean;
}

export interface PineInput {
  name: string;
  label: string;
  type: "int" | "float" | "bool" | "string" | "source" | "timeframe" | "symbol" | "color";
  defaultValue: unknown;
  options?: unknown[];
  minval?: number;
  maxval?: number;
  step?: number;
}

export interface PlotOutput {
  id: string;
  title: string;
  values: (number | null)[];
  color?: string;
  lineWidth?: number;
  style?: string;
  display?: string;
  editable?: boolean;
}

export interface HlineOutput {
  id: string;
  title: string;
  value: number;
  color?: string;
  linestyle?: string;
  linewidth?: number;
}

export interface FillOutput {
  id: string;
  from: string;
  to: string;
  color?: string;
  opacity?: number;
}

export interface BgcolorOutput {
  id: string;
  values: (string | null)[];
  opacity?: number;
}

export interface BarcolorOutput {
  values: (string | null)[];
}

export interface PlotShapeOutput {
  id: string;
  title: string;
  style: string;
  location: string;
  color?: string;
  offset?: number;
  text?: string;
  textcolor?: string;
  size?: string;
  values: (boolean | null)[];
}

export interface PlotCharOutput extends PlotShapeOutput {
  char: string;
}

export interface PlotCandleOutput {
  id: string;
  title: string;
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  color?: string;
}

export interface LineDrawing {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  width?: number;
  extend?: string;
  style?: string;
}

export interface LabelDrawing {
  id: string;
  x: number;
  y: number;
  text: string;
  color?: string;
  textcolor?: string;
  style?: string;
  size?: string;
  yloc?: string;
}

export interface BoxDrawing {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  border_color?: string;
  bgcolor?: string;
  border_width?: number;
  border_style?: string;
  text?: string;
  text_size?: string;
  text_color?: string;
  text_halign?: string;
  text_valign?: string;
}

export interface AlertCondition {
  id: string;
  title: string;
  message: string;
  condition: (barIndex: number) => boolean;
}

export interface StrategyTrade {
  id: string;
  direction: "long" | "short";
  entryPrice: number;
  entryBar: number;
  size: number;
  exitPrice?: number;
  exitBar?: number;
  pnl?: number;
  pnlPercent?: number;
  exitReason?: string;
}

export interface StrategyState {
  position_size: number;
  position_avg_price: number;
  open_trades: StrategyTrade[];
  closed_trades: StrategyTrade[];
  equity: number;
  balance: number;
  initial_capital: number;
  commission: number;
  win_count: number;
  loss_count: number;
  total_pnl: number;
  max_drawdown: number;
  peak_equity: number;
}

export interface PineExecutionResult {
  plots: PlotOutput[];
  hlines: HlineOutput[];
  fills: FillOutput[];
  bgcolors: BgcolorOutput[];
  barcolors: BarcolorOutput[];
  plotshapes: PlotShapeOutput[];
  plotchars: PlotCharOutput[];
  plotcandles: PlotCandleOutput[];
  lines: LineDrawing[];
  labels: LabelDrawing[];
  boxes: BoxDrawing[];
  alerts: AlertCondition[];
  inputs: PineInput[];
  strategy: StrategyState | null;
  title: string;
  overlay: boolean;
  errors: string[];
}
