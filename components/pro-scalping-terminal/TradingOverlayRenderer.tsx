"use client";

import { LineStyle } from "lightweight-charts";
import type { IChartApi, ISeriesApi, IPriceLine, Time } from "lightweight-charts";
import type { ChartSettings } from "./chart-settings";
import type { ChartPositionView, ChartPendingOrderView } from "./chart-settings";
import { resolvePriceY, type MarketPriceTransform } from "./drawing-utils";

export type TradeLineOwner = {
  ticket: string;
  side?: "BUY" | "SELL";
  kind: "entry" | "stop" | "target" | "pending";
};

export type TradePriceLine = IPriceLine & { _owner?: TradeLineOwner };

export type TradingOverlayState = {
  cfg: ChartSettings;
  positions: readonly ChartPositionView[];
  orders: readonly ChartPendingOrderView[];
  ask?: number | null;
};

export type TradingSeriesTransform = MarketPriceTransform & {
  coordinateToPrice?(y: number): number | null;
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | ISeriesApi<"Baseline"> | ISeriesApi<"Bar"> | null;
};

const EMPTY: TradePriceLine[] = [];

export class TradingOverlayRenderer {
  private attached = false;
  private lastSeries: TradingSeriesTransform["series"] = null;
  private chart: IChartApi | null = null;
  private cs: ISeriesApi<"Candlestick"> | null = null;
  private readonly lines: TradePriceLine[] = [];

  isAttached(): boolean {
    return this.attached;
  }

  attach(chart: IChartApi | null, cs: ISeriesApi<"Candlestick"> | null): void {
    this.attached = true;
    this.chart = chart;
    this.cs = cs;
    this.lastSeries = cs;
  }

  detach(): void {
    this.attached = false;
    this.chart = null;
    this.cs = null;
    this.lastSeries = null;
    this.lines.length = 0;
  }

  currentLines(): readonly TradePriceLine[] {
    return this.lines;
  }

  currentSeries(): TradingSeriesTransform["series"] {
    return this.lastSeries;
  }

  render(state: TradingOverlayState): TradePriceLine[] {
    this.clear();
    if (!this.attached || !this.chart || !this.cs) return this.lines;
    if (!state.cfg.display.tradeLevels) return this.lines;
    if (state.positions.length === 0 && state.orders.length === 0) return this.lines;

    const series = this.cs;
    const lines: TradePriceLine[] = [];

    const stopLine = (
      price: number,
      volume: number | undefined,
      kind: "SL" | "TP",
      ticket: string,
      side?: "BUY" | "SELL",
      pnl?: string,
    ): TradePriceLine => {
      const line: TradePriceLine = series.createPriceLine({
        price,
        color: kind === "SL" ? state.cfg.colors.slLine : state.cfg.colors.tpLine,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${kind} ${vol(volume)}${pnl ? ` · ${pnl}` : ""}`.trim(),
      });
      line._owner = { ticket, side, kind: kind === "SL" ? "stop" : "target" };
      return line;
    };

    for (const p of state.positions) {
      const pn = livePnL(p, state.cfg.colors);
      const liveValue = liveProfitOf(p);
      const isWin = liveValue === null ? true : liveValue >= 0;
      const entryLine: TradePriceLine = series.createPriceLine({
        price: p.entry,
        color: isWin ? state.cfg.colors.tpLine : state.cfg.colors.slLine,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${p.side} ${vol(p.volume)} ${pn}`.trim(),
      });
      entryLine._owner = { ticket: p.ticket, side: p.side, kind: "entry" };
      lines.push(entryLine);
      if (p.sl != null && Number.isFinite(p.sl) && p.sl > 0)
        lines.push(stopLine(p.sl, p.volume, "SL", p.ticket, p.side, pn));
      if (p.tp != null && Number.isFinite(p.tp) && p.tp > 0)
        lines.push(stopLine(p.tp, p.volume, "TP", p.ticket, p.side, pn));
    }

    for (const o of state.orders) {
      const pendingLine: TradePriceLine = series.createPriceLine({
        price: o.price,
        color: state.cfg.colors.pendingLine,
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `${o.type.replace("_", " ")} ${vol(o.volume)}`.trim(),
      });
      pendingLine._owner = { ticket: o.ticket, kind: "pending" };
      lines.push(pendingLine);
      if (o.sl != null && Number.isFinite(o.sl) && o.sl > 0)
        lines.push(stopLine(o.sl, o.volume, "SL", o.ticket, undefined, undefined));
      if (o.tp != null && Number.isFinite(o.tp) && o.tp > 0)
        lines.push(stopLine(o.tp, o.volume, "TP", o.ticket, undefined, undefined));
    }

    this.lines.push(...lines);
    this.lastSeries = series;
    return lines;
  }

  clear(): void {
    for (const l of this.lines) {
      try {
        const series = this.lastSeries;
        if (series) series.removePriceLine(l);
      } catch {
        // series already gone
      }
    }
    this.lines.length = 0;
  }

  static vol(v?: number): string {
    return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "";
  }

  static livePnL(p: ChartPositionView & { unrealized?: number }): string {
    const value = liveProfitOf(p);
    if (value === null) return "";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USD`;
  }

  static lineIsHittable(line: TradePriceLine | undefined, owner: TradeLineOwner): boolean {
    return line?._owner?.ticket === owner.ticket;
  }

  static priceY(line: TradePriceLine, series: MarketPriceTransform): number {
    try {
      return series.priceToCoordinate(line.options().price) ?? NaN;
    } catch {
      return NaN;
    }
  }
}

function liveProfitOf(p: ChartPositionView & { unrealized?: number }): number | null {
  const value = p.unrealized ?? p.profit;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function livePnL(p: ChartPositionView & { unrealized?: number }, colors: ChartSettings["colors"]): string | undefined {
  const value = liveProfitOf(p);
  if (value === null) return undefined;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USD`;
}

function vol(v?: number): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "";
}

export function tradeLineY(line: TradePriceLine, series: MarketPriceTransform): number {
  return TradingOverlayRenderer.priceY(line, series);
}

export function hitTestTradeLine(
  lines: readonly TradePriceLine[],
  owners: readonly (TradeLineOwner & { line: TradePriceLine })[],
  series: MarketPriceTransform,
  sy: number,
): { owner: TradeLineOwner; line: TradePriceLine; dist: number } | null {
  if (owners.length === 0) return null;
  let best: { owner: TradeLineOwner; line: TradePriceLine; dist: number } | null = null;
  for (const owner of owners) {
    const line = owner.line;
    if (!TradingOverlayRenderer.lineIsHittable(line, owner)) continue;
    const y = tradeLineY(line, series);
    if (!Number.isFinite(y)) continue;
    const dist = Math.abs(sy - y);
    if (!best || dist < best.dist) best = { owner: line._owner!, line, dist };
  }
  return best;
}
