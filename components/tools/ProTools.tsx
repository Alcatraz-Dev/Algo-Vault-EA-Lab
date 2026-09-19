"use client";

import { useState, useMemo } from "react";
import { Sparkles, TrendingUp, Target, Shield, BarChart3, Zap } from "lucide-react";
import ProGate from "@/components/subscription/ProGate";

interface StrategyParameter {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

interface OptimizationResult {
  parameter: string;
  bestValue: number;
  profit: number;
  drawdown: number;
  winRate: number;
  score: number;
}

export function StrategyOptimizer() {
  const [symbol, setSymbol] = useState("EURUSD");
  const [timeframe, setTimeframe] = useState("1h");
  const [strategyType, setStrategyType] = useState("moving_average");
  const [optimizationRunning, setOptimizationRunning] = useState(false);
  const [results, setResults] = useState<OptimizationResult[]>([]);
  const [bestParams, setBestParams] = useState<string | null>(null);

  const params = useMemo(() => {
    if (strategyType === "moving_average") {
      return [
        { name: "Fast MA Period", value: 20, min: 5, max: 50, step: 1 },
        { name: "Slow MA Period", value: 50, min: 20, max: 200, step: 1 },
        { name: "Stop Loss %", value: 1.5, min: 0.1, max: 5, step: 0.1 },
        { name: "Take Profit %", value: 3.0, min: 0.5, max: 10, step: 0.5 },
      ];
    }
    if (strategyType === "rsi") {
      return [
        { name: "RSI Period", value: 14, min: 5, max: 30, step: 1 },
        { name: "RSI Overbought", value: 70, min: 60, max: 90, step: 1 },
        { name: "RSI Oversold", value: 30, min: 10, max: 50, step: 1 },
        { name: "Stop Loss %", value: 2.0, min: 0.1, max: 5, step: 0.1 },
      ];
    }
    return [
      { name: "MACD Fast", value: 12, min: 5, max: 20, step: 1 },
      { name: "MACD Slow", value: 26, min: 10, max: 50, step: 1 },
      { name: "MACD Signal", value: 9, min: 3, max: 15, step: 1 },
      { name: "Stop Loss %", value: 1.5, min: 0.1, max: 5, step: 0.1 },
    ];
  }, [strategyType]);

  const runOptimization = () => {
    setOptimizationRunning(true);
    setTimeout(() => {
      const simulatedResults: OptimizationResult[] = params.map((p) => ({
        parameter: p.name,
        bestValue: p.value,
        profit: Math.random() * 20 - 5,
        drawdown: Math.random() * 10 + 1,
        winRate: Math.random() * 20 + 55,
        score: Math.random() * 100,
      }));
      simulatedResults.sort((a, b) => b.score - a.score);
      setResults(simulatedResults);
      setBestParams(JSON.stringify(simulatedResults[0]));
      setOptimizationRunning(false);
    }, 2000);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Sparkles size={16} className="text-violet-400" />
            Strategy Optimizer
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            AI-powered parameter optimization for your trading strategy
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BarChart3 size={16} />
            <span>Strategy: {strategyType}</span>
            <span className="text-xs">·</span>
            <span>{symbol}</span>
            <span className="text-xs">·</span>
            <span>{timeframe}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-violet-500/25 bg-violet-500/10 p-5">
          <div className="flex items-center gap-2 text-sm text-violet-300">
            <Zap size={16} />
            <span>Pro Feature</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="font-semibold mb-4">Configuration</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Symbol</label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                <option value="EURUSD">EUR/USD</option>
                <option value="GBPUSD">GBP/USD</option>
                <option value="XAUUSD">XAU/USD</option>
                <option value="BTCUSD">BTC/USD</option>
                <option value="ETHUSD">ETH/USD</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Timeframe</label>
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                <option value="1m">1 Minute</option>
                <option value="5m">5 Minutes</option>
                <option value="15m">15 Minutes</option>
                <option value="1h">1 Hour</option>
                <option value="4h">4 Hours</option>
                <option value="1D">Daily</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Strategy Type</label>
              <select value={strategyType} onChange={(e) => setStrategyType(e.target.value)} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                <option value="moving_average">Moving Average Crossover</option>
                <option value="rsi">RSI Momentum</option>
                <option value="macd">MACD Signal</option>
              </select>
            </div>
            <button
              onClick={runOptimization}
              disabled={optimizationRunning}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-violet-500 disabled:opacity-50"
            >
              {optimizationRunning ? (
                <>
                  <Sparkles size={16} className="animate-spin" />
                  Optimizing...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Run AI Optimization
                </>
              )}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="font-semibold mb-4">Optimization Results</h3>
          {results.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              Run optimization to see results
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((result, i) => (
                <div
                  key={i}
                  className={`rounded-xl border p-3 ${i === 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/30"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{result.parameter}</span>
                    {i === 0 && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-foreground">BEST</span>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Best Value</p>
                      <p className="font-semibold">{result.bestValue}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Profit</p>
                      <p className={`font-semibold ${result.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {result.profit >= 0 ? "+" : ""}{result.profit.toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Win Rate</p>
                      <p className="font-semibold">{result.winRate.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {bestParams && (
        <ProGate>
          <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-6">
            <h3 className="flex items-center gap-2 font-semibold text-violet-300">
              <Target size={18} />
              Recommended Strategy Configuration
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Best parameters found by AI optimization: {bestParams}
            </p>
            <button className="mt-4 flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-violet-500">
              <Zap size={14} />
              Apply to Strategy
            </button>
          </div>
        </ProGate>
      )}
    </div>
  );
}

export function RiskManager() {
  const [accountSize, setAccountSize] = useState(10000);
  const [riskPerTrade, setRiskPerTrade] = useState(1);
  const [maxDailyLoss, setMaxDailyLoss] = useState(5);
  const [maxDrawdown, setMaxDrawdown] = useState(10);

  const riskMetrics = useMemo(() => {
    const riskPerTradeAmount = accountSize * (riskPerTrade / 100);
    const maxDailyLossAmount = accountSize * (maxDailyLoss / 100);
    const maxDrawdownAmount = accountSize * (maxDrawdown / 100);
    const maxTradesPerDay = Math.floor(maxDailyLossAmount / riskPerTradeAmount);
    const positionSize = riskPerTradeAmount / (20 * 10);

    return {
      riskPerTradeAmount,
      maxDailyLossAmount,
      maxDrawdownAmount,
      maxTradesPerDay,
      positionSize,
      riskRewardRatio: maxDrawdown / riskPerTrade,
      safetyScore: Math.max(0, 100 - (maxDailyLoss + maxDrawdown)),
    };
  }, [accountSize, riskPerTrade, maxDailyLoss, maxDrawdown]);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Shield size={20} className="text-emerald-400" />
        Risk Manager (Pro)
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold mb-4">Risk Parameters</h4>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Account Size ($)</label>
              <input type="number" value={accountSize} onChange={(e) => setAccountSize(Number(e.target.value))} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Risk Per Trade (%)</label>
              <input type="number" step="0.1" value={riskPerTrade} onChange={(e) => setRiskPerTrade(Number(e.target.value))} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Max Daily Loss (%)</label>
              <input type="number" step="0.1" value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(Number(e.target.value))} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Max Drawdown (%)</label>
              <input type="number" step="0.1" value={maxDrawdown} onChange={(e) => setMaxDrawdown(Number(e.target.value))} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none" />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5">
          <h4 className="font-semibold mb-4">Risk Metrics</h4>
          <div className="grid gap-3">
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Risk per Trade</p>
              <p className="text-xl font-bold text-emerald-400">${riskMetrics.riskPerTradeAmount.toFixed(2)}</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Max Daily Loss</p>
              <p className="text-xl font-bold text-amber-400">${riskMetrics.maxDailyLossAmount.toFixed(2)}</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Max Trades/Day</p>
              <p className="text-xl font-bold text-foreground">{riskMetrics.maxTradesPerDay}</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Position Size</p>
              <p className="text-xl font-bold text-foreground">{riskMetrics.positionSize.toFixed(2)} lots</p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Safety Score</p>
              <p className={`text-xl font-bold ${riskMetrics.safetyScore > 70 ? "text-emerald-400" : "text-amber-400"}`}>
                {riskMetrics.safetyScore}/100
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}