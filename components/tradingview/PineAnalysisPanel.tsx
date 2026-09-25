"use client";

import { useMemo } from "react";
import { Check, X, AlertTriangle, Code, Layers, BarChart3, Bell, PenTool, Settings, Clock, Database } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { PineBacktestResult } from "@/lib/pine-runtime/backtest";

type Feature = { name: string; supported: boolean; icon: React.ReactNode };

type PineAnalysisResult = {
  version: string;
  scriptType: string;
  title: string;
  features: Feature[];
  canRun: boolean;
  unsupportedCount: number;
};

export function analyzePineScript(source: string): PineAnalysisResult {
  const src = source.toLowerCase();
  const features: Feature[] = [];

  // Version
  const versionMatch = source.match(/@version=(\d+)/);
  const version = versionMatch ? `v${versionMatch[1]}` : "v5";

  // Script type
  const isStrategy = /\bstrategy\s*\(/.test(src);
  const isIndicator = /\bindicator\s*\(/.test(src);
  const scriptType = isStrategy ? "Strategy" : isIndicator ? "Indicator" : "Script";

  // Title
  const titleMatch = source.match(/(?:indicator|strategy)\s*\(\s*["']([^"']+)["']/);
  const title = titleMatch?.[1] || "Untitled Script";

  // Core
  features.push({ name: "indicator/strategy", supported: true, icon: <Code size={12} /> });
  features.push({ name: "Variables", supported: true, icon: <Code size={12} /> });
  features.push({ name: "Expressions", supported: true, icon: <Code size={12} /> });
  features.push({ name: "Operators", supported: true, icon: <Code size={12} /> });
  features.push({ name: "Conditions", supported: true, icon: <Code size={12} /> });
  features.push({ name: "Ternary", supported: true, icon: <Code size={12} /> });
  features.push({ name: "User functions", supported: true, icon: <Code size={12} /> });
  features.push({ name: "Comments", supported: true, icon: <Code size={12} /> });

  // TA
  const taFunctions = ["sma", "ema", "wma", "rma", "rsi", "macd", "atr", "adx", "stoch", "highest", "lowest", "crossover", "crossunder", "change", "barssince", "valuewhen", "pivothigh", "pivotlow", "bb", "cci", "psar", "vwap", "obv", "mfi", "roc", "mom", "vwma", "hma"];
  const detectedTA = taFunctions.filter(f => new RegExp(`ta\\.${f}\\s*\\(`).test(src));
  features.push({ name: `TA functions (${detectedTA.length})`, supported: true, icon: <BarChart3 size={12} /> });

  // Math
  const mathFunctions = ["abs", "max", "min", "round", "floor", "ceil", "sqrt", "pow"];
  const detectedMath = mathFunctions.filter(f => new RegExp(`math\\.${f}\\s*\\(`).test(src));
  features.push({ name: `Math functions (${detectedMath.length})`, supported: true, icon: <BarChart3 size={12} /> });

  // Arrays
  const hasArrays = /\barray\.(new|push|pop|get|set|size|clear|max|min|sum)\s*\(/.test(src);
  features.push({ name: "Arrays", supported: true, icon: <Layers size={12} /> });

  // UDTs
  const hasUDTs = /\btype\s+\w+\s*\n\s+(float|int|string|bool|line|label|box|array|matrix)/.test(src);
  features.push({ name: "User-defined types", supported: true, icon: <Layers size={12} /> });

  // Custom methods
  const hasMethods = /\bmethod\s+\w+/.test(src);
  features.push({ name: "Custom methods", supported: true, icon: <Code size={12} /> });

  // MTF
  const hasMTF = /\brequest\.security\s*\(/.test(src);
  features.push({ name: "Multi-timeframe", supported: true, icon: <Clock size={12} /> });

  // Inputs
  const hasInputs = /\binput\.(int|float|bool|string|source|timeframe|symbol|color)\s*\(/.test(src);
  features.push({ name: "Custom inputs", supported: true, icon: <Settings size={12} /> });

  // Symbol/Timeframe/Barstate
  const hasSyminfo = /\bsyminfo\.\w+/.test(src);
  const hasTimeframe = /\btimeframe\.\w+/.test(src);
  const hasBarstate = /\bbarstate\.\w+/.test(src);
  features.push({ name: "Symbol info", supported: true, icon: <Database size={12} /> });
  features.push({ name: "Timeframe info", supported: true, icon: <Clock size={12} /> });
  features.push({ name: "Bar state", supported: true, icon: <Clock size={12} /> });

  // Plots
  const hasPlot = /\bplot\s*\(/.test(src);
  const hasPlotshape = /\bplotshape\s*\(/.test(src);
  const hasPlotchar = /\bplotchar\s*\(/.test(src);
  const hasHline = /\bhline\s*\(/.test(src);
  const hasFill = /\bfill\s*\(/.test(src);
  const hasBgcolor = /\bbgcolor\s*\(/.test(src);
  const hasBarcolor = /\bbarcolor\s*\(/.test(src);
  const hasPlotcandle = /\bplotcandle\s*\(/.test(src);
  features.push({ name: "Plots", supported: true, icon: <PenTool size={12} /> });
  if (hasPlotshape) features.push({ name: "plotshape", supported: true, icon: <PenTool size={12} /> });
  if (hasPlotchar) features.push({ name: "plotchar", supported: true, icon: <PenTool size={12} /> });
  if (hasHline) features.push({ name: "hline", supported: true, icon: <PenTool size={12} /> });
  if (hasFill) features.push({ name: "fill", supported: true, icon: <PenTool size={12} /> });
  if (hasBgcolor) features.push({ name: "bgcolor", supported: true, icon: <PenTool size={12} /> });
  if (hasBarcolor) features.push({ name: "barcolor", supported: true, icon: <PenTool size={12} /> });
  if (hasPlotcandle) features.push({ name: "plotcandle", supported: true, icon: <PenTool size={12} /> });

  // Drawings
  const hasLine = /\bline\.(new|set_|delete)\s*\(/.test(src);
  const hasLabel = /\blabel\.(new|set_|delete)\s*\(/.test(src);
  const hasBox = /\bbox\.(new|set_|delete)\s*\(/.test(src);
  features.push({ name: "Drawing objects", supported: true, icon: <PenTool size={12} /> });

  // Alerts
  const hasAlertcondition = /\balertcondition\s*\(/.test(src);
  const hasAlert = /\balert\s*\(/.test(src);
  features.push({ name: "Alerts", supported: true, icon: <Bell size={12} /> });

  // Strategy
  if (isStrategy) {
    features.push({ name: "Strategy entries", supported: true, icon: <BarChart3 size={12} /> });
    features.push({ name: "Strategy exits", supported: true, icon: <BarChart3 size={12} /> });
    features.push({ name: "Position tracking", supported: true, icon: <BarChart3 size={12} /> });
    features.push({ name: "Backtesting", supported: true, icon: <BarChart3 size={12} /> });
  }

  // Loops
  const hasLoops = /\bfor\s*\(/.test(src) || /\bwhile\s*\(/.test(src);
  features.push({ name: "Loops", supported: true, icon: <Code size={12} /> });

  // Unsupported features (only truly blocking ones)
  const unsupported: string[] = [];
  if (/matrix\.(new|set|get|rows|columns)\s*\(/.test(src)) unsupported.push("Matrix operations");
  if (/request\.security_lower_tf\s*\(/.test(src)) unsupported.push("request.security_lower_tf");
  if (/request\.security_pol\s*\(/.test(src)) unsupported.push("request.security_pol");

  const unsupportedCount = unsupported.length;
  const canRun = unsupportedCount === 0;

  // Table/polyline are gracefully ignored (visual-only in TradingView, not blocking)

  if (unsupported.length > 0) {
    features.push({ name: `Unsupported: ${unsupported.join(", ")}`, supported: false, icon: <X size={12} /> });
  }

  return { version, scriptType, title, features, canRun, unsupportedCount };
}

import { Loader2 } from "lucide-react";
interface PineAnalysisPanelProps {
  source: string;
  onApply: () => void;
  onBacktest?: () => void;
  onReplay?: () => void;
  onAlert?: () => void;
  isBacktestLoading?: boolean;
  backtestResult?: PineBacktestResult | null;
}

export default function PineAnalysisPanel({ source, onApply, onBacktest, onReplay, onAlert, isBacktestLoading, backtestResult }: PineAnalysisPanelProps) {
  const analysis = useMemo(() => analyzePineScript(source), [source]);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${analysis.canRun ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
          {analysis.canRun ? <Check size={18} className="text-emerald-400" /> : <AlertTriangle size={18} className="text-amber-400" />}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Pine Script Analysis</h3>
          <p className="text-xs text-muted-foreground">{analysis.title}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">{analysis.version}</span>
          <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400">{analysis.scriptType}</span>
          {analysis.canRun && <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">Runtime Compatible</span>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {analysis.features.map((f) => (
          <div key={f.name} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium ${f.supported ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" : "border-rose-500/20 bg-rose-500/5 text-rose-400"}`}>
            {f.supported ? <Check size={11} /> : <X size={11} />}
            {f.name}
          </div>
        ))}
      </div>

      {backtestResult && (
        <div className="mt-4 rounded-xl border border-border bg-background/50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-foreground">Backtest Results</h4>
            <span className="text-[10px] text-muted-foreground">{backtestResult.timeframe} · {backtestResult.symbol}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Trades</p>
              <p className="text-sm font-semibold text-foreground">{backtestResult.metrics.totalTrades}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Win Rate</p>
              <p className="text-sm font-semibold text-foreground">{backtestResult.metrics.winRate.toFixed(1)}%</p>
            </div>
            <div className={`rounded-lg border p-2 text-center ${backtestResult.metrics.netProfit >= 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5"}`}>
              <p className="text-[10px] text-muted-foreground">Net P&amp;L</p>
              <p className={`text-sm font-semibold ${backtestResult.metrics.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {backtestResult.metrics.netProfit.toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Max DD</p>
              <p className="text-sm font-semibold text-rose-400">{backtestResult.metrics.maxDrawdownPct.toFixed(1)}%</p>
            </div>
          </div>
          {backtestResult.trades.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-1">Direction</th>
                    <th className="pb-1">Entry</th>
                    <th className="pb-1">Exit</th>
                    <th className="pb-1">P&amp;L</th>
                    <th className="pb-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {backtestResult.trades.map((t) => (
                    <tr key={t.id}>
                      <td className={t.direction === "long" ? "text-emerald-400" : "text-rose-400"}>{t.direction}</td>
                      <td>{t.entry.toFixed(5)}</td>
                      <td>{t.exit.toFixed(5)}</td>
                      <td className={t.profit >= 0 ? "text-emerald-400" : "text-rose-400"}>{t.profit.toFixed(2)}</td>
                      <td className="text-muted-foreground">{t.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2" data-guide="alerts">
        <Button size="sm" onClick={onApply} className="bg-amber-500 hover:bg-amber-600 text-white font-medium">
          <Check size={14} className="mr-1" /> Apply to Chart
        </Button>
        {analysis.scriptType === "Strategy" && onBacktest && (
          <Button size="sm" variant="outline" onClick={onBacktest} disabled={isBacktestLoading}>
            {isBacktestLoading ? <Loader2 size={14} className="animate-spin mr-1" /> : <BarChart3 size={14} className="mr-1" />}
            {isBacktestLoading ? "Backtesting..." : "Backtest"}
          </Button>
        )}
        {onReplay && (
          <Button size="sm" variant="outline" onClick={onReplay}>
            <Clock size={14} className="mr-1" /> Replay
          </Button>
        )}
        {onAlert && (
          <Button size="sm" variant="outline" onClick={onAlert}>
            <Bell size={14} className="mr-1" /> Create Alert
          </Button>
        )}
      </div>
    </div>
  );
}
